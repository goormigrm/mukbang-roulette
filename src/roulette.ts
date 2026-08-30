// Canvas 룰렛 원판 — 크롬 확장 "돌려돌려 돌림판" 스타일:
//   · 선명한 원색 평면 원판 + 얇은 진회색 외곽선 (장식 링·중앙 허브 없음)
//   · 포인터는 원판 밖 상단에서 아래를 향하는 검은 삼각형
//   · 포인터 위에 "지금 가리키는 항목 이름"을 크게 실시간 표시 (돌아가는 동안 휙휙 바뀜)
//   · 원판 라벨은 이름만 — 흰 글씨 + 어두운 테두리 (칸 수는 옆 목록에서 확인)
// 동작: [돌리기] → 정지 버튼을 누를 때까지 계속 회전, [정지] 순간 당첨 확정 후
//       현재 속도에서 이어지는 감속 곡선으로 5.5~8초간 긴장감 있게 착지.

import type { MenuItem } from './state'

const TAU = Math.PI * 2
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

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

type SpinMode = 'idle' | 'free' | 'stopping'

const MAX_SPEED = TAU * 2.2 // 자유 회전 속도 (rad/s)
const ACCEL_MS = 800 // 최고 속도 도달 시간

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
    /** 칸 경계 통과 시 호출. progress: 감속 진행도 0~1 (자유 회전 중엔 0) */
    private onSegmentCross?: (progress: number) => void,
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
    const size = Math.min(this.canvas.clientWidth || 560, 760)
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

    const segs = this.segmentAngles()
    for (let i = 0; i < items.length; i++) {
      const { start, end } = segs[i]
      let color = segColor(i)
      // 마지막 칸이 첫 칸과 같은 색으로 맞닿는 경우 보정
      if (i === items.length - 1 && items.length > 1 && color === segColor(0)) {
        color = PALETTE[(i + 5) % PALETTE.length]
      }
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, R, start + this.rotation, end + this.rotation)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
    }

    // 원판 외곽선 (확장처럼 얇은 진회색 한 겹)
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, TAU)
    ctx.strokeStyle = '#37474F'
    ctx.lineWidth = 3
    ctx.stroke()

    // 라벨 — 이름만, 흰 글씨 + 어두운 테두리 (확장 스타일)
    const fontSize = Math.max(12, Math.min(size * 0.042, (size * 2.4) / Math.max(8, items.length)))
    ctx.font = `800 ${fontSize}px "Noto Sans KR", sans-serif`
    ctx.textBaseline = 'middle'
    for (let i = 0; i < items.length; i++) {
      const { start, end } = segs[i]
      const mid = (start + end) / 2 + this.rotation
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(mid)
      ctx.textAlign = 'right'
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(2.5, fontSize * 0.18)
      ctx.strokeStyle = 'rgba(45, 45, 45, 0.8)'
      ctx.strokeText(items[i].name, R * 0.94, 0, R * 0.6)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(items[i].name, R * 0.94, 0, R * 0.6)
      ctx.restore()
    }

    // 현재 포인터가 가리키는 항목 이름 (포인터 위 실시간 표시 — 확장의 핵심 연출)
    const current = items[this.indexAtPointer()]
    const rimTop = cy - R
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.font = `900 ${Math.max(20, size * 0.05)}px "Noto Sans KR", sans-serif`
    ctx.fillStyle = '#0E0808'
    ctx.fillText(current.name, cx, rimTop - 30, size * 0.8)

    // 포인터 — 원판 밖 상단에서 아래를 향하는 검은 삼각형
    ctx.beginPath()
    ctx.moveTo(cx - 11, rimTop - 22)
    ctx.lineTo(cx + 11, rimTop - 22)
    ctx.lineTo(cx, rimTop + 4)
    ctx.closePath()
    ctx.fillStyle = '#1C1210'
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.restore()
  }

  /** 현재 포인터 아래에 있는 칸 인덱스 */
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
    const duration = 8000 + Math.random() * 3000 // 8~11초 감속 — 정지 후에도 충분히 오래 돌며 긴장감 유지
    // easeOutCubic의 t=0 기울기(3·range/duration)가 현재 속도 v와 같아지는 회전량
    const idealRange = (v * duration) / 1000 / 3

    // 당첨 칸 내부 무작위 지점(가장자리 8% 제외)
    const { start, end } = segs[winnerIndex]
    const target = start + (end - start) * (0.08 + Math.random() * 0.84)
    const landing = ((POINTER_ANGLE - target) % TAU) + TAU // 그 지점이 포인터에 오는 회전값(mod TAU)

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
    if (idx !== prevIdx && now - this.lastTickAt > 40) {
      this.lastTickAt = now
      const progress =
        this.mode === 'stopping' ? Math.min(1, (now - this.stopStartAt) / this.stopDuration) : 0
      this.onSegmentCross?.(progress)
    }
  }
}
