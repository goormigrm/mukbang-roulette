// Canvas 룰렛 원판: 가중치 비례 칸, 스핀 애니메이션 (결과는 시작 시점에 확정된 각도로 감속 정지)

import type { MenuItem } from './state'

const TAU = Math.PI * 2
const POINTER_ANGLE = -Math.PI / 2 // 12시 방향

const SEG_COLORS = ['#C8102E', '#1C1210', '#E8433F', '#A8721C']
const TEXT_COLOR = '#FFF8F0'

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export class RouletteWheel {
  private rotation = Math.random() * TAU
  private spinning = false
  private raf = 0
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastFrameAt = 0

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
    return this.spinning
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
      let color = SEG_COLORS[i % SEG_COLORS.length]
      // 마지막 칸이 첫 칸과 같은 색으로 맞닿는 경우 보정
      if (i === items.length - 1 && items.length > 1 && color === SEG_COLORS[0]) color = SEG_COLORS[1]

      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, R, start + this.rotation, end + this.rotation)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,248,240,0.5)'
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
    ctx.fillStyle = TEXT_COLOR
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

  /** winnerIndex 칸의 중앙이 포인터에 오도록 감속 스핀 */
  spin(winnerIndex: number, onDone: () => void): void {
    if (this.spinning) return
    const segs = this.segmentAngles()
    if (winnerIndex < 0 || winnerIndex >= segs.length) return
    this.spinning = true

    const { start, end } = segs[winnerIndex]
    // 당첨 칸 내부 무작위 지점(가장자리 5% 제외)에 멈추면 더 자연스러움
    const span = end - start
    const target = start + span * (0.08 + Math.random() * 0.84)
    const startRot = ((this.rotation % TAU) + TAU) % TAU
    const baseTurns = 6 + Math.floor(Math.random() * 3)
    let endRot = POINTER_ANGLE - target
    endRot = ((endRot % TAU) + TAU) % TAU
    while (endRot < startRot) endRot += TAU
    endRot += baseTurns * TAU

    const duration = 4600 + Math.random() * 1600
    const t0 = performance.now()
    let lastIdx = this.indexAtPointer()

    const finish = () => {
      this.spinning = false
      if (this.watchdog !== null) {
        clearInterval(this.watchdog)
        this.watchdog = null
      }
      onDone()
    }

    const frame = (now: number) => {
      if (!this.spinning) return
      this.lastFrameAt = now
      const t = Math.min(1, (now - t0) / duration)
      this.rotation = startRot + (endRot - startRot) * easeOutCubic(t)
      this.draw()
      const idx = this.indexAtPointer()
      if (idx !== lastIdx) {
        lastIdx = idx
        this.onSegmentCross?.()
      }
      if (t < 1) {
        this.raf = requestAnimationFrame(frame)
      } else {
        finish()
      }
    }
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(frame)
    // 백그라운드 탭에서는 rAF가 멈추므로 워치독이 애니메이션을 이어받아 스핀을 끝까지 진행시킨다
    this.lastFrameAt = performance.now()
    this.watchdog = setInterval(() => {
      const now = performance.now()
      if (this.spinning && now - this.lastFrameAt > 300) frame(now)
    }, 250)
  }
}
