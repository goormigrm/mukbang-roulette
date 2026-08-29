// 간단한 WebAudio 효과음 (외부 에셋 없이 합성)

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function beep(freq: number, dur: number, type: OscillatorType, gainV: number, when = 0): void {
  const a = ac()
  if (!a) return
  const t = a.currentTime + when
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(gainV, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(a.destination)
  osc.start(t)
  osc.stop(t + dur)
}

/** 룰렛 칸 넘어갈 때 틱 */
export function tick(): void {
  beep(1100, 0.04, 'square', 0.05)
}

/** 당첨 팡파레 */
export function fanfare(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((f, i) => beep(f, 0.35, 'triangle', 0.14, i * 0.12))
  beep(1318.5, 0.6, 'triangle', 0.12, 0.48)
}

/** 리롤권 획득 */
export function rerollChime(): void {
  beep(440, 0.12, 'sawtooth', 0.1)
  beep(880, 0.25, 'sawtooth', 0.1, 0.1)
}
