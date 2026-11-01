// 패치노트용 GIF 공통 도구 (capture.mjs · patch-gifs.mjs)
// page.screenshot()은 초당 5장 정도라 끊기므로 CDP 스크린캐스트로 프레임을 받고,
// 네이버 카페 1장 한도(10MB)에 맞게 색상 수 → 프레임 간격 순으로 줄여 가며 인코딩한다.
// 화면 전체(1920×1280)를 담아도 작게 — 프레임마다 "바뀐 픽셀만" 남기고 나머지는 투명으로 둔다(앞 프레임 유지).
import { PNG } from 'pngjs'
import gifenc from 'gifenc'
import fs from 'node:fs'
const { GIFEncoder, quantize, applyPalette } = gifenc

/** 스크린캐스트를 켠다. stop()은 끄고 받은 프레임 [{ts, data}]을 돌려준다 */
export async function startCast(page, { maxWidth, maxHeight }) {
  const client = await page.context().newCDPSession(page)
  const shots = []
  client.on('Page.screencastFrame', async (f) => {
    shots.push({ ts: Date.now(), data: f.data })
    try {
      await client.send('Page.screencastFrameAck', { sessionId: f.sessionId })
    } catch {
      /* 이미 종료됨 */
    }
  })
  await client.send('Page.startScreencast', { format: 'png', maxWidth, maxHeight, everyNthFrame: 1 })
  return {
    stop: async () => {
      await client.send('Page.stopScreencast')
      return shots
    },
  }
}

/** 프레임 하나를 RGBA로 (clip이 있으면 그 부분만). 큰 화면이라 한 장씩 풀어 쓴다 */
function decode(shot, clip) {
  const png = PNG.sync.read(Buffer.from(shot.data, 'base64'))
  const c = clip
    ? { x: Math.round(clip.x), y: Math.round(clip.y), w: Math.round(clip.width), h: Math.round(clip.height) }
    : { x: 0, y: 0, w: png.width, h: png.height }
  const W = Math.min(c.w, png.width - c.x)
  const H = Math.min(c.h, png.height - c.y)
  const px = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    const si = ((c.y + y) * png.width + c.x) * 4
    px.set(png.data.subarray(si, si + W * 4), y * W * 4)
  }
  for (let i = 3; i < px.length; i += 4) px[i] = 255
  return { px, W, H }
}

/** 프레임들 → GIF 파일. clip({x,y,width,height}, 스크린캐스트 픽셀)이 있으면 그 부분만 담는다.
 *  until(ts)을 주면 마지막 프레임을 그때까지 보여 준다 — 스크린캐스트는 화면이 안 바뀌면 프레임을 안 보내므로 길이를 맞추려면 필요 */
export function writeGif(shots, out, { clip, until, budget = 9_000_000 } = {}) {
  const encode = (colors, gap) => {
    // 앞 프레임에서 gap(ms) 안에 온 프레임은 건너뛴다 — 초당 장수를 고르게 줄이는 손잡이.
    // GIF 지연은 1/100초 단위이고 2칸(20ms)보다 짧으면 브라우저가 느리게 틀어 길이가 늘어나므로 최소 20ms
    const idx = []
    for (let i = 0; i < shots.length; i++) if (!idx.length || shots[i].ts - shots[idx.at(-1)].ts >= gap) idx.push(i)
    const t0 = shots[0].ts
    const cs = (ts) => Math.round((ts - t0) / 10) * 10 // 누적 시각을 반올림해 프레임마다 생기는 오차가 쌓이지 않게
    // 장면이 바뀌는 GIF도 있으니 고르게 8장을 골라 팔레트를 만든다 (맨 끝 1칸은 투명용으로 비워 둔다)
    const picks = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.98].map((p) => idx[Math.min(idx.length - 1, Math.floor(idx.length * p))])
    const frames = picks.map((fi) => decode(shots[fi], clip))
    const { W, H } = frames[0]
    const sample = new Uint8ClampedArray(W * H * 4 * frames.length)
    frames.forEach((f, k) => sample.set(f.px, k * W * H * 4))
    const colorsOnly = quantize(sample, colors - 1)
    const T = colorsOnly.length // 투명 칸
    const palette = [...colorsOnly, [255, 0, 255]]

    const gif = GIFEncoder()
    let prev = null
    idx.forEach((fi, k) => {
      const { px } = decode(shots[fi], clip)
      const cur = applyPalette(px, colorsOnly)
      let frame = cur
      if (prev) {
        // 앞 프레임과 같은 픽셀은 투명 — 앞 프레임이 그대로 보인다(dispose 1). 바뀐 곳만 남아 용량이 확 준다
        frame = cur.slice()
        for (let i = 0; i < cur.length; i++) if (cur[i] === prev[i]) frame[i] = T
      }
      // 프레임 사이 실제 간격 그대로 — 화면이 멈춰 있던 시간도 그만큼 보여야 영상 길이가 맞는다
      const nextTs = shots[idx[k + 1]]?.ts ?? until ?? shots[fi].ts + Math.max(40, gap)
      const delay = Math.max(20, cs(nextTs) - cs(shots[fi].ts))
      gif.writeFrame(frame, W, H, {
        palette: k === 0 ? palette : undefined, // 팔레트는 처음 한 번만 (프레임마다 넣으면 장마다 768바이트씩)
        delay,
        dispose: 1,
        transparent: Boolean(prev),
        transparentIndex: T,
      })
      prev = cur
    })
    gif.finish()
    return { bytes: gif.bytes(), frames: idx.length, colors, W, H }
  }

  let best = null
  // [색 수, 프레임 최소 간격 ms] — 색부터 줄이고, 그래도 크면 초당 50 → 30 → 20 → 15 → 12 → 10장
  for (const [colors, gap] of [[192, 20], [144, 20], [144, 33], [128, 50], [112, 66], [112, 83], [96, 100]]) {
    best = encode(colors, gap)
    console.log(`  시도: ${colors}색 / ${best.frames}프레임 → ${(best.bytes.length / 1e6).toFixed(2)} MB`)
    if (best.bytes.length <= budget) break
  }
  fs.writeFileSync(out, Buffer.from(best.bytes))
  const secs = ((until ?? shots.at(-1).ts) - shots[0].ts) / 1000
  console.log(`GIF 저장: ${out} (${best.W}x${best.H}, ${best.frames}프레임, ${secs.toFixed(1)}초, ${best.colors}색, ${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`)
}
