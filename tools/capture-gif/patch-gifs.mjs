// 공지 5차(10/8~10/31)용 GIF 3장 — 시청자에게 보이는 바뀐 점만.
//   npm run dev  (다른 창)  →  node patch-gifs.mjs
//   docs/patch-2026-10-31-reroll.gif  리롤 접수 → 리롤권 구매(감사 카드) → 지금/다음 금액 카드 → 리롤 쓰면 다음 금액으로
//   docs/patch-2026-10-31-stop.gif    멈추는 순간 — 포인터 튕김 · 흰 번쩍임 · 이름이 한 박자 (GIF라 소리는 없음)
//   docs/patch-2026-10-31-menus.gif   후보 목록 — 새 메뉴는 맨 위, 칸이 늘면 반짝, 도네 피드 늘 표시
// 개발 서버를 쓰는 이유: 상태를 만들려면 window.__store·__wheel(개발 전용)이 필요하다.
import { chromium } from 'playwright'
import fs from 'node:fs'
import { startCast, writeGif } from './gif.mjs'

const SITE = process.argv[2] ?? 'http://localhost:5173/mukbang-roulette/'
const OUT = '../../docs'
const VW = 1920 // 1920 모니터의 크롬 창 크기 — 시청자가 실제로 보는 화면
const VH = 920
const sample120 = JSON.parse(fs.readFileSync('../../public/sample-menus-120.json', 'utf8')).menus

const browser = await chromium.launch()

/** 새 탭을 열고 메뉴를 심은 뒤 개발 훅이 뜰 때까지 기다린다 */
async function open(menus) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } })
  await page.addInitScript((m) => {
    for (const k of ['mr:round', 'mr:feed', 'mr:history', 'mr:paused']) localStorage.removeItem(k)
    localStorage.setItem('mr:menus', JSON.stringify(m.map((x, i) => ({ id: i + 1, ...x }))))
    localStorage.setItem('mr:settings', JSON.stringify({ sound: false }))
  }, menus)
  await page.goto(SITE, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(window.__store && window.__wheel))
  await page.evaluate(() => document.fonts.ready)
  return page
}
const rectOf = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }, sel)
const wait = (page, ms) => page.waitForTimeout(ms)

// ---- 1) 리롤 ----
{
  const page = await open(sample120.slice(100, 114))
  await page.evaluate(() => {
    const s = window.__store
    s.setTitle('메인 메뉴')
    s.beginSpin()
    s.pickWinner()
    s.finishSpin()
  })
  await wait(page, 4000) // 당첨 도장·색종이가 가라앉을 때까지
  const clip = await rectOf(page, '.wheel-area')
  const cast = await startCast(page, { maxWidth: VW, maxHeight: VH })
  await wait(page, 700)
  await page.evaluate(() => window.__store.startRerollWindow(20000, 40000)) // 이번 2만 · 다음 4만
  await wait(page, 1500)
  await page.evaluate(() => window.__store.handleDonation({ id: 'g1', nick: '면치기장인', amount: 20000, message: '', isVideo: false }))
  await wait(page, 1800)
  await page.evaluate(() => document.querySelector('#btn-reroll').click()) // 마지막 리롤권 → 다음 금액으로
  await wait(page, 1800)
  writeGif(await cast.stop(), `${OUT}/patch-2026-10-31-reroll.gif`, { clip })
  await page.close()
}

// ---- 2) 멈추는 순간 ----
{
  const page = await open(sample120.slice(0, 30))
  await page.evaluate(() => document.querySelector('#btn-spin').click())
  await wait(page, 1300)
  await page.evaluate(() => document.querySelector('#btn-spin').click()) // 정지
  await page.waitForFunction(() => window.__wheel.progressAt(performance.now()) > 0.58, null, { polling: 30, timeout: 20000 })
  const c = await rectOf(page, '#wheel')
  const clip = { x: c.x, y: c.y, width: c.width, height: c.height * 0.6 }
  const cast = await startCast(page, { maxWidth: VW, maxHeight: VH })
  await page.waitForFunction(() => !window.__wheel.isSpinning, null, { polling: 30, timeout: 20000 })
  await wait(page, 500)
  writeGif(await cast.stop(), `${OUT}/patch-2026-10-31-stop.gif`, { clip })
  await page.close()
}

// ---- 3) 후보 목록 ----
{
  const page = await open(sample120)
  await wait(page, 500)
  // 후보 + 도네 피드 두 칸
  const a = await rectOf(page, '.side')
  const b = await rectOf(page, '.feed-col')
  const clip = { x: a.x - 10, y: a.y - 8, width: b.x + b.width - a.x + 20, height: Math.max(a.height, b.height) + 16 }
  // 새 메뉴와, 목록 위쪽에 보이는 기존 메뉴(파일 끝쪽 = 목록 맨 위)를 번갈아
  const top = sample120.slice(-4).map((m) => m.name)
  const plan = [
    ['바질 크림파스타', '떡볶이요정', 3000], // 새 메뉴 → 맨 위
    [top[1], '면치기장인', 5000], // 이미 있는 메뉴 → 그 줄이 반짝
    ['흑돼지 오겹살', '고기굽는남자', 7000],
    ['바질크림파스타 추가', '분식집딸', 4000], // 띄어쓰기·"추가"가 달라도 같은 메뉴로 합쳐져 반짝
    [top[3], '야식요정', 2000],
    ['훈제연어 샐러드', '연어사랑', 3000],
  ]
  const cast = await startCast(page, { maxWidth: VW, maxHeight: VH })
  await wait(page, 500)
  for (const [i, [msg, nick, amt]] of plan.entries()) {
    await page.evaluate(([m, n, a, k]) => window.__store.handleDonation({ id: `m${k}`, nick: n, amount: a, message: m, isVideo: false }), [msg, nick, amt, i])
    await wait(page, 900)
  }
  await wait(page, 700)
  writeGif(await cast.stop(), `${OUT}/patch-2026-10-31-menus.gif`, { clip })
  await page.close()
}

await browser.close()
