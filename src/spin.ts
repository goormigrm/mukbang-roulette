// 회전 궤적과 "포인터가 칸·핀 경계를 지나는 순간" 계산.
// 딸깍 소리 · 포인터 위 이름 · 흰 번쩍임 · 포인터 튕김이 모두 이 계산 하나에서 나온다 —
// 예전에는 소리는 평균 속도로, 번쩍임은 따로 도는 사인파로 움직여 셋이 따로 놀았다.
// 회전량을 시간만의 함수로 두면 앞으로 경계를 지날 시각을 미리 알 수 있어 소리를 그 순간에 예약할 수 있다.

export const TAU = Math.PI * 2

/** 자유 회전: 시작 뒤 elapsedMs 동안 돈 각도(rad). 처음 accelMs 동안 easeOutQuad로 maxSpeed(rad/s)까지 붙는다 */
export function freeTurn(elapsedMs: number, maxSpeed: number, accelMs: number): number {
  const t = Math.max(0, elapsedMs)
  const tc = Math.min(t, accelMs)
  // 속도 v(τ) = max·(1 − (1 − τ/A)²) 를 0~t 동안 적분한 값
  const accelPart = tc - (accelMs / 3) * (1 - Math.pow(1 - tc / accelMs, 3))
  return (maxSpeed * (accelPart + Math.max(0, t - accelMs))) / 1000
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** 딸깍이 나는 자리 (원판 위 각도). edge = 칸 경계 — 포인터 위 이름이 바뀌는 자리 */
export interface Boundary {
  angle: number
  edge: boolean
}

/** 칸 경계는 전부, 한 칸이 TAU/pegs보다 크면 안쪽에 핀을 고르게 더 박는다
 *  (메뉴가 몇 개 안 될 때도 한 바퀴에 최소 pegs번은 딸깍이게). segs는 0부터 차례로 이어진 칸 */
export function tickBoundaries(segs: { start: number; end: number }[], pegs: number): Boundary[] {
  const out: Boundary[] = []
  const step = TAU / pegs
  for (const { start, end } of segs) {
    const n = Math.max(1, Math.ceil((end - start) / step - 1e-9))
    for (let j = 0; j < n; j++) out.push({ angle: start + ((end - start) * j) / n, edge: j === 0 })
  }
  return out
}

/** 원판 위 각도 a가 몇 번째 경계 구간에 있는가 (a 이하인 마지막 경계) */
export function boundaryIndexAt(a: number, bounds: Boundary[]): number {
  let lo = 0
  let hi = bounds.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bounds[mid].angle <= a) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface Crossing {
  /** 지나는 시각 (rotAt과 같은 시계, ms) */
  at: number
  edge: boolean
}

/** [t0, t1) 동안 포인터가 지나는 경계와 그 시각 (빠른 것부터).
 *  rotAt은 시간에 대해 줄지 않는 회전량, pointer는 포인터가 있는 화면 각도.
 *  포인터가 가리키는 원판 각도는 pointer − rot 이므로, 경계 b를 지나는 순간은 rot = pointer − b − k·TAU 인 순간이다 */
export function crossings(
  rotAt: (t: number) => number,
  t0: number,
  t1: number,
  bounds: Boundary[],
  pointer: number,
): Crossing[] {
  if (!(t1 > t0) || bounds.length === 0) return []
  const r0 = rotAt(t0)
  const r1 = rotAt(t1)
  if (!(r1 > r0)) return []
  const out: Crossing[] = []
  for (const b of bounds) {
    const base = pointer - b.angle
    // r0 < base − k·TAU ≤ r1 을 만족하는 k
    for (let k = Math.ceil((base - r1) / TAU); base - k * TAU > r0; k++) {
      const target = base - k * TAU
      let lo = t0
      let hi = t1
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2
        if (rotAt(mid) < target) lo = mid
        else hi = mid
      }
      out.push({ at: hi, edge: b.edge })
    }
  }
  return out.sort((x, y) => x.at - y.at)
}
