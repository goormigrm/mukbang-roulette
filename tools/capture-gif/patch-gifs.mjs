// 공지 6차(10/31)용 GIF 3장 — 화면 전체 1920×1280, 한 장에 5초, 시청자에게 보이는 바뀐 점만.
//   npm run dev  (다른 창)  →  node patch-gifs.mjs
//   docs/patch-2026-10-31-menus.gif    🍜 새 메뉴는 맨 위 · 칸이 늘면 반짝 · 이름을 고쳐 같은 메뉴가 되면 합침 · 도네 피드
//   docs/patch-2026-10-31-reroll.gif   🔄 리롤 접수 → 룰렛 옆 카드(지금/다음 금액) → 리롤권 구매 감사 카드 → 리롤 쓰면 다음 금액으로
//   docs/patch-2026-10-31-roulette.gif 🎡 메뉴 120종 룰렛이 멈추는 마지막 5초 — 포인터 튕김 · 흰 번쩍임이 한 박자 (GIF라 소리는 없음)
// 개발 서버를 쓰는 이유: 상태를 만들려면 window.__store·__wheel(개발 전용)이 필요하다.
import { chromium } from 'playwright'
import fs from 'node:fs'
import { startCast, writeGif } from './gif.mjs'

const SITE = process.argv[2] ?? 'http://localhost:5173/mukbang-roulette/'
const OUT = '../../docs'
const VW = 1920
const VH = 1280
const SECS = 5000
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
const wait = (page, ms) => page.waitForTimeout(ms)
const donate = (page, id, nick, amount, message) =>
  page.evaluate((d) => window.__store.handleDonation({ ...d, isVideo: false }), { id, nick, amount, message })

/** 녹화를 켜고 run()을 돌린 뒤 5초만 GIF로 — 처음 5초, tail이면 끝 5초 */
async function record(page, out, run, tail = false) {
  const cast = await startCast(page, { maxWidth: VW, maxHeight: VH })
  const t0 = Date.now()
  await run()
  if (!tail) await wait(page, Math.max(0, t0 + SECS - Date.now()))
  const end = tail ? Date.now() : t0 + SECS
  const all = await cast.stop()
  // 화면이 안 바뀌면 프레임이 안 오므로, 시작 시각 직전 프레임을 첫 장으로 끌어온다
  const before = all.filter((s) => s.ts < end - SECS).at(-1)
  const shots = [...(before ? [{ ...before, ts: end - SECS }] : []), ...all.filter((s) => s.ts >= end - SECS && s.ts <= end)]
  writeGif(shots, `${OUT}/${out}`, { until: end })
  await page.close()
}

// ---- 🍜 후보 메뉴 ----
{
  const page = await open(sample120)
  await wait(page, 800)
  const top = sample120.at(-2).name // 목록 위쪽(파일 끝쪽)에 보이는 기존 메뉴
  await record(page, 'patch-2026-10-31-menus.gif', async () => {
    await wait(page, 300)
    await donate(page, 'm1', '떡볶이요정', 3000, '바질 크림파스타') // 새 메뉴 → 맨 위에 반짝
    await wait(page, 800)
    await donate(page, 'm2', '면치기장인', 5000, top) // 이미 있는 메뉴 → 그 줄이 반짝
    await wait(page, 800)
    await donate(page, 'm3', '분식집딸', 4000, '크림파스타') // 비슷한 이름이 따로 들어옴
    await wait(page, 700)
    // 진행자가 볼펜으로 이름을 고치면 → 같은 메뉴로 합쳐짐 (칸 3+4, 쏜 사람 둘 다)
    await page.click('.menu-list .menu-item:first-child .edit')
    await page.keyboard.type('바질 크림파스타', { delay: 60 })
    await wait(page, 350)
    await page.keyboard.press('Enter')
    await wait(page, 900)
  })
}

// ---- 🔄 리롤 ----
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
  await record(page, 'patch-2026-10-31-reroll.gif', async () => {
    await wait(page, 300)
    await page.evaluate(() => window.__store.startRerollWindow(20000, 40000)) // 이번 2만 · 다음 4만
    await wait(page, 1300)
    await donate(page, 'g1', '면치기장인', 20000, '') // 리롤권 → 감사 카드
    await wait(page, 1500)
    await page.evaluate(() => document.querySelector('#btn-reroll').click()) // 마지막 리롤권 → 카드가 다음 금액으로
    await wait(page, 1200)
  })
}

// ---- 🎡 룰렛 (120종) ----
{
  const page = await open(sample120)
  await page.evaluate(() => document.querySelector('#btn-spin').click())
  await wait(page, 1300)
  await record(page, 'patch-2026-10-31-roulette.gif', async () => {
    await page.evaluate(() => document.querySelector('#btn-spin').click()) // 정지 → 7~9초 감속
    await page.waitForFunction(() => !window.__wheel.isSpinning, null, { polling: 30, timeout: 20000 })
    await wait(page, 900) // 멈춘 칸 · 당첨 도장까지
  }, true)
}

await browser.close()
