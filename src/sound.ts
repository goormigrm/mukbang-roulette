// WebAudio 효과음 (외부 에셋 없이 합성)
// - tick: 칸 넘김 클릭. 감속 구간에서는 진행도에 따라 음정이 올라가 긴장감을 만든다
// - drumroll: 정지 버튼 이후 "두구두구" — 점점 커지는 스네어 롤
// - fanfare: 당첨 — 심벌 크래시 + 코드 스탭 + 아르페지오
// - rerollChime: 리롤권 획득 — 급상승 슬라이드

let ctx: AudioContext | null = null
let noiseBuf: AudioBuffer | null = null
/** 모든 소리가 거치는 출력단 — 컴프레서로 겹칠 때(팡파레 등) 찌그러지는 클리핑을 막는다 */
let master: AudioNode | null = null

// 전체 음량 배율 — 개별 게인 값에 일괄 적용 (컴프레서가 뒤에 있어 크게 잡아도 찌그러지지 않는다)
const MASTER = 2.4

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function out(a: AudioContext): AudioNode {
  if (!master) {
    const comp = a.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 18
    comp.ratio.value = 8
    comp.attack.value = 0.003
    comp.release.value = 0.12
    const makeup = a.createGain() // 컴프레서가 깎은 만큼 되살리는 메이크업 게인
    makeup.gain.value = 1.25
    comp.connect(makeup).connect(a.destination)
    master = comp
  }
  return master
}

function noise(a: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.3, a.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

function beep(freq: number, dur: number, type: OscillatorType, gainV: number, when = 0, slideTo?: number): void {
  const a = ac()
  if (!a) return
  const t = a.currentTime + when
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
  gain.gain.setValueAtTime(gainV * MASTER, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(out(a))
  osc.start(t)
  osc.stop(t + dur)
}

/** 밴드패스 필터를 거친 노이즈 버스트 (스네어/심벌 느낌) */
function burst(when: number, dur: number, gainV: number, filterFreq: number): void {
  const a = ac()
  if (!a) return
  const t = a.currentTime + when
  const src = a.createBufferSource()
  src.buffer = noise(a)
  const filter = a.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = filterFreq
  filter.Q.value = 0.8
  const gain = a.createGain()
  gain.gain.setValueAtTime(gainV * MASTER, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(gain).connect(out(a))
  src.start(t)
  src.stop(t + dur)
}

/** 딸깍 한 번의 결 — 매번 같은 소리를 내면 기계음처럼 단조로워진다.
 *  실제 돌림판은 날개가 핀을 때릴 때마다 조금씩 다른 소리가 나므로 세 가지를 섞는다. */
let pegVariant = 0

/** 돌림판 날개가 핀에 부딪히는 "딸깍" 한 번 — 실제 룰렛 래칫 소리.
 *  빠를 땐 따다다닥, 느려지면 딸깍… 딸깍… 간격이 벌어진다.
 *  세 가지 결(딱: 마른 타격 · 탁: 몸통 있는 플라스틱 · 따각: 날개가 한 번 튕기는 두 겹)을
 *  바로 앞과 겹치지 않게 번갈아 내고, 음정·세기도 한 방씩 흔들어 준다.
 *  progress(0~1): 감속 진행도 — [정지] 직후부터 멈출 때까지 음정이 올라간다. */
export function tick(progress = 0, when = 0, gainScale = 1): void {
  const t = Math.max(0, when)
  const detune = 1 + (Math.random() - 0.5) * 0.16 // 핀마다 미세하게 다른 음정
  const g = gainScale * (0.88 + Math.random() * 0.24) // 세기도 한 방씩 다르게
  // 바로 앞과 같은 결이 연달아 나오지 않게 1~2칸씩 건너뛴다
  pegVariant = (pegVariant + 1 + (Math.random() < 0.35 ? 1 : 0)) % 3
  // 감속이 진행될수록 낮은음 → 높은음 (900Hz → 3000Hz).
  // 자유 회전 중(progress 0)에도 충분히 밝게 — 예전 640Hz는 웅웅거려 단조로웠다.
  const pitch = 900 * Math.pow(3.33, progress) * detune
  const bright = 4200 + 4000 * progress // 타격 노이즈도 같이 밝아진다

  if (pegVariant === 0) {
    // 딱 — 마른 나무를 때리듯 짧고 단단하게
    burst(t, 0.01, (0.2 + 0.06 * progress) * g, bright)
    beep(pitch, 0.022, 'triangle', (0.16 + 0.06 * progress) * g, t)
    beep(pitch * 2.02, 0.012, 'square', 0.05 * g, t) // 카랑한 배음
  } else if (pegVariant === 1) {
    // 탁 — 몸통이 좀 더 울리는 플라스틱 날개
    burst(t, 0.016, (0.15 + 0.06 * progress) * g, bright * 0.62)
    beep(pitch * 0.76, 0.03, 'triangle', (0.17 + 0.06 * progress) * g, t)
    beep(pitch * 1.49, 0.018, 'square', 0.042 * g, t)
  } else {
    // 따각 — 핀을 넘으며 날개가 한 번 되튀는 두 겹 소리
    burst(t, 0.008, (0.18 + 0.06 * progress) * g, bright * 1.15)
    beep(pitch * 1.18, 0.018, 'triangle', (0.13 + 0.05 * progress) * g, t)
    burst(t + 0.011, 0.007, 0.085 * g, bright * 0.8)
    beep(pitch * 0.92, 0.014, 'square', 0.04 * g, t + 0.011)
  }

  // 공통 — 판에 전달되는 둔탁한 저음 진동 (감속할수록 옅어진다)
  beep(250 * (1 + progress) * detune, 0.03, 'sine', (0.09 - 0.045 * progress) * g, t)
  if (progress > 0.8) {
    // 멈추기 직전엔 저음 심장박동을 한 겹 더
    beep(110 + 50 * progress, 0.07, 'sine', 0.12 * g, t)
  }
}

// ---- 회전 딸깍 스케줄러 ----
// 예전에는 화면 프레임마다 딸깍을 울렸는데, 메뉴가 100종을 넘어 프레임이 떨어지면
// 소리까지 뚝뚝 끊겼다. 이제 오디오 시계에 미리 예약해 두어 화면과 무관하게 고르게 난다.
const TICK_MAX_RATE = 36 // 초당 최대 딸깍 (그 이상은 사람 귀에 뭉개지고 부하만 커진다)
let tickTimer: ReturnType<typeof setInterval> | null = null
let tickNext = 0

/** 회전 시작 — rateFn(초당 딸깍 횟수)과 progressFn(감속 진행도)을 읽어 계속 예약한다 */
export function startTicking(rateFn: () => number, progressFn: () => number): void {
  const a = ac()
  if (!a || tickTimer) return
  tickNext = a.currentTime + 0.05
  tickTimer = setInterval(() => {
    const horizon = a.currentTime + 0.25 // 0.25초 앞까지 미리 예약
    let guard = 0
    while (tickNext < horizon && guard++ < 60) {
      const rate = Math.min(TICK_MAX_RATE, Math.max(0, rateFn()))
      if (rate < 0.7) {
        // 거의 멈춤 — 잠시 뒤 다시 본다
        tickNext = a.currentTime + 0.1
        break
      }
      // 촘촘할수록 한 방씩은 살짝 부드럽게 (겹쳐서 뭉개지지 않게)
      tick(progressFn(), tickNext - a.currentTime, rate > 16 ? 0.8 : 1)
      tickNext += 1 / rate
    }
  }, 70)
}

export function stopTicking(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

// ---- 리롤 카운트다운 시계 소리 ----
let tock = false

/** 째깍(1초 간격). urgent=true(마지막 10초)면 더 높고 날카로운 소리 — 호출 간격도 0.5초로 빨라진다.
 *  urgency 0~1: 마감에 가까울수록 음정이 조금씩 올라간다 */
export function clockTick(urgent = false, urgency = 0): void {
  tock = !tock
  if (urgent) {
    const f = 1250 + 350 * urgency + (tock ? 90 : 0)
    beep(f, 0.05, 'square', 0.1)
    burst(0, 0.03, 0.05, 5200)
    beep(f / 2, 0.06, 'sine', 0.06) // 심장박동 느낌의 저음
  } else {
    beep(tock ? 780 : 960, 0.045, 'square', 0.055)
    burst(0, 0.02, 0.02, 3200)
  }
}

/** 접수 마감 — 뎅 (공 소리) */
export function timeUp(): void {
  beep(660, 0.7, 'triangle', 0.16, 0, 440)
  beep(330, 0.9, 'sine', 0.12)
  burst(0, 0.35, 0.08, 2500)
}

// ---- 두구두구 드럼롤 ----
let drumTimer: ReturnType<typeof setInterval> | null = null

export function startDrumroll(): void {
  if (drumTimer !== null) return
  if (!ac()) return
  let level = 0.045
  let alt = false
  drumTimer = setInterval(() => {
    burst(0, 0.05, level, alt ? 1600 : 2100) // 스네어
    beep(alt ? 150 : 135, 0.055, 'sine', level * 1.1) // 낮은 탐
    alt = !alt
    level = Math.min(0.17, level * 1.05) // 점점 크게 (크레셴도)
  }, 88)
}

export function stopDrumroll(): void {
  if (drumTimer !== null) {
    clearInterval(drumTimer)
    drumTimer = null
  }
}

/** 당첨 팡파레 — 크래시 + 코드 스탭 + 아르페지오 */
export function fanfare(): void {
  stopDrumroll()
  burst(0, 0.55, 0.16, 6500) // 심벌 크래시
  burst(0, 0.12, 0.14, 300) // 킥
  // 코드 스탭 (C 메이저)
  for (const f of [261.63, 329.63, 392.0, 523.25]) {
    beep(f, 0.5, 'sawtooth', 0.055)
    beep(f * 2, 0.35, 'triangle', 0.05)
  }
  // 아르페지오
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
  notes.forEach((f, i) => {
    beep(f, 0.28, 'triangle', 0.13, 0.1 + i * 0.09)
    beep(f, 0.28, 'square', 0.03, 0.1 + i * 0.09)
  })
  // 마무리 하이 노트 + 크래시
  beep(1568, 0.7, 'triangle', 0.12, 0.58)
  burst(0.58, 0.4, 0.1, 7000)
}

/** 최종 확정 피날레 — 당첨 팡파레보다 한층 크고 긴 축포 */
export function finale(): void {
  stopDrumroll()
  // 축포 두 방
  burst(0, 0.6, 0.18, 6500)
  burst(0, 0.15, 0.16, 250)
  burst(0.5, 0.5, 0.14, 7000)
  // 코드 진행: C → F → G → C (한 옥타브 위 마무리)
  const chords: [number, number[]][] = [
    [0, [261.63, 329.63, 392.0]],
    [0.3, [349.23, 440.0, 523.25]],
    [0.6, [392.0, 493.88, 587.33]],
    [0.9, [523.25, 659.25, 783.99, 1046.5]],
  ]
  for (const [when, notes] of chords) {
    for (const f of notes) {
      beep(f, 0.42, 'sawtooth', 0.05, when)
      beep(f, 0.42, 'triangle', 0.07, when)
    }
  }
  // 상승 아르페지오 런
  const run = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1318.5, 1568.0]
  run.forEach((f, i) => beep(f, 0.22, 'triangle', 0.12, 1.25 + i * 0.07))
  // 마무리 하이 노트 + 크래시
  beep(2093, 0.9, 'triangle', 0.13, 1.85)
  burst(1.85, 0.55, 0.12, 8000)
}

/** 리롤권 획득 — 급상승 슬라이드 + 종소리 */
export function rerollChime(): void {
  beep(300, 0.28, 'sawtooth', 0.1, 0, 1200) // 급상승 스윕
  beep(880, 0.18, 'triangle', 0.12, 0.22)
  beep(1174.7, 0.35, 'triangle', 0.13, 0.34)
  burst(0.34, 0.25, 0.07, 5000)
}

/** 연결 끊김 경보 — 주의를 끄는 2음 사이렌 3회 */
export function connectionLost(): void {
  for (let i = 0; i < 3; i++) {
    const t = i * 0.3
    beep(880, 0.14, 'square', 0.16, t)
    beep(660, 0.16, 'square', 0.16, t + 0.15)
  }
}

/** 연결 복구 — 짧은 상승 2음 */
export function connectionRestored(): void {
  beep(660, 0.12, 'triangle', 0.13)
  beep(990, 0.22, 'triangle', 0.14, 0.12)
}

/** 폭죽 "펑" — 짧고 강한 파열음 + 저음 충격 */
export function pop(when = 0): void {
  burst(when, 0.09, 0.22, 1200) // 파열
  burst(when, 0.35, 0.1, 5600) // 흩어지는 잔향
  beep(90, 0.14, 'sine', 0.2, when) // 저음 충격
}
