// 공지용 GIF 한 장 — 실제 방송 화면 그대로(1920×1080 전체화면), 도네 피드를 채운 채로 장면 셋을 이어 붙인다.
//   npm run dev  (다른 창)  →  node patch-gifs.mjs
//   docs/patch-2026-11-01.gif
//     🍜 새 메뉴는 맨 위 · 칸이 늘면 반짝 · 볼펜으로 이름을 고쳐 같은 메뉴가 되면 합침 · 도네 피드
//     🎡 돌리기 → (감속 앞부분은 잘라 냄) 멈추는 마지막 4초 — 포인터 튕김 · 흰 번쩍임 → 당첨 도장
//     🔄 리롤 접수 → 룰렛 옆 카드(지금/다음 금액) → 리롤권 구매 감사 카드 → 리롤 쓰면 카드가 다음 금액으로
// 개발 서버를 쓰는 이유: 상태를 만들려면 window.__store·__wheel(개발 전용)이 필요하다.
import { chromium } from 'playwright'
import fs from 'node:fs'
import { startCast, writeGif } from './gif.mjs'

const SITE = process.argv[2] ?? 'http://localhost:5173/mukbang-roulette/'
const OUT = '../../docs/patch-2026-11-01.gif'
const VW = 1920 // 1920×1080 모니터에서 [전체화면]을 켠 크기 — 방송에 나가는 화면
const VH = 1080
const sample120 = JSON.parse(fs.readFileSync('../../public/sample-menus-120.json', 'utf8')).menus

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: VW, height: VH } })
await page.addInitScript((m) => {
  for (const k of ['mr:round', 'mr:history', 'mr:paused']) localStorage.removeItem(k)
  localStorage.setItem('mr:menus', JSON.stringify(m.map((x, i) => ({ id: i + 1, ...x }))))
  localStorage.setItem('mr:settings', JSON.stringify({ sound: false }))
  // 피드가 비어 있으면 어색하다 — 목록 위쪽 메뉴들이 30초~15분 전에 들어온 것처럼 채운다 (새것이 위)
  const at = (sec) => new Date(Date.now() - sec * 1000).toTimeString().slice(0, 8)
  const feed = m.slice(-26).reverse().map((x, k) => {
    const slots = Math.min(x.weight, 10)
    return { time: at(30 + k * 37), kind: 'add', text: `🍜 [${x.donors[0]}] ${(slots * 1000).toLocaleString('ko-KR')}치즈 → "${x.name}" ×${slots}` }
  })
  feed.push({ time: at(30 + 26 * 37), kind: 'info', text: '🟢 치지직 연결 완료 — 후원 이벤트 수신 시작' })
  localStorage.setItem('mr:feed', JSON.stringify(feed))
}, sample120)
await page.goto(SITE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => Boolean(window.__store && window.__wheel))
await page.evaluate(() => document.fonts.ready)
// 방송 화면처럼 — 룰렛 이름과 머리줄 연결 상태 (개발 서버는 치지직에 안 붙어 있으므로 겉모양만 바꾼다)
await page.evaluate(() => {
  window.__store.setTitle('메인 메뉴')
  const badge = document.querySelector('#conn-badge')
  badge.className = 'hdr-pill badge badge-on'
  badge.textContent = '🟢 치지직 수신 중'
  document.querySelector('#btn-chzzk-login').hidden = true
  document.querySelector('#btn-chzzk-logout').hidden = false
})
await page.waitForTimeout(800)

const wait = (ms) => page.waitForTimeout(ms)
const until = (t) => wait(Math.max(0, t - Date.now()))
const donate = (id, nick, amount, message) =>
  page.evaluate((d) => window.__store.handleDonation({ ...d, isVideo: false }), { id, nick, amount, message })
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel)

const cast = await startCast(page, { maxWidth: VW, maxHeight: VH })
const cuts = [] // [시작, 끝] 실제 시각 — 이 구간만 이어 붙인다

// ---- 🍜 후보 메뉴 (6초) ----
{
  const t0 = Date.now()
  await wait(300)
  await donate('m1', '떡볶이요정', 3000, '바질 크림파스타') // 새 메뉴 → 맨 위에 반짝
  await wait(800)
  await donate('m2', '면치기장인', 5000, sample120.at(-2).name) // 이미 있는 메뉴 → 그 줄이 반짝
  await wait(800)
  await donate('m3', '분식집딸', 4000, '크림파스타') // 비슷한 이름이 따로 들어옴
  await wait(700)
  // 진행자가 볼펜으로 이름을 고치면 → 같은 메뉴로 합쳐짐 (칸 3+4, 쏜 사람 둘 다)
  await page.click('.menu-list .menu-item:first-child .edit')
  await page.keyboard.type('바질 크림파스타', { delay: 60 })
  await wait(350)
  await page.keyboard.press('Enter')
  await until(t0 + 6000)
  cuts.push([t0, t0 + 6000])
}

// ---- 🎡 룰렛 — 돌리기 0.8초 + 멈추는 마지막 4초 + 도장 ----
{
  await click('#btn-spin')
  const t0 = Date.now()
  await wait(1300)
  cuts.push([t0, t0 + 800])
  await click('#btn-spin') // 정지 → 7~9초 감속
  await page.waitForFunction(() => !window.__wheel.isSpinning, null, { polling: 30, timeout: 20000 })
  const end = Date.now()
  await wait(1300)
  cuts.push([end - 4000, end + 1300])
  await wait(3000) // 색종이가 가라앉을 때까지 (안 담음)
}

// ---- 🔄 리롤 (5초) — 리롤로 다시 도는 건 카드가 바뀌는 게 보일 만큼만(돌아가는 장면은 용량이 크다) ----
{
  const t0 = Date.now()
  await wait(300)
  await page.evaluate(() => window.__store.startRerollWindow(20000, 40000)) // 이번 2만 · 다음 4만
  await wait(1300)
  await donate('g1', '면치기장인', 20000, '') // 리롤권 → 감사 카드
  await wait(2000)
  await click('#btn-reroll') // 마지막 리롤권 → 카드가 다음 금액으로
  await until(t0 + 5000)
  cuts.push([t0, t0 + 5000])
}

const all = await cast.stop()
await browser.close()

// 구간을 이어 붙여 시각을 0부터 다시 매긴다. 화면이 안 바뀌면 프레임이 안 오므로 구간 시작 직전 프레임을 첫 장으로
const shots = []
let at = 0
for (const [from, to] of cuts) {
  const before = all.filter((s) => s.ts < from).at(-1)
  if (before) shots.push({ data: before.data, ts: at })
  for (const s of all) if (s.ts >= from && s.ts < to) shots.push({ data: s.data, ts: at + s.ts - from })
  at += to - from
}
writeGif(shots, OUT, { until: at })
