// 배포된 먹방 룰렛을 헤드리스 크롬으로 열어, 당첨 순간(폭죽 + 색종이)을 GIF로 만든다.
// page.screenshot()은 초당 5장 정도밖에 못 찍어 끊기므로 CDP 스크린캐스트로 받는다.
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import gifenc from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = gifenc
import fs from 'node:fs'

const SITE = 'https://goormigrm.github.io/mukbang-roulette/'
const OUT = process.argv[2] ?? 'celebration.gif'
const VW = 1280
const VH = 1000
const PRE_MS = 300 // 당첨 직전 여유
const POST_MS = 2200 // 당첨 후 담을 길이

const MENUS = [
  ['차돌짬뽕', 27, ['짬뽕순대', '면치기장인']],
  ['마라탕', 19, ['마라중독자']],
  ['양꼬치에칭따오', 15, ['칭따오한잔', '꼬치왕']],
  ['곱창전골', 14, ['곱창러버']],
  ['후라이드치킨', 12, ['치킨은살안쪄']],
  ['탕수육 부먹', 11, ['부먹파영원히']],
  ['탕수육 찍먹', 11, ['찍먹이정답']],
  ['대창덮밥', 9, ['기름진게좋아']],
  ['마라샹궈', 8, ['매운맛5단계']],
  ['삼겹살 2인분', 8, ['고기굽는남자']],
  ['족발 大', 7, ['야식요정']],
  ['간장게장', 7, ['밥도둑잡아라']],
  ['멘보샤', 6, ['새우토스트']],
  ['치즈돈까스', 5, ['치즈늘어남']],
  ['부대찌개', 5, ['라면사리추가']],
  ['모둠회 특대', 5, ['회떠주세요']],
  ['로제떡볶이', 4, ['떡볶이요정']],
  ['짜장면 곱빼기', 4, ['면치기장인']],
  ['감자탕', 3, ['뼈해장국']],
  ['닭발', 3, ['불닭발']],
  ['초밥 20피스', 3, ['연어사랑']],
  ['김밥 두줄', 1, ['소액이라죄송']],
].map(([name, weight, donors], i) => ({ id: i + 1, name, weight, donors }))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: VW, height: VH } })

await page.addInitScript((menus) => {
  localStorage.setItem('mr:menus', JSON.stringify(menus))
  localStorage.removeItem('mr:round')
  localStorage.removeItem('mr:feed')
  localStorage.setItem('mr:settings', JSON.stringify({ sound: false }))
}, MENUS)

await page.goto(SITE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

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

const clickSpin = () => page.evaluate(() => document.querySelector('#btn-spin').click())
await clickSpin()
await page.waitForTimeout(1400) // 최소 회전 시간(1초) 경과 후 정지
await clickSpin()
await page.evaluate(() => window.scrollTo(0, 0)) // 화면 전체가 나오도록 맨 위로
// 감속이 끝나갈 무렵부터 받기 시작 (앞부분까지 다 받으면 메모리 낭비)
await page.waitForTimeout(7000)
await client.send('Page.startScreencast', { format: 'png', maxWidth: 760, maxHeight: 594, everyNthFrame: 1 })

await page.waitForFunction(() => !document.querySelector('#winner-stamp')?.hidden, null, {
  timeout: 20000,
  polling: 16,
})
const winAt = Date.now()
await page.waitForTimeout(POST_MS)
await client.send('Page.stopScreencast')
await browser.close()

const all = shots.filter((s) => s.ts >= winAt - PRE_MS && s.ts <= winAt + POST_MS)
const picked = all // 전 프레임 사용 (부드럽게)
console.log(`스크린캐스트 ${shots.length}장 중 ${picked.length}장 사용`)

const rgba = []
let W = 0
let H = 0
for (const s of picked) {
  const png = PNG.sync.read(Buffer.from(s.data, 'base64'))
  W = png.width
  H = png.height
  const out = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = png.data[i * 4]
    out[i * 4 + 1] = png.data[i * 4 + 1]
    out[i * 4 + 2] = png.data[i * 4 + 2]
    out[i * 4 + 3] = 255
  }
  rgba.push(out)
}

// 확인용 샘플 — 당첨 후 0.15 / 0.45 / 0.9초 시점
;[150, 450, 900].forEach((ms, k) => {
  const i = picked.findIndex((s) => s.ts >= winAt + ms)
  if (i >= 0) fs.writeFileSync(`sample-${k}.png`, Buffer.from(picked[i].data, 'base64'))
})

// 용량 목표(9MB)에 맞을 때까지 색상 수·프레임 간격을 조절해 가며 인코딩한다
const BUDGET = 9 * 1024 * 1024
function encode(colors, stride) {
  const idx = []
  for (let i = 0; i < rgba.length; i += stride) idx.push(i)
  const picks = [0, 0.25, 0.5, 0.8].map((p) => idx[Math.min(idx.length - 1, Math.floor(idx.length * p))])
  const sample = new Uint8ClampedArray(W * H * 4 * picks.length)
  picks.forEach((fi, k) => sample.set(rgba[fi], k * W * H * 4))
  const palette = quantize(sample, colors)
  const gif = GIFEncoder()
  idx.forEach((fi, k) => {
    const nextTs = picked[idx[k + 1]]?.ts ?? picked[fi].ts + 40 * stride
    const delay = Math.min(200, Math.max(20, nextTs - picked[fi].ts))
    gif.writeFrame(applyPalette(rgba[fi], palette), W, H, { palette, delay })
  })
  gif.finish()
  return { bytes: gif.bytes(), frames: idx.length, colors, stride }
}

let best = null
for (const [colors, stride] of [[192, 1], [144, 1], [112, 1], [160, 2], [112, 2]]) {
  best = encode(colors, stride)
  console.log(`  시도: ${colors}색 / ${best.frames}프레임 → ${(best.bytes.length / 1024 / 1024).toFixed(2)} MB`)
  if (best.bytes.length <= BUDGET) break
}
fs.writeFileSync(OUT, Buffer.from(best.bytes))
const secs = (picked.at(-1).ts - picked[0].ts) / 1000
console.log(
  `GIF 저장: ${OUT} (${W}x${H}, ${best.frames}프레임, ${secs.toFixed(1)}초, ${best.colors}색, ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)`,
)
