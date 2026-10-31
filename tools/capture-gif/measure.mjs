// 화면 크기별로 "메뉴가 몇 줄 보이는지"·룰렛 크기·페이지 스크롤 여부를 잰다 (레이아웃 손볼 때 비교용)
//   npm run dev  (다른 창)  →  node measure.mjs [이름]   → scratch 폴더에 <이름>-<폭>x<높이>.png
import { chromium } from 'playwright'
import fs from 'node:fs'

const SITE = 'http://localhost:5173/mukbang-roulette/'
const TAG = process.argv[2] ?? 'now'
const OUT = process.env.SHOT_DIR ?? '.'
// 1920 모니터에서 크롬 탭·주소창·북마크줄·작업표시줄을 빼면 보이는 높이는 대략 이 정도다
const SIZES = [
  [1920, 920],
  [1920, 1080],
  [1920, 1120],
]
const menus = JSON.parse(fs.readFileSync('../../public/sample-menus-120.json', 'utf8')).menus

const b = await chromium.launch()
for (const [w, h] of SIZES) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.addInitScript((m) => {
    localStorage.setItem('mr:menus', JSON.stringify(m.map((x, i) => ({ id: i + 1, ...x }))))
    for (const k of ['mr:round', 'mr:history']) localStorage.removeItem(k)
    localStorage.setItem('mr:settings', JSON.stringify({ sound: false }))
  }, menus)
  await p.goto(SITE, { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  for (let i = 0; i < 12; i++) await p.evaluate((n) => window.__store?.handleDonation({ id: 'f' + n, nick: '시청자' + n, amount: 3000, message: '메뉴' + n, isVideo: false }), i)
  await p.waitForTimeout(300)
  const r = await p.evaluate(() => {
    const rect = (s) => document.querySelector(s)?.getBoundingClientRect()
    const vis = (listSel, itemSel) => {
      const l = rect(listSel)
      if (!l) return 0
      return [...document.querySelectorAll(itemSel)].filter((e) => {
        const b = e.getBoundingClientRect()
        return b.top >= l.top - 1 && b.bottom <= l.bottom + 1 && b.bottom <= innerHeight
      }).length
    }
    return {
      룰렛px: Math.round(rect('#wheel').width),
      후보줄: vis('#menu-list', '#menu-list .menu-item'),
      피드줄: vis('#feed-list', '#feed-list li'),
      페이지스크롤px: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      좌우여백px: Math.round(rect('.layout').left + (innerWidth - rect('.layout').right)),
      버튼아래: Math.round(rect('.controls').bottom),
    }
  })
  console.log(`${w}x${h}`, JSON.stringify(r))
  await p.screenshot({ path: `${OUT}/${TAG}-${w}x${h}.png` })
  await p.close()
}
await b.close()
