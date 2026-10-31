// 도네 한 건이 들어올 때 화면 다시 그리기(renderAll)가 몇 ms 걸리는지 — 메뉴 300종·피드 200줄·기록 20판
import { chromium } from 'playwright'
import fs from 'node:fs'
const all = JSON.parse(fs.readFileSync('../../public/sample-menus-120.json', 'utf8')).menus
const menus = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, ...all[i % 120], name: all[i % 120].name + (i >= 120 ? ` ${Math.floor(i / 120) + 1}` : '') }))
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 920 } })
await p.addInitScript((m) => { localStorage.setItem('mr:menus', JSON.stringify(m)); for (const k of ['mr:round', 'mr:feed', 'mr:history']) localStorage.removeItem(k); localStorage.setItem('mr:settings', JSON.stringify({ sound: false })) }, menus)
await p.goto('http://localhost:5173/mukbang-roulette/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => !!window.__store)
const r = await p.evaluate(async () => {
  const s = window.__store
  for (let i = 0; i < 20; i++) { s.beginSpin(); s.pickWinner(); s.finishSpin(); s.confirmResult() }
  for (let i = 0; i < 220; i++) s.addFeed('info', `채우기 ${i} — 피드를 200줄까지 채운다`)
  s.beginSpin() // 도는 중 (도네는 무시되고 피드만 늘어난다)
  const times = []
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now()
    s.handleDonation({ id: 'x' + i, nick: '시청자' + i, amount: 3000, message: '메뉴' + i, isVideo: false })
    times.push(performance.now() - t0)
    await new Promise((r) => setTimeout(r, 30))
  }
  times.sort((a, b) => a - b)
  return { 중앙ms: times[15].toFixed(1), 최대ms: times.at(-1).toFixed(1) }
})
console.log(JSON.stringify({ 도네한건_다시그리기: r }))
await b.close()
