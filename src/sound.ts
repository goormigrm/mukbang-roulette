// WebAudio 효과음 (외부 에셋 없이 합성)
// - tick: 칸 넘김 클릭. 감속 구간에서는 진행도에 따라 음정이 올라가 긴장감을 만든다
// - drumroll: 정지 버튼 이후 "두구두구" — 점점 커지는 스네어 롤
// - fanfare: 당첨 — 심벌 크래시 + 코드 스탭 + 아르페지오
// - rerollChime: 리롤권 획득 — 급상승 슬라이드

let ctx: AudioContext | null = null
let noiseBuf: AudioBuffer | null = null

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
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
  gain.gain.setValueAtTime(gainV, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(a.destination)
  osc.start(t)
  osc.stop(t + dur)
}

/** 밴드패스 필터를 거친 노이즈 버스트 (스네어/심벌 느낌) */
function burst(when: number, dur: number, gainV: number, filterFreq: number): void {
  const a = ac()
  if (!a) return
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.3, a.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  const t = a.currentTime + when
  const src = a.createBufferSource()
  src.buffer = noiseBuf
  const filter = a.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = filterFreq
  filter.Q.value = 0.8
  const gain = a.createGain()
  gain.gain.setValueAtTime(gainV, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(gain).connect(a.destination)
  src.start(t)
  src.stop(t + dur)
}

/** 룰렛 칸 넘어갈 때 틱. progress(0~1)가 커질수록(멈추기 직전일수록) 음정이 올라간다 */
export function tick(progress = 0): void {
  const f = 900 + 700 * progress
  beep(f, 0.035, 'square', 0.045 + 0.04 * progress)
  burst(0, 0.02, 0.02 + 0.02 * progress, 3800)
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

/** 리롤권 획득 — 급상승 슬라이드 + 종소리 */
export function rerollChime(): void {
  beep(300, 0.28, 'sawtooth', 0.1, 0, 1200) // 급상승 스윕
  beep(880, 0.18, 'triangle', 0.12, 0.22)
  beep(1174.7, 0.35, 'triangle', 0.13, 0.34)
  burst(0.34, 0.25, 0.07, 5000)
}
