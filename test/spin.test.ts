// 회전 궤적과 경계 통과 시각(spin.ts) — 딸깍 소리·포인터 위 이름·흰 번쩍임·포인터 튕김이 같은 박자인지의 근거
import { describe, expect, it } from 'vitest'
import { TAU, boundaryIndexAt, crossings, easeOutCubic, freeTurn, tickBoundaries } from '../src/spin'

const MAX = TAU * 3.6
const ACCEL = 800
const POINTER = -Math.PI / 2
const mod = (a: number): number => ((a % TAU) + TAU) % TAU

/** 칸 비율(weights)로 0부터 이어진 칸을 만든다 */
function segsOf(weights: number[]): { start: number; end: number }[] {
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  return weights.map((w) => {
    const start = (acc / total) * TAU
    acc += w
    return { start, end: (acc / total) * TAU }
  })
}

/** 회전량 r일 때 포인터 아래 칸 번호 (roulette.ts indexAtPointer와 같은 식) */
function segAt(segs: { start: number; end: number }[], r: number): number {
  const a = mod(POINTER - r)
  return segs.findIndex((s) => a >= s.start && a < s.end)
}

describe('자유 회전 궤적', () => {
  it('0에서 시작하고 늘기만 한다', () => {
    expect(freeTurn(0, MAX, ACCEL)).toBe(0)
    let prev = -1
    for (let t = 0; t <= 3000; t += 7) {
      const r = freeTurn(t, MAX, ACCEL)
      expect(r).toBeGreaterThan(prev)
      prev = r
    }
  })
  it('가속 구간 속도는 easeOutQuad, 다 붙은 뒤엔 최고 속도 그대로', () => {
    const v = (t: number): number => (freeTurn(t + 0.01, MAX, ACCEL) - freeTurn(t - 0.01, MAX, ACCEL)) / 0.00002
    expect(v(400)).toBeCloseTo(MAX * (1 - (1 - 0.5) ** 2), 3)
    expect(v(ACCEL)).toBeCloseTo(MAX, 3) // 가속 끝에서 속도가 끊기지 않는다
    expect(freeTurn(ACCEL + 1000, MAX, ACCEL) - freeTurn(ACCEL, MAX, ACCEL)).toBeCloseTo(MAX, 9)
  })
})

describe('딸깍 경계', () => {
  it('칸 경계는 전부 들어가고(edge), 오름차순이다', () => {
    const segs = segsOf([5, 1, 30, 2, 12])
    const b = tickBoundaries(segs, 24)
    expect(b.filter((x) => x.edge).map((x) => x.angle)).toEqual(segs.map((s) => s.start))
    for (let i = 1; i < b.length; i++) expect(b[i].angle).toBeGreaterThan(b[i - 1].angle)
  })
  it('메뉴가 적어도 한 바퀴에 24번 이상 — 경계 사이가 TAU/24를 넘지 않는다', () => {
    for (const w of [[1], [1, 1], [1, 9, 3], [37, 1, 1, 1]]) {
      const b = tickBoundaries(segsOf(w), 24)
      expect(b.length).toBeGreaterThanOrEqual(24)
      const angles = [...b.map((x) => x.angle), TAU]
      for (let i = 1; i < angles.length; i++) expect(angles[i] - angles[i - 1]).toBeLessThanOrEqual(TAU / 24 + 1e-9)
    }
  })
  it('120종이면 핀을 더 박지 않는다 (칸 경계만)', () => {
    const segs = segsOf(Array.from({ length: 120 }, (_, i) => (i % 7) + 1))
    const b = tickBoundaries(segs, 24)
    // 가장 큰 칸(7칸/480칸 ≈ TAU/68)도 TAU/24보다 작다
    expect(b).toHaveLength(120)
    expect(b.every((x) => x.edge)).toBe(true)
  })
  it('각도가 몇 번째 구간인지 이분 탐색', () => {
    const b = tickBoundaries(segsOf([1, 1, 1, 1]), 4)
    expect(boundaryIndexAt(0, b)).toBe(0)
    expect(boundaryIndexAt(TAU / 4 - 1e-9, b)).toBe(0)
    expect(boundaryIndexAt(TAU / 4, b)).toBe(1)
    expect(boundaryIndexAt(TAU - 1e-9, b)).toBe(3)
  })
})

describe('경계 통과 시각', () => {
  // 감속: 9초 동안 30바퀴 → easeOutCubic
  const D = 9000
  const range = 30 * TAU + 1.234
  const rot0 = 0.4
  const stopRot = (t: number): number => rot0 + range * easeOutCubic(Math.min(1, Math.max(0, t / D)))

  it('통과 시각의 회전량은 정확히 그 경계 자리다', () => {
    const b = tickBoundaries(segsOf([5, 1, 30, 2, 12]), 24)
    const cs = crossings(stopRot, 0, D, b, POINTER)
    expect(cs.length).toBeGreaterThan(30 * 24)
    for (const c of cs) {
      const a = mod(POINTER - stopRot(c.at))
      const nearest = Math.min(...b.map((x) => Math.min(Math.abs(x.angle - a), TAU - Math.abs(x.angle - a))))
      expect(nearest).toBeLessThan(1e-4)
    }
    for (let i = 1; i < cs.length; i++) expect(cs[i].at).toBeGreaterThanOrEqual(cs[i - 1].at)
  })

  it('딸깍 = 포인터 위 이름이 바뀌는 순간 — 칸 경계(edge) 통과 직전·직후 칸이 다르고, 핀이면 같다', () => {
    const segs = segsOf(Array.from({ length: 120 }, (_, i) => (i % 7) + 1).concat([40]))
    const b = tickBoundaries(segs, 24)
    const cs = crossings(stopRot, 0, D, b, POINTER)
    for (const c of cs) {
      const before = segAt(segs, stopRot(c.at - 0.01))
      const after = segAt(segs, stopRot(c.at + 0.01))
      if (c.edge) expect(after).not.toBe(before)
      else expect(after).toBe(before)
    }
    // 반대로, 이름이 바뀌는 순간마다 딸깍이 하나씩 있다 (빠짐없음) — 이름이 눈에 보이게 바뀌는 감속 후반을
    // 0.05ms 간격으로 훑어 센 횟수와 같다 (초반엔 칸이 0.2ms 만에 지나가 훑기로는 못 센다)
    let changes = 0
    let prev = segAt(segs, stopRot(D / 2))
    for (let t = D / 2 + 0.05; t <= D; t += 0.05) {
      const cur = segAt(segs, stopRot(t))
      if (cur !== prev) changes++
      prev = cur
    }
    expect(cs.filter((c) => c.edge && c.at > D / 2).length).toBe(changes)
  })

  it('구간을 나눠 물어도 겹치거나 빠지지 않는다 (0.12초씩 예약하는 스케줄러와 같은 방식)', () => {
    const b = tickBoundaries(segsOf([3, 1, 4, 1, 5, 9, 2, 6]), 24)
    const whole = crossings(stopRot, 0, D, b, POINTER).map((c) => c.at)
    const pieces: number[] = []
    for (let t = 0; t < D; t += 120) pieces.push(...crossings(stopRot, t, Math.min(D, t + 120), b, POINTER).map((c) => c.at))
    expect(pieces).toHaveLength(whole.length)
    pieces.forEach((t, i) => expect(t).toBeCloseTo(whole[i], 2)) // 0.005ms 안
  })

  it('자유 회전도 같은 식으로 — 300종·최고 속도에서 1초에 약 1,080번', () => {
    const b = tickBoundaries(segsOf(Array.from({ length: 300 }, () => 1)), 24)
    const rot = (t: number): number => 0.1 + freeTurn(t, MAX, ACCEL)
    const cs = crossings(rot, ACCEL, ACCEL + 1000, b, POINTER)
    expect(Math.abs(cs.length - 3.6 * 300)).toBeLessThanOrEqual(1)
  })

  it('멈춰 있거나 시간이 거꾸로면 없다', () => {
    const b = tickBoundaries(segsOf([1, 1]), 24)
    expect(crossings(() => 1, 0, 1000, b, POINTER)).toEqual([])
    expect(crossings(stopRot, 500, 100, b, POINTER)).toEqual([])
    expect(crossings(stopRot, D, D + 1000, b, POINTER)).toEqual([]) // 다 멈춘 뒤
  })
})
