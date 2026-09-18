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

/** 돌림판 날개가 핀에 부딪히는 "딸깍" 한 번 — 실제 룰렛 래칫 소리.
 *  룰렛이 핀(24개) 하나를 지날 때마다 호출된다. 빠를 땐 따다다닥, 느려지면 딸깍… 딸깍… 간격이 벌어진다.
 *  progress(0~1): 감속 진행도 — 멈추기 직전일수록 조금 더 밝고 크게 */
export function tick(progress = 0): void {
  const detune = 1 + (Math.random() - 0.5) * 0.1 // 핀마다 미세하게 다른 소리
  // 1) 딱 — 날개가 핀을 때리는 아주 짧은 타격 노이즈
  burst(0, 0.012, 0.17 + 0.05 * progress, 5200 + 1200 * progress)
  // 2) 톡 — 플라스틱 날개의 짧은 울림 (음정 몸통)
  beep((1450 + 700 * progress) * detune, 0.022, 'triangle', 0.15 + 0.05 * progress)
  // 3) 둔탁한 저음 바디 — 판에 전달되는 진동
  beep(330 * detune, 0.03, 'sine', 0.09)
  if (progress > 0.8) {
    // 멈추기 직전엔 저음 심장박동을 한 겹 더
    beep(110 + 50 * progress, 0.07, 'sine', 0.12)
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
