// Canvas 룰렛 원판 — 크롬 확장 "돌려돌려 돌림판" 스타일:
//   · 선명한 원색 평면 원판 + 얇은 진회색 외곽선 (장식 링·중앙 허브 없음)
//   · 포인터는 원판 밖 상단에서 아래를 향하는 검은 삼각형
//   · 포인터 위에 "지금 가리키는 항목 이름"을 크게 실시간 표시 (돌아가는 동안 휙휙 바뀜)
//   · 원판 라벨은 이름만 — 흰 글씨 + 어두운 테두리 (칸 수는 옆 목록에서 확인)
// 동작: [돌리기] → 정지 버튼을 누를 때까지 계속 회전, [정지] 순간 당첨 확정 후
//       현재 속도에서 이어지는 감속 곡선으로 7~9초간 긴장감 있게 착지.

import type { MenuItem } from './state'

import { boundaryIndexAt, crossings, easeOutCubic, freeTurn, planStop, tickBoundaries, TAU } from './spin'
import type { Boundary } from './spin'
const POINTER_ANGLE = -Math.PI / 2 // 12시 방향

// 확장프로그램과 같은 계열의 선명한 원색 팔레트 (Material 계열, 인접 칸 구분 뚜렷)
const PALETTE = [
  '#00BCD4', // cyan
  '#CDDC39', // lime
  '#FF9800', // orange
  '#607D8B', // blue gray
  '#9C27B0', // purple
  '#2196F3', // blue
  '#E91E63', // pink
  '#8BC34A', // light green
  '#FF5722', // deep orange
  '#3F51B5', // indigo
  '#FFC107', // amber
  '#009688', // teal
]

export function segColor(i: number): string {
  return PALETTE[i % PALETTE.length]
}


type SpinMode = 'idle' | 'free' | 'stopping'

const MAX_SPEED = TAU * 3.6 // 자유 회전 속도 (rad/s)
const ACCEL_MS = 800 // 최고 속도 도달 시간
/** [돌리기] 직후 이 시간 동안은 정지할 수 없다 — 거의 돌지 않고 끝나 보이는 것을 막는다 */
export const MIN_SPIN_MS = 1000
// 딸깍 소리용 가상 핀 개수 — 메뉴가 이보다 적으면 실제 돌림판처럼 일정한 리듬으로 딸깍이고,
// 더 많으면 칸 하나하나가 핀이 되어 빽빽할수록 따다다닥이 촘촘해진다 (라벨 전환과 딸깍이 일치)
const PEGS = 24

export class RouletteWheel {
  private rotation = Math.random() * TAU
  private mode: SpinMode = 'idle'
  private raf = 0
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastFrameAt = 0

  // free 회전 상태 — 회전량은 시작 시각·시작 각도로부터 계산한다(프레임마다 더하지 않는다)
  private freeStartAt = 0
  private freeStartRot = 0

  // 딸깍 경계(칸 경계 + 큰 칸 안의 핀) — 칸이 바뀔 때만 다시 만든다
  private bounds: Boundary[] = []
  private boundsVersion = -1
  // 화면 쪽 동기화: 포인터가 마지막으로 새 칸에 들어선 시각(흰 번쩍임), 핀을 친 시각(포인터 튕김)
  private segIdx = -1
  private segEnteredAt = 0
  private pegIdx = -1
  private pegHitAt = -1e9

  // 칸 각도 캐시 — 메뉴가 바뀔 때만 다시 계산한다
  private segs: { start: number; end: number }[] = []
  private geomItems: MenuItem[] | null = null
  private geomKey = ''
  private geomVersion = 0
  // 원판 그림(칸·라벨·테두리)을 미리 그려 두는 오프스크린 캔버스.
  // 메뉴 110종이면 매 프레임 라벨 110개를 다시 그리느라 7fps까지 떨어졌다 —
  // 회전과 무관한 그림이므로 한 번만 그려 두고 프레임마다 돌려서 한 장 붙인다.
  private plate: HTMLCanvasElement | null = null
  private plateKey = ''

  // stopping 상태
  private stopStartRot = 0
  private stopEndRot = 0
  private stopStartAt = 0
  private stopDuration = 0
  private onStopped: (() => void) | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    private getItems: () => MenuItem[],
  ) {
    const resize = () => this.fitCanvas()
    window.addEventListener('resize', resize)
    this.fitCanvas()
  }

  get isSpinning(): boolean {
    return this.mode !== 'idle'
  }

  get isFreeSpinning(): boolean {
    return this.mode === 'free'
  }

  get isStopping(): boolean {
    return this.mode === 'stopping'
  }

  /** 감속 진행도 0~1 (자유 회전 중엔 0) — 멈추기 직전일수록 소리가 높아진다 */
  private progressAt(t: number): number {
    return this.mode === 'stopping' ? Math.min(1, Math.max(0, (t - this.stopStartAt) / this.stopDuration)) : 0
  }

  /** 시각 t(performance.now 기준 ms)의 회전량 — 화면과 소리가 같은 함수를 쓴다 */
  private rotationAt(t: number): number {
    if (this.mode === 'free') return this.freeStartRot + freeTurn(t - this.freeStartAt, MAX_SPEED, ACCEL_MS)
    if (this.mode === 'stopping') {
      const u = Math.min(1, Math.max(0, (t - this.stopStartAt) / this.stopDuration))
      return this.stopStartRot + (this.stopEndRot - this.stopStartRot) * easeOutCubic(u)
    }
    return this.rotation
  }

  private syncBounds(): Boundary[] {
    this.syncSegs()
    if (this.boundsVersion !== this.geomVersion) {
      this.bounds = tickBoundaries(this.segs, PEGS)
      this.boundsVersion = this.geomVersion
    }
    return this.bounds
  }

  /** fromMs~toMs 동안 포인터가 칸 경계·핀을 지나는 순간들 — 소리를 정확히 그 순간에 예약하는 데 쓴다.
   *  화면은 같은 rotationAt으로 그리므로 딸깍 = 이름이 바뀌는 순간 = 흰 번쩍임이 시작되는 순간이다 */
  tickEvents(fromMs: number, toMs: number): { at: number; edge: boolean; progress: number }[] {
    if (this.mode === 'idle' || this.getItems().length === 0) return []
    return crossings((t) => this.rotationAt(t), fromMs, toMs, this.syncBounds(), POINTER_ANGLE).map((c) => ({
      ...c,
      progress: this.progressAt(c.at),
    }))
  }

  /** 최소 회전 시간을 채워 이제 정지할 수 있는지 */
  get canStop(): boolean {
    return this.mode === 'free' && performance.now() - this.freeStartAt >= MIN_SPIN_MS
  }

  private fitCanvas(): void {
    const dpr = window.devicePixelRatio || 1
    const size = Math.min(this.canvas.clientWidth || 560, 760)
    this.canvas.width = size * dpr
    this.canvas.height = size * dpr
    this.draw()
  }

  /** 각 칸의 [시작, 끝) 각도(회전 미적용). 메뉴가 그대로면 이전 계산을 재사용한다 */
  private syncSegs(): { start: number; end: number }[] {
    const items = this.getItems()
    const total = items.reduce((a, m) => a + m.weight, 0)
    const key = `${items.length}|${total}`
    // 배열 자체가 교체됐거나(삭제·불러오기) 개수·총 칸이 달라졌으면 다시 계산
    if (this.geomItems === items && this.geomKey === key) return this.segs
    this.geomItems = items
    this.geomKey = key
    this.geomVersion++
    const out: { start: number; end: number }[] = []
    let acc = 0
    for (const m of items) {
      const start = (acc / total) * TAU
      acc += m.weight
      out.push({ start, end: (acc / total) * TAU })
    }
    this.segs = out
    return out
  }

  /** 회전과 무관한 원판 그림을 오프스크린에 준비한다 (메뉴·크기가 바뀔 때만 다시 그림) */
  private ensurePlate(size: number, dpr: number, cx: number, cy: number, R: number): HTMLCanvasElement | null {
    const items = this.getItems()
    if (items.length === 0) return null
    const key = `${size}|${dpr}|${this.geomVersion}`
    if (this.plate && this.plateKey === key) return this.plate

    const cv = this.plate ?? document.createElement('canvas')
    cv.width = size * dpr
    cv.height = size * dpr
    const c = cv.getContext('2d')
    if (!c) return null
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, cv.width, cv.height)
    c.scale(dpr, dpr)

    const segs = this.segs
    for (let i = 0; i < items.length; i++) {
      const { start, end } = segs[i]
      let color = segColor(i)
      // 마지막 칸이 첫 칸과 같은 색으로 맞닿는 경우 보정
      if (i === items.length - 1 && items.length > 1 && color === segColor(0)) {
        color = PALETTE[(i + 5) % PALETTE.length]
      }
      c.beginPath()
      c.moveTo(cx, cy)
      c.arc(cx, cy, R, start, end)
      c.closePath()
      c.fillStyle = color
      c.fill()
    }

    // 원판 외곽선 (확장처럼 얇은 진회색 한 겹)
    c.beginPath()
    c.arc(cx, cy, R, 0, TAU)
    c.strokeStyle = '#37474F'
    c.lineWidth = 3
    c.stroke()

    // 라벨 — 이름만, 흰 글씨 + 어두운 테두리 (확장 스타일)
    const fontSize = Math.max(12, Math.min(size * 0.042, (size * 2.4) / Math.max(8, items.length)))
    c.font = `800 ${fontSize}px "Noto Sans KR", sans-serif`
    c.textBaseline = 'middle'
    for (let i = 0; i < items.length; i++) {
      const { start, end } = segs[i]
      c.save()
      c.translate(cx, cy)
      c.rotate((start + end) / 2)
      c.textAlign = 'right'
      c.lineJoin = 'round'
      c.lineWidth = Math.max(2.5, fontSize * 0.18)
      c.strokeStyle = 'rgba(45, 45, 45, 0.8)'
      c.strokeText(items[i].name, R * 0.94, 0, R * 0.6)
      c.fillStyle = '#FFFFFF'
      c.fillText(items[i].name, R * 0.94, 0, R * 0.6)
      c.restore()
    }

    this.plate = cv
    this.plateKey = key
    return cv
  }

  draw(): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const size = this.canvas.width / dpr
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size, size)

    // 상단에 라이브 라벨 + 포인터 공간을 확보하고 원판은 그 아래에 그린다
    const pad = Math.max(58, size * 0.13)
    const cx = size / 2
    const cy = (size + pad) / 2
    const R = (size - pad) / 2 - 8

    const items = this.getItems()
    if (items.length === 0) {
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, TAU)
      ctx.fillStyle = '#F4EFE8'
      ctx.fill()
      ctx.strokeStyle = '#37474F'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.fillStyle = '#9A8578'
      ctx.font = `600 ${Math.max(15, size * 0.032)}px "Noto Sans KR", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('도네이션을 기다리는 중...', cx, cy)
      ctx.restore()
      return
    }

    const segs = this.syncSegs()

    // 회전하는 부분(칸·라벨·테두리)은 미리 그려 둔 그림을 돌려서 한 번에 붙인다
    const plate = this.ensurePlate(size, dpr, cx, cy, R)
    if (plate) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(this.rotation)
      ctx.translate(-cx, -cy)
      ctx.drawImage(plate, 0, 0, size, size)
      ctx.restore()
    }

    // 감속 절반을 지나면 포인터 아래 칸을 번쩍여 "여기 걸릴까?" 긴장을 만든다.
    // 멈추기 직전으로 갈수록 점점 세게 빛난다.
    // 번쩍임은 따로 도는 박자가 아니라 "새 칸이 포인터에 닿는 순간" 터졌다가 사그라든다 — 딸깍과 같은 순간.
    const now = performance.now()
    const idx = this.indexAtPointer()
    this.trackPointer(idx, now)
    if (this.mode === 'stopping') {
      const t = (now - this.stopStartAt) / this.stopDuration
      if (t > 0.5) {
        const k = Math.min(1, (t - 0.5) / 0.5) // 번쩍임 강도 0 → 1
        const hit = Math.exp(-(now - this.segEnteredAt) / 140) // 칸에 들어선 순간 1 → 사그라듦
        const seg = segs[idx]
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, R, seg.start + this.rotation, seg.end + this.rotation)
        ctx.closePath()
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.14 + 0.24 * k + 0.42 * k * hit).toFixed(3)})`
        ctx.fill()
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 3 + 3 * k
        ctx.stroke()
      }
    }

    // 현재 포인터가 가리키는 항목 이름 (포인터 위 실시간 표시 — 확장의 핵심 연출)
    const current = items[idx]
    const rimTop = cy - R
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.font = `900 ${Math.max(20, size * 0.05)}px "Noto Sans KR", sans-serif`
    ctx.fillStyle = '#0E0808'
    ctx.fillText(current.name, cx, rimTop - 30, size * 0.8)

    // 포인터 — 원판 밖 상단에서 아래를 향하는 검은 삼각형.
    // 돌 때는 핀을 칠 때마다 원판이 도는 쪽으로 살짝 튕겼다 돌아온다(딸깍과 같은 순간). 빠르면 기운 채로 핀을 타고 넘는다
    const kick = this.mode === 'idle' ? 0 : Math.max(0, 1 - (now - this.pegHitAt) / 90)
    ctx.save()
    ctx.translate(cx, rimTop - 22)
    ctx.rotate(-0.24 * kick)
    ctx.beginPath()
    ctx.moveTo(-11, 0)
    ctx.lineTo(11, 0)
    ctx.lineTo(0, 26)
    ctx.closePath()
    ctx.fillStyle = '#1C1210'
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()

    ctx.restore()
  }

  /** 포인터가 새 칸·새 핀 구간에 들어섰는지 — 번쩍임·튕김을 그 순간부터 센다 */
  private trackPointer(segIdx: number, now: number): void {
    if (segIdx !== this.segIdx) {
      this.segIdx = segIdx
      this.segEnteredAt = now
    }
    const bounds = this.syncBounds()
    const a = (((POINTER_ANGLE - this.rotation) % TAU) + TAU) % TAU
    const pegIdx = boundaryIndexAt(a, bounds)
    if (pegIdx !== this.pegIdx) {
      this.pegIdx = pegIdx
      this.pegHitAt = now
    }
  }

  /** 현재 포인터 아래에 있는 칸 인덱스 */
  private indexAtPointer(): number {
    const segs = this.syncSegs()
    const a = (((POINTER_ANGLE - this.rotation) % TAU) + TAU) % TAU
    for (let i = 0; i < segs.length; i++) {
      if (a >= segs[i].start && a < segs[i].end) return i
    }
    return 0
  }

  /** 현재 자유 회전 속도 (rad/s) — 가속 구간 반영 */
  private freeVelocity(now: number): number {
    const k = Math.min(1, (now - this.freeStartAt) / ACCEL_MS)
    return MAX_SPEED * (1 - Math.pow(1 - k, 2)) // easeOutQuad 가속
  }

  /** [돌리기] — 정지 버튼을 누를 때까지 계속 회전 */
  startFreeSpin(): void {
    if (this.mode !== 'idle') return
    this.mode = 'free'
    this.freeStartAt = performance.now()
    this.freeStartRot = this.rotation
    this.lastFrameAt = this.freeStartAt
    this.startLoop()
  }

  /**
   * [정지] — winnerIndex 칸에 멈추도록 감속을 시작한다.
   * 현재 회전 속도에서 이어지는 감속 곡선을 계산해 7~9초간 긴장감 있게 멈춘다.
   */
  requestStop(winnerIndex: number, onDone: () => void): void {
    if (this.mode !== 'free') return
    const segs = this.syncSegs()
    if (winnerIndex < 0 || winnerIndex >= segs.length) return

    const now = performance.now()
    // 지금 이 순간의 각도·속도에서 이어서 감속한다 (마지막 프레임 각도를 쓰면 정지 순간 한 박자 멈칫했다)
    this.rotation = this.rotationAt(now)
    const v = this.freeVelocity(now)
    const duration = 7000 + Math.random() * 2000 // 7~9초 감속 — 시원하게 멈춘다
    // 당첨 칸 내부 무작위 지점(가장자리 8% 제외)이 포인터에 오도록 (계산은 spin.ts planStop — 테스트로 고정)
    const startRot = this.rotation
    const range = planStop(startRot, v, duration, segs[winnerIndex], Math.random(), POINTER_ANGLE)

    this.mode = 'stopping'
    this.stopStartRot = startRot
    this.stopEndRot = startRot + range
    this.stopStartAt = now
    this.stopDuration = duration
    this.onStopped = onDone
  }

  private startLoop(): void {
    cancelAnimationFrame(this.raf)
    const frame = (now: number) => {
      if (this.mode === 'idle') return
      this.step(now) // step()이 mode를 'idle'로 바꿀 수 있다
      if ((this.mode as SpinMode) !== 'idle') this.raf = requestAnimationFrame(frame)
    }
    this.raf = requestAnimationFrame(frame)
    // 백그라운드 탭에서는 rAF가 멈추므로 워치독이 이어받아 진행시킨다
    if (this.watchdog === null) {
      this.watchdog = setInterval(() => {
        const now = performance.now()
        if (this.mode !== 'idle' && now - this.lastFrameAt > 300) this.step(now)
      }, 250)
    }
  }

  private step(now: number): void {
    this.lastFrameAt = now

    this.rotation = this.rotationAt(now)
    if (this.mode === 'stopping') {
      const t = Math.min(1, (now - this.stopStartAt) / this.stopDuration)
      if (t >= 1) {
        this.mode = 'idle'
        if (this.watchdog !== null) {
          clearInterval(this.watchdog)
          this.watchdog = null
        }
        this.draw()
        const cb = this.onStopped
        this.onStopped = null
        cb?.()
        return
      }
    }

    this.draw()
  }
}
