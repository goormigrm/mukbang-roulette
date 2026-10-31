// 한글 줄바꿈 도우미(text.ts) — 문장을 "끊어도 되는 자리"로만 나누는지
import { describe, expect, it } from 'vitest'
import { koPhrases } from '../src/text'

const SAMPLES = [
  '🔒 모집 마감 — 더 이상 메뉴가 추가되지 않습니다. [돌리기!]를 누르세요',
  '단일 도네 3,000원 이상이면 리롤권 적립!',
  '🎉 당첨: "마라샹궈 8번" (확률 1.19%)',
  '늦게 온 도네를 넣어주고 싶으면 후보 목록에서 직접 추가하세요',
  '[늦은2만] 20,000원 — 리롤 비용(40,000원) 미만이라 반영 안 됨',
  '🔄 [둘째] 20,000원 — 리롤권 +1 (보유 1개) · 돌아가는 동안 미리 접수 · 올리기 직전 금액으로 도착, 인정',
]

describe('koPhrases', () => {
  it('빈 문장은 빈 목록', () => {
    expect(koPhrases('')).toEqual([])
    expect(koPhrases('   ')).toEqual([])
  })
  it('어절을 빼먹거나 순서를 바꾸지 않는다', () => {
    for (const t of SAMPLES) {
      expect(koPhrases(t).join(' ')).toBe(t.split(/\s+/).filter(Boolean).join(' '))
    }
  })
  it('조사로 끝난 어절은 뒤와 붙는다 ("메뉴가 / 추가되지"로 갈리지 않게)', () => {
    expect(koPhrases(SAMPLES[0])).toContain('메뉴가 추가되지 않습니다.')
  })
  it('"이상"·"않" 같은 말은 앞 어절에 붙는다', () => {
    expect(koPhrases(SAMPLES[1])).toContain('3,000원 이상이면')
  })
  it('꾸미는 부사는 뒤와 붙는다', () => {
    expect(koPhrases(SAMPLES[0])).toContain('더 이상')
  })
  it('따옴표·괄호 안은 한 덩어리', () => {
    const p = koPhrases(SAMPLES[2])
    expect(p).toContain('"마라샹궈 8번"')
    expect(p).toContain('(확률 1.19%)')
    expect(koPhrases('(필요하면 직접 추가)')).toEqual(['(필요하면 직접 추가)'])
  })
  it('덩어리는 18자를 넘지 않는다 — 넘으면 꼭 붙어야 하는 두 어절뿐', () => {
    for (const t of SAMPLES) {
      for (const p of koPhrases(t)) expect(p.length <= 18 || p.split(' ').length <= 2).toBe(true)
    }
  })
})
