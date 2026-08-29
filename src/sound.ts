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

/** 룰렛 칸 넘어갈 때 틱 — 래칫(딸깍이) 느낌의 2중 레이어.
 *  자유 회전 중엔 두 음을 빠르게 교차(따다다닥), 감속 중엔 progress(0~1)에 따라
 *  음정과 볼륨이 점점 올라가 멈추기 직전이 가장 긴장되게 들린다 */
let tickAlt = false
export function tick(progress = 0): void {
  tickAlt = !tickAlt
  const stopping = progress > 0
  const f = stopping ? 1000 + 900 * progress : tickAlt ? 880 : 1040
  const g = stopping ? 0.07 + 0.07 * progress : 0.06
  beep(f, 0.028, 'square', g) // 딸깍 본체
  beep(f * 1.5, 0.02, 'triangle', g * 0.5) // 카랑한 상단 배음
  burst(0, 0.016, 0.045 + 0.04 * progress, 4600) // 나무 부딪는 타격감
  if (stopping && progress > 0.75) {
    // 막판엔 저음 심장박동을 한 겹 더
    beep(120 + 60 * progress, 0.06, 'sine', 0.09)
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

/** 리롤권 획득 — 급상승 슬라이드 + 종소리 */
export function rerollChime(): void {
  beep(300, 0.28, 'sawtooth', 0.1, 0, 1200) // 급상승 스윕
  beep(880, 0.18, 'triangle', 0.12, 0.22)
  beep(1174.7, 0.35, 'triangle', 0.13, 0.34)
  burst(0.34, 0.25, 0.07, 5000)
}
