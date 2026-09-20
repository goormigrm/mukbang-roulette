// Canvas 룰렛 원판 — 크롬 확장 "돌려돌려 돌림판" 스타일:
//   · 선명한 원색 평면 원판 + 얇은 진회색 외곽선 (장식 링·중앙 허브 없음)
//   · 포인터는 원판 밖 상단에서 아래를 향하는 검은 삼각형
//   · 포인터 위에 "지금 가리키는 항목 이름"을 크게 실시간 표시 (돌아가는 동안 휙휙 바뀜)
//   · 원판 라벨은 이름만 — 흰 글씨 + 어두운 테두리 (칸 수는 옆 목록에서 확인)
// 동작: [돌리기] → 정지 버튼을 누를 때까지 계속 회전, [정지] 순간 당첨 확정 후
//       현재 속도에서 이어지는 감속 곡선으로 7~9초간 긴장감 있게 착지.

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

  // free 회전 상태
  private freeStartAt = 0

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

  /** 현재 각속도 (rad/s) — 소리 빈도를 속도에 맞추는 데 쓴다 */
  get angularSpeed(): number {
    const now = performance.now()
    if (this.mode === 'free') return this.freeVelocity(now)
    if (this.mode === 'stopping') {
      // easeOutCubic의 순간 기울기: 3·(1-t)²·회전량 / 지속시간
      const t = Math.min(1, (now - this.stopStartAt) / this.stopDuration)
      return (3 * (1 - t) ** 2 * (this.stopEndRot - this.stopStartRot)) / (this.stopDuration / 1000)
    }
    return 0
  }

  /** 초당 몇 번 딸깍여야 하는지 (핀/칸을 지나는 속도) */
  get tickRate(): number {
    const units = this.getItems().length > PEGS ? Math.max(1, this.segs.length) : PEGS
    return (this.angularSpeed / TAU) * units
  }

  /** 감속 진행도 0~1 (자유 회전 중엔 0) — 멈추기 직전일수록 소리가 높아진다 */
  get stopProgress(): number {
    return this.mode === 'stopping'
      ? Math.min(1, (performance.now() - this.stopStartAt) / this.stopDuration)
      : 0
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
    if (this.mode === 'stopping') {
      const t = (performance.now() - this.stopStartAt) / this.stopDuration
      if (t > 0.5) {
        const k = Math.min(1, (t - 0.5) / 0.5) // 번쩍임 강도 0 → 1
        const blink = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 85))
        const seg = segs[this.indexAtPointer()]
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, R, seg.start + this.rotation, seg.end + this.rotation)
        ctx.closePath()
        ctx.fillStyle = `rgba(255, 255, 255, ${((0.18 + 0.34 * k) * blink).toFixed(3)})`
        ctx.fill()
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 3 + 3 * k
        ctx.stroke()
      }
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
    const v = this.freeVelocity(now)
    const duration = 7000 + Math.random() * 2000 // 7~9초 감속 — 시원하게 멈춘다
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
  }
}
