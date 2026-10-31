// 규칙 엔진(state.ts) 테스트 — 돈이 걸린 판정(메뉴 칸·리롤권·리롤 금액·버저비터)과
// 목록 조작(합치기·이름 고치기·되돌리기), 새로고침 복원을 고정해 둔다.
// 커밋·푸시 전에 git 훅이, 배포 전에 GitHub Actions가 이 테스트를 돌린다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_HISTORY,
  Store,
  UNDO_MS,
  canonicalMenuName,
  cheese,
  menuKey,
  suggestNextRerollCost,
} from '../src/state'

let s: Store
let seq = 0

/** 치지직 도네 한 건 (id는 매번 새로) */
const don = (nick: string, amount: number, message = '', isVideo = false): void =>
  s.handleDonation({ id: `t${++seq}`, nick, amount, message, isVideo })
const names = (): string[] => s.menus.map((m) => m.name)
const menu = (name: string) => {
  const m = s.menus.find((x) => x.name === name)
  if (!m) throw new Error(`메뉴 없음: ${name} (지금: ${names().join(', ')})`)
  return m
}
const lastFeed = (): string => s.feed[0]?.text ?? ''

/** index번째 메뉴가 뽑히도록 Math.random을 맞춰 한 판 돌리고 당첨 발표까지 */
function spinTo(index: number, useCredit = false): void {
  const total = s.totalWeight()
  const before = s.menus.slice(0, index).reduce((a, m) => a + m.weight, 0)
  const spy = vi.spyOn(Math, 'random').mockReturnValue((before + 0.5) / total)
  expect(s.beginSpin(useCredit)).toBe(true)
  s.pickWinner()
  s.finishSpin()
  spy.mockRestore()
}

/** 메뉴 셋을 넣고 0번(짬뽕)이 당첨된 상태 */
function toDecision(): void {
  s.addMenu('짬뽕', 5, '가')
  s.addMenu('짜장', 3, '나')
  s.addMenu('탕수육', 2, '다')
  spinTo(0)
  expect(s.phase).toBe('decision')
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

// ───────────────────────────────────────────────────────────────
describe('메뉴 이름 정리 (순수 함수)', () => {
  it('뒤에 붙은 "추가"를 뗀다 — 띄어쓰기 있든 없든', () => {
    expect(canonicalMenuName(' 부대찌개 추가 ')).toBe('부대찌개')
    expect(canonicalMenuName('부대찌개추가')).toBe('부대찌개')
  })
  it('"추가"만 있으면 뗄 게 없어 그대로, 앞의 "추가"는 건드리지 않는다', () => {
    expect(canonicalMenuName('추가')).toBe('추가')
    expect(canonicalMenuName('추가 메뉴')).toBe('추가 메뉴')
  })
  it('비교 키는 띄어쓰기와 뒤 "추가"를 무시한다', () => {
    expect(menuKey('부대 찌개 추가')).toBe('부대찌개')
    expect(menuKey('부 대 찌 개')).toBe(menuKey('부대찌개'))
    expect(menuKey('짜장')).not.toBe(menuKey('짜장면'))
  })
  it('다음 리롤 금액 추천 — 두 배 이상인 가장 작은 버튼 값, 없으면 두 배', () => {
    expect(suggestNextRerollCost(10000)).toBe(20000)
    expect(suggestNextRerollCost(15000)).toBe(30000)
    expect(suggestNextRerollCost(20000)).toBe(40000)
    expect(suggestNextRerollCost(30000)).toBe(100000)
    expect(suggestNextRerollCost(40000)).toBe(100000)
    expect(suggestNextRerollCost(50000)).toBe(100000)
    expect(suggestNextRerollCost(100000)).toBe(200000)
  })
})

// ───────────────────────────────────────────────────────────────
describe('금액 표시 단위 — 치즈 (원 아님)', () => {
  it('cheese(): 쉼표를 찍고 "치즈"를 붙인다', () => {
    expect(cheese(1000)).toBe('1,000치즈')
    expect(cheese(20000)).toBe('20,000치즈')
    expect(cheese(1_000_000)).toBe('1,000,000치즈')
    expect(cheese(0)).toBe('0치즈')
  })
  it('피드에 남는 모든 금액이 치즈로 적힌다 — 원으로 적힌 줄이 하나도 없다', () => {
    s.addMenu('김밥', 1)
    don('영상', 5000, '짬뽕', true) // 영상 제외
    s.togglePaused()
    don('정지중', 5000, '짬뽕') // 일시정지
    s.togglePaused()
    don('소액', 999, '짬뽕') // 최소 금액 미만
    don('A', 3000, '부대 찌개') // 메뉴 추가
    don('B', 2000, '부대찌개') // 합치기
    s.startClosing(10)
    vi.advanceTimersByTime(10_250)
    don('버저', 2000, '탕수육') // 버저비터
    vi.advanceTimersByTime(5_100)
    don('늦음', 2000, '라면') // 마감 후
    spinTo(0)
    don('대기', 3000, '라면') // 당첨 발표 대기
    s.startRerollWindow(20000, 40000) // 접수 시작 + 다음 금액
    s.setNextRerollCost(40000)
    don('큰손', 20000) // 리롤권
    don('작은손', 10000) // 미만
    s.beginSpin(true) // 금액 인상
    don('딜레이', 20000) // 직전 금액 유예
    don('스핀', 1000, '라면') // 도는 중
    const amounts = s.feed.map((f) => f.text).filter((t) => /\d[\d,]*(원|치즈)/.test(t))
    expect(amounts.length).toBeGreaterThanOrEqual(15)
    for (const t of s.feed.map((f) => f.text)) expect(t).not.toMatch(/\d원/)
    const all = s.feed.map((f) => f.text).join('\n')
    for (const want of ['5,000치즈', '999치즈', '1,000치즈', '20,000치즈', '40,000치즈', '10,000치즈']) {
      expect(all).toContain(want)
    }
  })
})

// ───────────────────────────────────────────────────────────────
describe('도네 → 메뉴 칸', () => {
  it('1,000원당 1칸, 나머지는 버린다', () => {
    don('가', 3000, '차돌짬뽕')
    don('나', 2500, '마라탕')
    expect(menu('차돌짬뽕').weight).toBe(3)
    expect(menu('마라탕').weight).toBe(2)
    expect(lastFeed()).toContain('"마라탕" ×2')
  })
  it('칸당 금액 설정을 따른다', () => {
    s.updateSettings({ wonPerSlot: 2000 })
    don('가', 5000, '짬뽕')
    expect(menu('짬뽕').weight).toBe(2)
  })
  it('상한이 없다 — 100만 원이면 1,000칸', () => {
    don('큰손', 1_000_000, '탕수육')
    expect(menu('탕수육').weight).toBe(1000)
  })
  it('최소 금액 미만은 무시하고 피드에 이유를 남긴다', () => {
    don('가', 999, '짬뽕')
    expect(s.menus).toHaveLength(0)
    expect(lastFeed()).toContain('최소 금액')
  })
  it('최소 금액을 0원으로 해도 한 칸이 안 되는 금액은 메뉴가 생기지 않는다', () => {
    s.updateSettings({ minAmount: 0 })
    don('가', 500, '짬뽕')
    expect(s.menus).toHaveLength(0)
  })
  it('메시지가 비면 "닉네임의 추천"', () => {
    don('철수', 2000, '   ')
    expect(names()).toEqual(['철수의 추천'])
  })
  it('메뉴 이름은 40자에서 자른다', () => {
    don('가', 1000, '가'.repeat(50))
    expect(s.menus[0].name).toHaveLength(40)
  })
  it('영상 도네는 제외', () => {
    don('가', 5000, '짬뽕', true)
    expect(s.menus).toHaveLength(0)
    expect(lastFeed()).toContain('영상')
  })
  it('일시정지 중에는 반영하지 않는다', () => {
    s.togglePaused()
    don('가', 5000, '짬뽕')
    expect(s.menus).toHaveLength(0)
    expect(lastFeed()).toContain('일시정지')
    s.togglePaused()
    don('가', 5000, '짬뽕')
    expect(menu('짬뽕').weight).toBe(5)
  })
  it('같은 이벤트(id)가 두 번 오면 한 번만 반영', () => {
    s.handleDonation({ id: 'same', nick: '가', amount: 3000, message: '짬뽕', isVideo: false })
    s.handleDonation({ id: 'same', nick: '가', amount: 3000, message: '짬뽕', isVideo: false })
    expect(menu('짬뽕').weight).toBe(3)
  })
  it('띄어쓰기·뒤 "추가"만 다른 메뉴는 먼저 등록된 이름 하나로 합쳐진다', () => {
    don('A', 3000, '부대 찌개')
    don('B', 2000, '부대찌개')
    don('C', 1000, '부대찌개 추가')
    expect(s.menus).toHaveLength(1)
    expect(menu('부대 찌개').weight).toBe(6)
    expect(menu('부대 찌개').donors).toEqual(['A', 'B', 'C'])
    expect(lastFeed()).toContain('(="부대찌개")')
  })
  it('같은 사람이 같은 메뉴를 또 쏘면 칸만 늘고 추천자는 한 번만', () => {
    don('A', 1000, '짬뽕')
    don('A', 2000, '짬뽕')
    expect(menu('짬뽕').weight).toBe(3)
    expect(menu('짬뽕').donors).toEqual(['A'])
  })
  it('도네가 메뉴에 반영되면 donation 이벤트로 반영된 이름·칸을 알린다', () => {
    const seen: unknown[] = []
    s.on('donation', (d) => seen.push(d))
    don('A', 3000, '부대 찌개')
    don('B', 2000, '부대찌개')
    expect(seen).toEqual([
      { nick: 'A', amount: 3000, name: '부대 찌개', slots: 3 },
      { nick: 'B', amount: 2000, name: '부대 찌개', slots: 2 },
    ])
  })
})

// ───────────────────────────────────────────────────────────────
describe('단계별 도네 처리 (모집 → 마감 → 버저비터)', () => {
  beforeEach(() => s.addMenu('김밥', 1))

  it('마감 카운트다운 중에는 평소처럼 메뉴에 들어간다', () => {
    s.startClosing(30)
    expect(s.phase).toBe('closing')
    don('가', 3000, '짬뽕')
    expect(menu('짬뽕').weight).toBe(3)
  })
  it('마감 직후 버저비터(기본 5초) 안에 온 도네는 반영된다', () => {
    s.startClosing(30)
    vi.advanceTimersByTime(30_000 + 250)
    expect(s.phase).toBe('closed')
    expect(s.inGrace()).toBe(true)
    don('가', 3000, '짬뽕')
    expect(menu('짬뽕').weight).toBe(3)
    expect(lastFeed()).toContain('⏰ 버저비터!')
  })
  it('버저비터가 끝난 뒤 도네는 반영하지 않는다', () => {
    s.startClosing(30)
    vi.advanceTimersByTime(30_000 + 250 + 5_000 + 100)
    expect(s.inGrace()).toBe(false)
    don('가', 3000, '짬뽕')
    expect(s.menus.some((m) => m.name === '짬뽕')).toBe(false)
    expect(lastFeed()).toContain('마감 후 도착')
  })
  it('버저비터를 0초로 두면 마감 즉시 막힌다', () => {
    s.updateSettings({ graceSec: 0 })
    s.startClosing(30)
    vi.advanceTimersByTime(30_000 + 250)
    expect(s.inGrace()).toBe(false)
    don('가', 3000, '짬뽕')
    expect(s.menus.some((m) => m.name === '짬뽕')).toBe(false)
  })
  it('마감돼도 저절로 돌지 않는다', () => {
    s.startClosing(5)
    vi.advanceTimersByTime(60_000)
    expect(s.phase).toBe('closed')
  })
  it('카운트다운 중 다시 누르면 그만큼 연장', () => {
    s.startClosing(30)
    const first = s.countdownDeadline
    s.startClosing(30)
    expect(s.countdownDeadline - first).toBe(30_000)
  })
  it('마감된 뒤 다시 누르면 다시 받는다 (버저비터는 끝)', () => {
    s.startClosing(10)
    vi.advanceTimersByTime(10_000 + 250)
    expect(s.inGrace()).toBe(true)
    s.startClosing(10)
    expect(s.phase).toBe('closing')
    expect(s.inGrace()).toBe(false)
    don('가', 2000, '짬뽕')
    expect(menu('짬뽕').weight).toBe(2)
  })
  it('후보가 없으면 마감 버튼은 아무 일도 안 한다', () => {
    s.clearMenus()
    s.startClosing(30)
    expect(s.phase).toBe('collect')
  })
  it('도는 중 도네는 무시', () => {
    expect(s.beginSpin()).toBe(true)
    don('가', 3000, '짬뽕')
    expect(s.menus.some((m) => m.name === '짬뽕')).toBe(false)
    expect(lastFeed()).toContain('스핀 중')
  })
  it('당첨 발표 뒤(리롤 접수 전) 도네는 무시', () => {
    spinTo(0)
    don('가', 30000, '짬뽕')
    expect(s.menus.some((m) => m.name === '짬뽕')).toBe(false)
    expect(s.rerollCredits).toBe(0)
    expect(lastFeed()).toContain('당첨 발표 대기 중')
  })
})

// ───────────────────────────────────────────────────────────────
describe('추첨 공정성', () => {
  beforeEach(() => {
    s.addMenu('A', 1)
    s.addMenu('B', 2)
    s.addMenu('C', 3)
  })
  const pickWith = (r: number): number | undefined => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(r)
    s.beginSpin()
    const out = s.pickWinner()?.index
    spy.mockRestore()
    s.finishSpin()
    s.confirmResult()
    return out
  }
  it('난수가 칸 수 구간 어디에 떨어지느냐만으로 정해진다 (경계 포함)', () => {
    expect(pickWith(0)).toBe(0)
    expect(pickWith(0.1666)).toBe(0)
    expect(pickWith(1 / 6)).toBe(1)
    expect(pickWith(0.4999)).toBe(1)
    expect(pickWith(0.5)).toBe(2)
    expect(pickWith(0.9999)).toBe(2)
  })
  it('누른 시각과 무관 — 같은 난수면 언제 눌러도 같은 결과', () => {
    const a = pickWith(0.42)
    vi.setSystemTime(new Date('2027-01-01T03:33:33Z'))
    vi.advanceTimersByTime(1234)
    expect(pickWith(0.42)).toBe(a)
  })
  it('돌고 있을 때만 뽑는다', () => {
    expect(s.pickWinner()).toBeNull()
  })
  it('당첨 확률 = 그 메뉴 칸 / 전체 칸', () => {
    spinTo(2)
    expect(s.winner?.name).toBe('C')
    expect(s.winnerChance).toBeCloseTo(50, 10)
  })
  it('3만 번 뽑으면 칸 비율대로 나온다 (50/30/15/5, ±1.5%p)', () => {
    s.clearMenus()
    s.addMenu('50', 50)
    s.addMenu('30', 30)
    s.addMenu('15', 15)
    s.addMenu('5', 5)
    const n = 30_000
    const count = [0, 0, 0, 0]
    s.beginSpin()
    for (let i = 0; i < n; i++) count[s.pickWinner()!.index]++
    const pct = count.map((c) => (c / n) * 100)
    ;[50, 30, 15, 5].forEach((want, i) => expect(Math.abs(pct[i] - want)).toBeLessThan(1.5))
  })
})

// ───────────────────────────────────────────────────────────────
describe('리롤', () => {
  beforeEach(toDecision)

  it('접수는 당첨 발표 상태에서만 열린다', () => {
    s.confirmResult()
    s.startRerollWindow(20000)
    expect(s.phase).toBe('collect')
  })
  it('1,000원 미만 금액은 무시하고 설정값을 쓴다', () => {
    s.startRerollWindow(500)
    expect(s.effectiveRerollCost()).toBe(20000)
  })
  it('단일 도네가 금액 이상이면 리롤권 1개, 미만이면 무시', () => {
    s.startRerollWindow(20000)
    don('큰손', 20000)
    expect(s.rerollCredits).toBe(1)
    don('작은손', 19999)
    expect(s.rerollCredits).toBe(1)
    expect(lastFeed()).toContain('미만')
  })
  it('여러 번 나눠 쏜 금액은 합산하지 않는다', () => {
    s.startRerollWindow(20000)
    don('가', 10000)
    don('가', 10000)
    expect(s.rerollCredits).toBe(0)
  })
  it('접수 중 리롤 도네는 메뉴로 들어가지 않는다', () => {
    s.startRerollWindow(20000)
    don('가', 30000, '마라탕')
    expect(s.menus.some((m) => m.name === '마라탕')).toBe(false)
  })
  it('여러 명이 사면 쌓이고 구매자가 순서대로 남는다', () => {
    s.startRerollWindow(20000)
    don('A', 20000)
    don('B', 50000)
    don('C', 20000)
    expect(s.rerollCredits).toBe(3)
    expect(s.rerollUsers).toEqual(['A', 'B', 'C'])
  })
  it('접수 시간이 끝나도 확정 전까지는 리롤 도네를 인정 (자동 확정 없음)', () => {
    s.startRerollWindow(20000)
    vi.advanceTimersByTime(60_000 + 250)
    expect(s.phase).toBe('decision')
    expect(s.windowOpened).toBe(true)
    don('늦은', 20000)
    expect(s.rerollCredits).toBe(1)
    expect(lastFeed()).toContain('확정 전 도착분 인정')
  })
  it('리롤권이 없으면 리롤로 돌 수 없다', () => {
    s.startRerollWindow(20000)
    expect(s.beginSpin(true)).toBe(false)
    expect(s.phase).toBe('window')
  })
  it('리롤을 쓰면 리롤권 -1, 리롤 횟수 +1, 도는 동안에도 리롤 도네를 받는다', () => {
    s.startRerollWindow(20000)
    don('A', 20000)
    don('B', 20000)
    expect(s.beginSpin(true)).toBe(true)
    expect(s.rerollCredits).toBe(1)
    expect(s.rerollCount).toBe(1)
    don('C', 20000)
    expect(s.rerollCredits).toBe(2)
    expect(lastFeed()).toContain('돌아가는 동안 미리 접수')
  })
  it('리롤권이 남아 있으면 금액은 오르지 않는다', () => {
    s.startRerollWindow(20000, 40000)
    don('A', 20000)
    don('B', 20000)
    s.beginSpin(true)
    expect(s.effectiveRerollCost()).toBe(20000)
    expect(s.nextRerollCost).toBe(40000)
  })
  it('마지막 리롤권을 쓰는 순간 정해 둔 다음 금액으로 오른다', () => {
    s.startRerollWindow(20000, 40000)
    don('A', 20000)
    s.beginSpin(true)
    expect(s.effectiveRerollCost()).toBe(40000)
    expect(s.nextRerollCost).toBeNull()
    expect(s.feed.some((f) => f.text.includes('다음 리롤 접수'))).toBe(true)
  })
  it('다음 금액을 안 정했으면 마지막 리롤권을 써도 금액은 그대로', () => {
    s.startRerollWindow(20000, null)
    don('A', 20000)
    s.beginSpin(true)
    expect(s.effectiveRerollCost()).toBe(20000)
  })
  it('다음 금액: 생략하면 유지, null이면 지움, 1,000원 미만이면 안 정함', () => {
    s.setNextRerollCost(50000)
    s.startRerollWindow(20000)
    expect(s.nextRerollCost).toBe(50000)
    s.setNextRerollCost(null)
    expect(s.nextRerollCost).toBeNull()
    s.setNextRerollCost(999)
    expect(s.nextRerollCost).toBeNull()
  })
  it('[다음 없이 돌리기] 뒤에는 리롤 도네가 더 쌓이지 않는다', () => {
    s.startRerollWindow(20000)
    don('A', 20000)
    s.endRerollSales()
    spinTo(1, true)
    don('B', 20000)
    expect(s.rerollCredits).toBe(0)
  })

  describe('금액이 오른 직후 직전 금액 유예 (방송 딜레이)', () => {
    beforeEach(() => {
      s.startRerollWindow(20000, 40000)
      don('A', 20000)
      s.beginSpin(true) // 2만 → 4만
    })
    it('화면 금액은 오른 금액, 받아주는 기준은 잠깐 직전 금액', () => {
      expect(s.effectiveRerollCost()).toBe(40000)
      expect(s.acceptedRerollCost()).toBe(20000)
    })
    it('유예 안에 도착한 직전 금액 도네는 리롤권, 피드에 이유가 남는다', () => {
      don('늦은', 20000)
      expect(s.rerollCredits).toBe(1)
      expect(lastFeed()).toContain('올리기 직전 금액')
    })
    it('직전 금액보다 적으면 유예 중에도 거절', () => {
      don('적은', 19999)
      expect(s.rerollCredits).toBe(0)
    })
    it('유예(기본 5초)가 지나면 오른 금액만 인정', () => {
      vi.advanceTimersByTime(5_001)
      expect(s.acceptedRerollCost()).toBe(40000)
      don('늦은', 20000)
      expect(s.rerollCredits).toBe(0)
      don('새', 40000)
      expect(s.rerollCredits).toBe(1)
      expect(lastFeed()).not.toContain('올리기 직전 금액')
    })
  })
  it('버저비터 0초면 금액 인상 유예도 없다', () => {
    s.updateSettings({ graceSec: 0 })
    s.startRerollWindow(20000, 40000)
    don('A', 20000)
    s.beginSpin(true)
    expect(s.acceptedRerollCost()).toBe(40000)
  })

  it('확정하면 리롤 상태가 전부 처음으로 — 다음 판의 2만 원은 메뉴 20칸', () => {
    s.startRerollWindow(30000, 50000)
    don('A', 30000)
    s.confirmResult()
    expect(s.phase).toBe('collect')
    expect(s.rerollCredits).toBe(0)
    expect(s.windowOpened).toBe(false)
    expect(s.nextRerollCost).toBeNull()
    expect(s.effectiveRerollCost()).toBe(20000)
    don('B', 20000, '마라탕')
    expect(menu('마라탕').weight).toBe(20)
  })
})

// ───────────────────────────────────────────────────────────────
describe('결과 확정 · 기록', () => {
  it('확정하면 기록에 이름·당첨·확률·리롤 횟수·그때 후보가 남는다', () => {
    s.setTitle('메인 메뉴')
    toDecision()
    s.confirmResult()
    const r = s.history[0]
    expect(r.title).toBe('메인 메뉴')
    expect(r.winner).toBe('짬뽕')
    expect(r.chance).toBeCloseTo(50, 10)
    expect(r.rerollCount).toBe(0)
    expect(r.menus.map((m) => `${m.name}×${m.weight}`)).toEqual(['짬뽕×5', '짜장×3', '탕수육×2'])
    expect(s.confirmedWinner).toBe('짬뽕')
    expect(s.menus).toHaveLength(3) // 후보는 남는다
  })
  it('당첨 발표 전에는 확정할 수 없다', () => {
    s.addMenu('짬뽕', 1)
    s.confirmResult()
    expect(s.history).toHaveLength(0)
  })
  it(`기록은 최근 ${MAX_HISTORY}개까지`, () => {
    s.addMenu('짬뽕', 1)
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      spinTo(0)
      s.confirmResult()
    }
    expect(s.history).toHaveLength(MAX_HISTORY)
  })
  it('판 이름은 앞뒤 공백만 지우고 길이 제한이 없다 (임의 제약 금지)', () => {
    s.setTitle('  디저트  ')
    expect(s.title).toBe('디저트')
    s.setTitle('가'.repeat(100))
    expect(s.title).toHaveLength(100)
  })
  it('판 이름은 확정 뒤에도 다음 판으로 이어진다', () => {
    s.setTitle('사이드')
    toDecision()
    s.confirmResult()
    expect(s.title).toBe('사이드')
  })
})

// ───────────────────────────────────────────────────────────────
describe('[↩ 메뉴 추가로 돌아가기]', () => {
  it('기록 없이 모집으로 — 메뉴·칸·추천자는 그대로, 리롤 상태만 비운다', () => {
    toDecision()
    s.startRerollWindow(20000, 40000)
    don('A', 20000)
    const before = JSON.stringify(s.menus)
    s.backToCollect()
    expect(s.phase).toBe('collect')
    expect(s.history).toHaveLength(0)
    expect(JSON.stringify(s.menus)).toBe(before)
    expect(s.rerollCredits).toBe(0)
    expect(s.windowOpened).toBe(false)
    expect(s.nextRerollCost).toBeNull()
    don('B', 20000, '마라탕')
    expect(menu('마라탕').weight).toBe(20)
  })
  it('모집 중에는 아무 일도 안 한다', () => {
    s.addMenu('짬뽕', 1)
    const feedLen = s.feed.length
    s.backToCollect()
    expect(s.feed.length).toBe(feedLen)
  })
})

// ───────────────────────────────────────────────────────────────
describe('메뉴 이름 고치기', () => {
  beforeEach(() => {
    don('A', 2000, '짜장')
    don('B', 4000, '짜장면')
    don('C', 1000, '탕수육')
  })

  it('같은 이름이 없으면 이름만 바뀐다 (칸·추천자 그대로)', () => {
    s.renameMenu(menu('탕수육').id, '꿔바로우')
    expect(names()).toEqual(['짜장', '짜장면', '꿔바로우'])
    expect(menu('꿔바로우').weight).toBe(1)
    expect(menu('꿔바로우').donors).toEqual(['C'])
    expect(lastFeed()).toContain('메뉴 이름 변경')
  })
  it('이름만 바뀌어도 목록 배열을 새로 만든다 (원판 그림 캐시가 다시 그리게)', () => {
    const before = s.menus
    s.renameMenu(menu('탕수육').id, '꿔바로우')
    expect(s.menus).not.toBe(before)
  })
  it('이름 정리 규칙은 추가 때와 같다 — 뒤 "추가" 떼기, 40자', () => {
    s.renameMenu(menu('탕수육').id, '꿔바로우 추가')
    expect(names()).toContain('꿔바로우')
    s.renameMenu(menu('꿔바로우').id, '나'.repeat(60))
    expect(s.menus.find((m) => m.donors.includes('C'))!.name).toHaveLength(40)
  })
  it('빈 이름·같은 이름이면 아무 일도 없다', () => {
    const feedLen = s.feed.length
    s.renameMenu(menu('탕수육').id, '   ')
    s.renameMenu(menu('탕수육').id, '탕수육')
    expect(names()).toEqual(['짜장', '짜장면', '탕수육'])
    expect(s.feed.length).toBe(feedLen)
    expect(s.undoable).toBeNull()
  })
  it('이미 있는 메뉴 이름이면 칸·추천자를 그쪽으로 합치고, 이름·자리는 원래 있던 쪽', () => {
    s.renameMenu(menu('짜장').id, '짜장면')
    expect(names()).toEqual(['짜장면', '탕수육'])
    expect(menu('짜장면').weight).toBe(6)
    expect(menu('짜장면').donors).toEqual(['B', 'A'])
    expect(lastFeed()).toContain('합쳤습니다')
  })
  it('띄어쓰기·뒤 "추가"가 달라도 같은 메뉴로 본다', () => {
    s.renameMenu(menu('짜장').id, '짜장 면 추가')
    expect(names()).toEqual(['짜장면', '탕수육'])
    expect(menu('짜장면').weight).toBe(6)
  })
  it('겹치는 추천자는 한 번만', () => {
    don('B', 1000, '짜장') // B가 짜장에도 쐈다
    s.renameMenu(menu('짜장').id, '짜장면')
    expect(menu('짜장면').donors).toEqual(['B', 'A'])
  })
  it('당첨 메뉴를 합치면 당첨도 합친 쪽으로 (확정 기록도)', () => {
    spinTo(0) // 짜장 당첨
    expect(s.winner?.name).toBe('짜장')
    s.renameMenu(menu('짜장').id, '짜장면')
    expect(s.winner).toBe(menu('짜장면'))
    s.confirmResult()
    expect(s.history[0].winner).toBe('짜장면')
  })
})

// ───────────────────────────────────────────────────────────────
describe('되돌리기 (지우기·합치기)', () => {
  beforeEach(() => {
    don('A', 2000, '짜장')
    don('B', 4000, '짜장면')
    don('C', 1000, '탕수육')
  })

  it('지운 메뉴를 원래 자리·칸·추천자 그대로 되돌린다', () => {
    s.removeMenu(menu('짜장면').id)
    expect(names()).toEqual(['짜장', '탕수육'])
    s.undo()
    expect(names()).toEqual(['짜장', '짜장면', '탕수육'])
    expect(menu('짜장면').weight).toBe(4)
    expect(menu('짜장면').donors).toEqual(['B'])
    expect(lastFeed()).toContain('↶ 되돌림')
    expect(s.undoable).toBeNull()
  })
  it(`${UNDO_MS / 1000}초 안에만 된다`, () => {
    s.removeMenu(menu('짜장면').id)
    vi.advanceTimersByTime(UNDO_MS - 1)
    s.undo()
    expect(names()).toContain('짜장면')

    s.removeMenu(menu('탕수육').id)
    vi.advanceTimersByTime(UNDO_MS + 1)
    s.undo()
    expect(names()).not.toContain('탕수육')
  })
  it('지운 사이 같은 메뉴 도네가 와서 새로 생겼으면, 되돌릴 때 그 칸·추천자까지 하나로', () => {
    s.removeMenu(menu('짜장면').id)
    don('D', 3000, '짜장 면')
    s.undo()
    expect(names()).toEqual(['짜장', '짜장면', '탕수육'])
    expect(menu('짜장면').weight).toBe(7)
    expect(menu('짜장면').donors).toEqual(['B', 'D'])
  })
  it('[−]로 0칸이 돼 빠진 메뉴도 원래 칸으로 되돌린다', () => {
    s.changeWeight(menu('짜장면').id, -10)
    expect(names()).not.toContain('짜장면')
    s.undo()
    expect(menu('짜장면').weight).toBe(4)
    expect(names()).toEqual(['짜장', '짜장면', '탕수육'])
  })
  it('칸만 줄고 남아 있으면 되돌리기 대상이 아니다', () => {
    s.changeWeight(menu('짜장면').id, -1)
    expect(s.undoable).toBeNull()
  })
  it('합친 것을 되돌리면 칸·추천자·이름·자리가 원래대로', () => {
    s.renameMenu(menu('짜장').id, '짜장면')
    s.undo()
    expect(names()).toEqual(['짜장', '짜장면', '탕수육'])
    expect(menu('짜장').weight).toBe(2)
    expect(menu('짜장').donors).toEqual(['A'])
    expect(menu('짜장면').weight).toBe(4)
    expect(menu('짜장면').donors).toEqual(['B'])
  })
  it('합친 사이 들어온 도네는 되돌려도 남는다', () => {
    s.renameMenu(menu('짜장').id, '짜장면')
    don('E', 5000, '짜장면')
    s.undo()
    expect(menu('짜장').weight).toBe(2)
    expect(menu('짜장면').weight).toBe(9)
    expect(menu('짜장면').donors).toEqual(['B', 'E'])
  })
  it('당첨 메뉴를 합쳤다가 되돌리면 당첨도 원래 메뉴로', () => {
    spinTo(0)
    const won = s.winner
    s.renameMenu(menu('짜장').id, '짜장면')
    s.undo()
    expect(s.winner).toBe(won)
    expect(s.winner?.name).toBe('짜장')
  })
  it('마지막 한 번만 되돌린다', () => {
    s.removeMenu(menu('짜장').id)
    s.removeMenu(menu('탕수육').id)
    s.undo()
    s.undo()
    expect(names()).toEqual(['짜장면', '탕수육'])
  })
  it('리롤권 없이 [리롤]을 눌러 돌지 않았으면 되돌리기는 그대로', () => {
    spinTo(0)
    s.removeMenu(menu('탕수육').id)
    expect(s.beginSpin(true)).toBe(false)
    s.undo()
    expect(names()).toContain('탕수육')
  })
  it('돌기 시작하면 되돌리기는 사라진다 (원판 칸이 바뀌면 착지가 어긋난다)', () => {
    s.removeMenu(menu('짜장').id)
    s.beginSpin()
    expect(s.undoable).toBeNull()
    s.undo()
    expect(names()).not.toContain('짜장')
  })
  it('전체 비우기·메뉴 불러오기 뒤에는 되돌리지 않는다', () => {
    s.removeMenu(menu('짜장').id)
    s.clearMenus()
    expect(s.undoable).toBeNull()

    don('A', 2000, '짜장')
    s.removeMenu(menu('짜장').id)
    s.importMenusJson(JSON.stringify({ menus: [{ name: '김밥', weight: 1 }] }))
    s.undo()
    expect(names()).toEqual(['김밥'])
  })
})

// ───────────────────────────────────────────────────────────────
describe('새로고침 복원 (localStorage)', () => {
  it('메뉴·판 이름·기록·설정·일시정지가 이어진다', () => {
    s.updateSettings({ rerollCost: 30000, graceSec: 3 })
    s.setTitle('디저트')
    toDecision()
    s.confirmResult()
    s.togglePaused()
    const t = new Store()
    expect(t.menus.map((m) => m.name)).toEqual(['짬뽕', '짜장', '탕수육'])
    expect(t.title).toBe('디저트')
    expect(t.history[0].winner).toBe('짬뽕')
    expect(t.settings.rerollCost).toBe(30000)
    expect(t.settings.graceSec).toBe(3)
    expect(t.paused).toBe(true)
    expect(t.confirmedWinner).toBe('짬뽕')
    expect(t.phase).toBe('collect')
  })
  it('당첨 발표 중이면 당첨·리롤권·금액·접수 상태를 이어받는다', () => {
    toDecision()
    s.startRerollWindow(30000, 50000)
    don('A', 30000)
    vi.advanceTimersByTime(60_000 + 250) // 접수 시간 끝
    const t = new Store()
    expect(t.phase).toBe('decision')
    expect(t.winner?.name).toBe('짬뽕')
    expect(t.rerollCredits).toBe(1)
    expect(t.effectiveRerollCost()).toBe(30000)
    expect(t.nextRerollCost).toBe(50000)
    expect(t.windowOpened).toBe(true)
  })
  it('리롤 접수 중이면 남은 시간부터 이어서 센다', () => {
    toDecision()
    s.startRerollWindow(20000)
    vi.advanceTimersByTime(20_000)
    const t = new Store()
    expect(t.phase).toBe('window')
    expect(t.countdownDeadline).toBe(s.countdownDeadline)
  })
  it('복원된 당첨은 목록의 같은 메뉴 객체 — 새로고침 뒤 당첨 메뉴를 합쳐도 따라간다', () => {
    toDecision()
    const t = new Store()
    expect(t.winner).toBe(t.menus.find((m) => m.name === '짬뽕'))
    t.renameMenu(t.winner!.id, '짜장')
    expect(t.winner?.name).toBe('짜장')
    expect(t.winner?.weight).toBe(8)
  })
  it('저장값 하나가 깨져도 나머지는 살아난다', () => {
    toDecision()
    s.confirmResult()
    localStorage.setItem('mr:menus', '{깨진 JSON')
    const t = new Store()
    expect(t.menus).toEqual([])
    expect(t.history).toHaveLength(1)
  })
})

// ───────────────────────────────────────────────────────────────
describe('메뉴 파일 불러오기·내보내기', () => {
  it('불러오면 목록을 통째로 바꾸고, 파일 안 같은 메뉴는 먼저 나온 쪽으로 합친다', () => {
    s.addMenu('지울것', 1)
    const n = s.importMenusJson(
      JSON.stringify({
        menus: [
          { name: '부대 찌개', weight: 3, donors: ['A'] },
          { name: '부대찌개 추가', weight: 2, donors: ['B', 'A'] },
          { name: '김밥', weight: 0 },
          { name: '라면', weight: 2.7 },
          { name: '   ' },
        ],
      }),
    )
    expect(n).toBe(3)
    expect(names()).toEqual(['부대 찌개', '김밥', '라면'])
    expect(menu('부대 찌개').weight).toBe(5)
    expect(menu('부대 찌개').donors).toEqual(['A', 'B'])
    expect(menu('김밥').weight).toBe(1) // 0칸은 1칸으로
    expect(menu('라면').weight).toBe(2) // 소수는 버림
  })
  it('형식이 틀리면 오류를 내고 목록은 그대로', () => {
    s.addMenu('짬뽕', 1)
    expect(() => s.importMenusJson('{깨짐')).toThrow()
    expect(() => s.importMenusJson('{"foo":1}')).toThrow('menus')
    expect(() => s.importMenusJson('{"menus":[]}')).toThrow('불러올 메뉴가 없습니다')
    expect(names()).toEqual(['짬뽕'])
  })
  it('내보낸 파일을 다시 불러오면 이름·칸·추천자가 같다', () => {
    don('A', 3000, '짬뽕')
    don('B', 2000, '짜장')
    don('C', 1000, '짬뽕')
    const json = s.exportMenusJson()
    const before = s.menus.map((m) => [m.name, m.weight, m.donors])
    s.clearMenus()
    s.importMenusJson(json)
    expect(s.menus.map((m) => [m.name, m.weight, m.donors])).toEqual(before)
  })
})
