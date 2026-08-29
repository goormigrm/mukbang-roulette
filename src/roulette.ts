// Canvas 룰렛 원판.
// 참고한 "돌려돌려 돌림판" 확장프로그램과 같은 방식:
//   [돌리기] → 정지 버튼을 누를 때까지 일정 속도로 계속 회전
//   [정지]   → 그 순간 당첨을 확정하고, 5~8초간 긴장감 있게 감속하며 당첨 칸에 멈춤
// 감속 시작 속도와 easeOutCubic의 초기 기울기를 일치시켜 끊김 없이 이어진다.

import type { MenuItem } from './state'

const TAU = Math.PI * 2
const POINTER_ANGLE = -Math.PI / 2 // 12시 방향

const TEXT_COLOR = '#4a2c1a' // 파스텔 배경 위에서 잘 읽히는 진갈색

// 메뉴가 100개 가까이 되어도 인접 칸이 구분되도록 황금각(137.5°)으로 색상환을 순회하되,
// 음식과 어울리는 부드러운 파스텔(마카롱) 톤으로 만든다
export function segColor(i: number): string {
  const hue = (i * 137.508) % 360
  const sat = 52 + (i % 3) * 10 // 52 / 62 / 72%
  const light = 68 + (i % 4) * 4 // 68 / 72 / 76 / 80%
  return `hsl(${hue.toFixed(1)}, ${sat}%, ${light}%)`
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

type SpinMode = 'idle' | 'free' | 'stopping'

const MAX_SPEED = TAU * 1.9 // 자유 회전 속도 (rad/s)
const ACCEL_MS = 900 // 최고 속도 도달 시간

export class RouletteWheel {
  private rotation = Math.random() * TAU
  private mode: SpinMode = 'idle'
  private raf = 0
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastFrameAt = 0

  // free 회전 상태
  private freeStartAt = 0
  private lastTickAt = 0

  // stopping 상태
  private stopStartRot = 0
  private stopEndRot = 0
  private stopStartAt = 0
  private stopDuration = 0
  private onStopped: (() => void) | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    private getItems: () => MenuItem[],
    private onSegmentCross?: () => void,
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

  private fitCanvas(): void {
    const dpr = window.devicePixelRatio || 1
    const size = Math.min(this.canvas.clientWidth || 560, 720)
    this.canvas.width = size * dpr
    this.canvas.height = size * dpr
    this.draw()
  }

  /** 각 칸의 [시작, 끝) 각도(회전 미적용) */
  private segmentAngles(): { start: number; end: number }[] {
    const items = this.getItems()
    const total = items.reduce((a, m) => a + m.weight, 0)
    const out: { start: number; end: number }[] = []
    let acc = 0
    for (const m of items) {
      const start = (acc / total) * TAU
      acc += m.weight
      out.push({ start, end: (acc / total) * TAU })
    }
    return out
  }

  draw(): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const size = this.canvas.width / dpr
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size, size)

    const cx = size / 2
    const cy = size / 2
    const R = size / 2 - 14

    // 바깥 장식 링 (금색 + 먹색 이중 테두리)
    ctx.beginPath()
    ctx.arc(cx, cy, R + 10, 0, TAU)
    ctx.fillStyle = '#1C1210'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, R + 6, 0, TAU)
    ctx.strokeStyle = '#D9A441'
    ctx.lineWidth = 3
    ctx.stroke()

    const items = this.getItems()
    if (items.length === 0) {
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, TAU)
      ctx.fillStyle = '#FFF3E8'
      ctx.fill()
      ctx.fillStyle = '#9A8578'
      ctx.font = `600 ${Math.max(15, size * 0.032)}px "Noto Sans KR", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('도네이션을 기다리는 중...', cx, cy)
      ctx.restore()
      return
    }

    const segs = this.segmentAngles()
    for (let i = 0; i < items.length; i++) {
      const { start, end } = segs[i]
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, R, start + this.rotation, end + this.rotation)
      ctx.closePath()
      ctx.fillStyle = segColor(i)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // 라벨
    const fontSize = Math.max(11, Math.min(size * 0.036, (size * 2.2) / Math.max(8, items.length)))
    ctx.font = `700 ${fontSize}px "Noto Sans KR", sans-serif`
    ctx.textBaseline = 'middle'
    for (let i = 0; i < items.length; i++) {
      const { start, end } = segs[i]
      const mid = (start + end) / 2 + this.rotation
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(mid)
      ctx.textAlign = 'right'
      ctx.fillStyle = TEXT_COLOR
      const label = items[i].weight > 1 ? `${items[i].name} ×${items[i].weight}` : items[i].name
      ctx.fillText(label, R * 0.92, 0, R * 0.62)
      ctx.restore()
    }

    // 중앙 허브
    const hub = Math.max(34, size * 0.11)
    ctx.beginPath()
    ctx.arc(cx, cy, hub, 0, TAU)
    ctx.fillStyle = '#1C1210'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, hub - 4, 0, TAU)
    ctx.strokeStyle = '#D9A441'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#FFF8F0'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.max(13, hub * 0.42)}px "Nanum Brush Script", cursive`
    ctx.fillText('먹방', cx, cy - hub * 0.24)
    ctx.fillText('룰렛', cx, cy + hub * 0.26)

    // 포인터 (12시 방향, 아래를 가리키는 삼각형)
    ctx.beginPath()
    ctx.moveTo(cx - 14, cy - R - 12)
    ctx.lineTo(cx + 14, cy - R - 12)
    ctx.lineTo(cx, cy - R + 18)
    ctx.closePath()
    ctx.fillStyle = '#D9A441'
    ctx.fill()
    ctx.strokeStyle = '#1C1210'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.restore()
  }

  /** 현재 포인터 아래에 있는 칸 인덱스 (틱 사운드용) */
  private indexAtPointer(): number {
    const segs = this.segmentAngles()
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
    this.lastFrameAt = this.freeStartAt
    this.startLoop()
  }

  /**
   * [정지] — winnerIndex 칸에 멈추도록 감속을 시작한다.
   * 현재 회전 속도에서 이어지는 감속 곡선을 계산해 5~8초간 긴장감 있게 멈춘다.
   */
  requestStop(winnerIndex: number, onDone: () => void): void {
    if (this.mode !== 'free') return
    const segs = this.segmentAngles()
    if (winnerIndex < 0 || winnerIndex >= segs.length) return

    const now = performance.now()
    const v = this.freeVelocity(now)
    const duration = 5500 + Math.random() * 2500 // 5.5~8초 감속
    // easeOutCubic의 t=0 기울기(3·range/duration)가 현재 속도 v와 같아지는 회전량
    const idealRange = (v * duration) / 1000 / 3

    // 당첨 칸 내부 무작위 지점(가장자리 8% 제외)
    const { start, end } = segs[winnerIndex]
    const target = start + (end - start) * (0.08 + Math.random() * 0.84)
    let landing = ((POINTER_ANGLE - target) % TAU) + TAU // 그 지점이 포인터에 오는 회전값(mod TAU)

    const startRot = this.rotation
    // idealRange에 가장 가까운 바퀴 수로 착지점을 맞춘다
    let range = landing - (startRot % TAU)
    range = ((range % TAU) + TAU) % TAU
    range += Math.max(1, Math.round((idealRange - range) / TAU)) * TAU

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
    const dt = Math.min(0.3, (now - this.lastFrameAt) / 1000)
    this.lastFrameAt = now
    const prevIdx = this.indexAtPointer()

    if (this.mode === 'free') {
      this.rotation += this.freeVelocity(now) * dt
    } else if (this.mode === 'stopping') {
      const t = Math.min(1, (now - this.stopStartAt) / this.stopDuration)
      this.rotation = this.stopStartRot + (this.stopEndRot - this.stopStartRot) * easeOutCubic(t)
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
    const idx = this.indexAtPointer()
    if (idx !== prevIdx && now - this.lastTickAt > 45) {
      this.lastTickAt = now
      this.onSegmentCross?.()
    }
  }
}
