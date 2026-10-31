// 단계별로 룰렛 칸(왼쪽 프레임) 안에 내용이 다 들어가는지 잰다 — 넘치면 아래 버튼이 잘린다
import { chromium } from 'playwright'
const SITE = 'http://localhost:5173/mukbang-roulette/'
const OUT = process.env.SHOT_DIR ?? '.'
const SIZES = [[1920, 860], [1920, 920], [1920, 1080], [1500, 900], [1280, 800]]
const b = await chromium.launch()
for (const [w, h] of SIZES) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.addInitScript(() => { for (const k of ['mr:menus','mr:round','mr:history','mr:feed']) localStorage.removeItem(k); localStorage.setItem('mr:settings', JSON.stringify({ sound: false })) })
  await p.goto(SITE, { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  const fit = () => p.evaluate(() => {
    const a = document.querySelector('.wheel-area')
    const last = document.querySelector('.shortcut-hint').getBoundingClientRect()
    const top = document.querySelector('.wheel-area > *:not([hidden])').getBoundingClientRect()
    const ar = a.getBoundingClientRect()
    return { 넘침px: Math.max(0, Math.round(a.scrollHeight - a.clientHeight)), 위잘림: top.top < ar.top, 아래여유px: Math.round(ar.bottom - last.bottom), 룰렛: Math.round(document.getElementById('wheel').getBoundingClientRect().width), 페이지스크롤: document.documentElement.scrollHeight - innerHeight }
  })
  const out = {}
  await p.evaluate(() => { const s = window.__store; for (const [n, wt] of [['짬뽕',5],['짜장',3],['탕수육',2]]) s.addMenu(n, wt, '가') })
  out.모집 = await fit()
  await p.evaluate(() => { const s = window.__store; s.beginSpin(); s.pickWinner(); s.finishSpin() })
  await p.waitForTimeout(200)
  out.당첨발표 = await fit()
  await p.evaluate(() => { const s = window.__store; s.startRerollWindow(30000, 50000); s.handleDonation({ id: 'x', nick: '큰손', amount: 30000, message: '', isVideo: false }) })
  await p.waitForTimeout(200)
  out.리롤접수 = await fit()
  await p.screenshot({ path: `${OUT}/phase-window-${w}x${h}.png` })
  console.log(`${w}x${h}`, JSON.stringify(out))
  await p.close()
}
await b.close()
