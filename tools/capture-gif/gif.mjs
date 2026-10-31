// 패치노트용 GIF 공통 도구 (capture.mjs · patch-gifs.mjs)
// page.screenshot()은 초당 5장 정도라 끊기므로 CDP 스크린캐스트로 프레임을 받고,
// 네이버 카페 1장 한도(10MB)에 맞게 색상 수 → 프레임 간격 순으로 줄여 가며 인코딩한다.
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

/** 프레임들 → GIF 파일. clip({x,y,width,height}, 스크린캐스트 픽셀)이 있으면 그 부분만 담는다 */
export function writeGif(shots, out, { clip, budget = 9 * 1024 * 1024 } = {}) {
  const rgba = []
  let W = 0
  let H = 0
  for (const s of shots) {
    const png = PNG.sync.read(Buffer.from(s.data, 'base64'))
    const c = clip
      ? { x: Math.round(clip.x), y: Math.round(clip.y), w: Math.round(clip.width), h: Math.round(clip.height) }
      : { x: 0, y: 0, w: png.width, h: png.height }
    W = Math.min(c.w, png.width - c.x)
    H = Math.min(c.h, png.height - c.y)
    const px = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = ((c.y + y) * png.width + (c.x + x)) * 4
        const di = (y * W + x) * 4
        px[di] = png.data[si]
        px[di + 1] = png.data[si + 1]
        px[di + 2] = png.data[si + 2]
        px[di + 3] = 255
      }
    }
    rgba.push(px)
  }

  const encode = (colors, stride) => {
    const idx = []
    for (let i = 0; i < rgba.length; i += stride) idx.push(i)
    // 장면이 바뀌는 GIF도 있으니 고르게 6장을 골라 팔레트를 만든다
    const picks = [0, 0.2, 0.4, 0.6, 0.8, 0.98].map((p) => idx[Math.min(idx.length - 1, Math.floor(idx.length * p))])
    const sample = new Uint8ClampedArray(W * H * 4 * picks.length)
    picks.forEach((fi, k) => sample.set(rgba[fi], k * W * H * 4))
    const palette = quantize(sample, colors)
    const gif = GIFEncoder()
    idx.forEach((fi, k) => {
      const nextTs = shots[idx[k + 1]]?.ts ?? shots[fi].ts + 40 * stride
      const delay = Math.min(200, Math.max(20, nextTs - shots[fi].ts))
      gif.writeFrame(applyPalette(rgba[fi], palette), W, H, { palette, delay })
    })
    gif.finish()
    return { bytes: gif.bytes(), frames: idx.length, colors }
  }

  let best = null
  for (const [colors, stride] of [[192, 1], [144, 1], [112, 1], [160, 2], [112, 2], [96, 3]]) {
    best = encode(colors, stride)
    console.log(`  시도: ${colors}색 / ${best.frames}프레임 → ${(best.bytes.length / 1024 / 1024).toFixed(2)} MB`)
    if (best.bytes.length <= budget) break
  }
  fs.writeFileSync(out, Buffer.from(best.bytes))
  const secs = (shots.at(-1).ts - shots[0].ts) / 1000
  console.log(`GIF 저장: ${out} (${W}x${H}, ${best.frames}프레임, ${secs.toFixed(1)}초, ${best.colors}색, ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`)
}
