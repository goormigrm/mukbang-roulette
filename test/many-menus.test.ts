// 후보가 100종 이상일 때 — 실제 방송에서 110~130종이 쌓인다(사용자 확인). 개수 상한은 없다(임의 제약 금지).
// 화면(원판 그리기·60fps)은 Node에서 못 재므로 tools/capture-gif/measure.mjs 로 따로 잰다. 여기서는 규칙 엔진만.
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_HISTORY, Store, UNDO_MS } from '../src/state'

let s: Store
let seq = 0
const don = (nick: string, amount: number, message: string): void =>
  s.handleDonation({ id: `m${++seq}`, nick, amount, message, isVideo: false })

/** n종을 도네로 쌓는다 — i번째 메뉴는 (i % 7 + 1)칸, 추천자 "시청자i" */
function fill(n: number): void {
  for (let i = 0; i < n; i++) don(`시청자${i}`, ((i % 7) + 1) * 1000, `메뉴${i}`)
}

/** index번째 메뉴 칸 한가운데에 떨어지는 난수 */
function randomFor(index: number): number {
  const total = s.totalWeight()
  const before = s.menus.slice(0, index).reduce((a, m) => a + m.weight, 0)
  return (before + s.menus[index].weight / 2) / total
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T12:00:00+09:00'))
  localStorage.clear()
  s = new Store()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('후보 100종 이상', () => {
  it('300종까지 개수 제한 없이 쌓이고 칸·추천자가 맞다', () => {
    fill(300)
    expect(s.menus).toHaveLength(300)
    expect(s.menus[0]).toMatchObject({ name: '메뉴0', weight: 1, donors: ['시청자0'] })
    expect(s.menus[299]).toMatchObject({ name: '메뉴299', weight: (299 % 7) + 1, donors: ['시청자299'] })
    const want = Array.from({ length: 300 }, (_, i) => (i % 7) + 1).reduce((a, b) => a + b, 0)
    expect(s.totalWeight()).toBe(want)
  })

  it('많은 메뉴 사이에서도 띄어쓰기만 다른 도네는 새 칸이 아니라 그 메뉴에 합쳐진다', () => {
    fill(300)
    don('늦은', 5000, '메뉴 250 추가')
    expect(s.menus).toHaveLength(300)
    const m = s.menus.find((x) => x.name === '메뉴250')!
    expect(m.weight).toBe((250 % 7) + 1 + 5)
    expect(m.donors).toEqual(['시청자250', '늦은'])
  })

  it('300종 모두 뽑힐 수 있다 — 칸마다 그 칸에 떨어지는 난수면 정확히 그 메뉴', () => {
    fill(300)
    s.beginSpin()
    for (let i = 0; i < 300; i++) {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(randomFor(i))
      expect(s.pickWinner()?.index).toBe(i)
      spy.mockRestore()
    }
  })

  it('맨 끝 칸 경계 — 난수가 1에 아주 가까워도 마지막 메뉴', () => {
    fill(300)
    s.beginSpin()
    vi.spyOn(Math, 'random').mockReturnValue(0.9999999999)
    expect(s.pickWinner()?.index).toBe(299)
  })

  it('실제 예시 파일(120종·671칸)로 20만 번 뽑으면 메뉴마다 칸 비율대로 나온다', () => {
    const json = fs.readFileSync('public/sample-menus-120.json', 'utf8')
    expect(s.importMenusJson(json)).toBe(120)
    expect(s.totalWeight()).toBe(671)
    const n = 200_000
    const count = new Array<number>(120).fill(0)
    s.beginSpin()
    for (let i = 0; i < n; i++) count[s.pickWinner()!.index]++
    // 전체 분포 차이(총변동거리)가 1% 미만이고, 가장 큰 메뉴도 ±0.5%p 안
    const tv = s.menus.reduce((a, m, i) => a + Math.abs(count[i] / n - m.weight / 671), 0) / 2
    expect(tv).toBeLessThan(0.01)
    const big = s.menus.reduce((a, m, i) => (m.weight > s.menus[a].weight ? i : a), 0)
    expect(Math.abs((count[big] / n) * 100 - (s.menus[big].weight / 671) * 100)).toBeLessThan(0.5)
    // 1칸짜리 메뉴도 한 번도 안 나오는 일은 없다 (기대 약 298번)
    expect(Math.min(...count)).toBeGreaterThan(150)
  })

  it('한 판을 끝까지 — 돌리기 → 당첨 → 리롤 → 확정, 기록에 300종이 그대로', () => {
    fill(300)
    vi.spyOn(Math, 'random').mockReturnValue(randomFor(123))
    s.beginSpin()
    s.pickWinner()
    s.finishSpin()
    expect(s.winner?.name).toBe('메뉴123')
    s.startRerollWindow(20000)
    don('큰손', 20000, '')
    expect(s.rerollCredits).toBe(1)
    vi.spyOn(Math, 'random').mockReturnValue(randomFor(7))
    expect(s.beginSpin(true)).toBe(true)
    s.pickWinner()
    s.finishSpin()
    expect(s.winner?.name).toBe('메뉴7')
    s.confirmResult()
    expect(s.history[0].menus).toHaveLength(300)
    expect(s.history[0].winner).toBe('메뉴7')
    expect(s.history[0].rerollCount).toBe(1)
  })

  it('이름 고쳐 합치기와 되돌리기 — 가운데(150번째) 메뉴를 앞쪽 메뉴에 합쳤다가 원래 자리로', () => {
    fill(300)
    const mid = s.menus[150]
    const front = s.menus[10]
    const wMid = mid.weight
    const wFront = front.weight
    s.renameMenu(mid.id, '메뉴 10')
    expect(s.menus).toHaveLength(299)
    expect(front.weight).toBe(wFront + wMid)
    expect(front.donors).toEqual(['시청자10', '시청자150'])
    s.undo()
    expect(s.menus).toHaveLength(300)
    expect(s.menus[150]).toBe(mid)
    expect(front.weight).toBe(wFront)
    expect(front.donors).toEqual(['시청자10'])
  })

  it('맨 앞·맨 뒤 메뉴를 지웠다가 되돌려도 제자리', () => {
    fill(300)
    const first = s.menus[0]
    const last = s.menus[299]
    s.removeMenu(first.id)
    s.undo()
    expect(s.menus[0]).toBe(first)
    s.removeMenu(last.id)
    s.undo()
    expect(s.menus[299]).toBe(last)
    vi.advanceTimersByTime(UNDO_MS + 1)
    expect(s.menus).toHaveLength(300)
  })

  it('300종이 새로고침해도 그대로 살아난다 (순서·칸·추천자)', () => {
    fill(300)
    const before = JSON.stringify(s.menus.map((m) => [m.name, m.weight, m.donors]))
    const t = new Store()
    expect(JSON.stringify(t.menus.map((m) => [m.name, m.weight, m.donors]))).toBe(before)
  })

  it(`300종짜리 판을 ${MAX_HISTORY + 3}번 확정해도 기록은 ${MAX_HISTORY}개, 저장도 된다`, () => {
    fill(300)
    for (let i = 0; i < MAX_HISTORY + 3; i++) {
      s.beginSpin()
      s.pickWinner()
      s.finishSpin()
      s.confirmResult()
    }
    expect(s.history).toHaveLength(MAX_HISTORY)
    const t = new Store()
    expect(t.history).toHaveLength(MAX_HISTORY)
    expect(t.history[0].menus).toHaveLength(300)
    // 브라우저 localStorage 한도(보통 5MB) 안 — 실제 저장 크기를 잰다
    const bytes = [...Array(localStorage.length).keys()].reduce((a, i) => {
      const k = localStorage.key(i)!
      return a + (k.length + (localStorage.getItem(k) ?? '').length) * 2
    }, 0)
    expect(bytes).toBeLessThan(5 * 1024 * 1024)
  })

  it('예시 파일 120종 — 내보냈다 다시 불러와도 같다', () => {
    s.importMenusJson(fs.readFileSync('public/sample-menus-120.json', 'utf8'))
    const before = s.menus.map((m) => [m.name, m.weight, m.donors])
    s.importMenusJson(s.exportMenusJson())
    expect(s.menus.map((m) => [m.name, m.weight, m.donors])).toEqual(before)
  })

  it('도네 1,000건이 300종 목록에 들어와도 금방 처리되고 피드는 200줄로 묶인다', () => {
    fill(300)
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < 1000; i++) don(`시청자${i}`, 3000, `메뉴${i % 400}`)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    expect(s.menus).toHaveLength(400) // 메뉴300~399가 새로 생김
    expect(s.feed.length).toBeLessThanOrEqual(200)
    // 넉넉한 상한 — 목록 길이에 제곱으로 느려지는 실수만 잡는다 (보통 수백 ms)
    expect(ms).toBeLessThan(3000)
  })
})
