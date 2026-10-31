// 배포된 먹방 룰렛을 헤드리스 크롬으로 열어, 당첨 순간(폭죽 + 색종이)을 GIF로 만든다.
// page.screenshot()은 초당 5장 정도밖에 못 찍어 끊기므로 CDP 스크린캐스트로 받는다.
import { chromium } from 'playwright'
import { startCast, writeGif } from './gif.mjs'
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

const clickSpin = () => page.evaluate(() => document.querySelector('#btn-spin').click())
await clickSpin()
await page.waitForTimeout(1400) // 최소 회전 시간(1초) 경과 후 정지
await clickSpin()
await page.evaluate(() => window.scrollTo(0, 0)) // 화면 전체가 나오도록 맨 위로
// 감속이 끝나갈 무렵부터 받기 시작 (앞부분까지 다 받으면 메모리 낭비)
await page.waitForTimeout(7000)
const cast = await startCast(page, { maxWidth: 760, maxHeight: 594 })

await page.waitForFunction(() => !document.querySelector('#winner-stamp')?.hidden, null, {
  timeout: 20000,
  polling: 16,
})
const winAt = Date.now()
await page.waitForTimeout(POST_MS)
const shots = await cast.stop()
await browser.close()

const all = shots.filter((s) => s.ts >= winAt - PRE_MS && s.ts <= winAt + POST_MS)
const picked = all // 전 프레임 사용 (부드럽게)
console.log(`스크린캐스트 ${shots.length}장 중 ${picked.length}장 사용`)

// 확인용 샘플 — 당첨 후 0.15 / 0.45 / 0.9초 시점
;[150, 450, 900].forEach((ms, k) => {
  const i = picked.findIndex((s) => s.ts >= winAt + ms)
  if (i >= 0) fs.writeFileSync(`sample-${k}.png`, Buffer.from(picked[i].data, 'base64'))
})

writeGif(picked, OUT)
