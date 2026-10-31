// 한 판을 실제로 돌리며 화면(포인터 위 이름이 바뀌는 프레임)과 딸깍 예약(tickEvents)이 맞는지,
// 프레임이 고른지, [정지] 순간 멈칫하는지 잰다.   npm run dev → node sync.mjs [메뉴수]
import { chromium } from 'playwright'
import fs from 'node:fs'
const N = Number(process.argv[2] ?? 120)
const DONATE = process.argv[3] !== 'quiet'
const all = JSON.parse(fs.readFileSync('../../public/sample-menus-120.json', 'utf8')).menus
const menus = Array.from({ length: N }, (_, i) => ({ id: i + 1, ...all[i % all.length], name: all[i % all.length].name + (i >= all.length ? ` ${Math.floor(i / all.length) + 1}` : '') }))
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 920 } })
await p.addInitScript((m) => { localStorage.setItem('mr:menus', JSON.stringify(m)); for (const k of ['mr:round','mr:feed']) localStorage.removeItem(k); localStorage.setItem('mr:settings', JSON.stringify({ sound: false })) }, menus)
await p.goto('http://localhost:5173/mukbang-roulette/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => !!window.__wheel)
const r = await p.evaluate(async (DONATE) => {
  const w = window.__wheel
  const frames = [] // [time, rotation, segIdx] — 룰렛이 실제로 그릴 때 기록 (화면에 나간 그대로)
  let run = true
  const draw = w.draw.bind(w)
  w.draw = () => { draw(); if (run) frames.push([performance.now(), w.rotation, w.segIdx]) }
  // 돌면서 도네가 계속 들어와 화면이 다시 그려지는 상황도 같이 (방송 그대로)
  let n = 0
  const donor = setInterval(() => { if (DONATE) window.__store.handleDonation({ id: 'd' + n++, nick: '시청자' + n, amount: 3000, message: '새메뉴' + n, isVideo: false }) }, 300)
  document.querySelector('#btn-spin').click()
  await new Promise((r) => setTimeout(r, 1500))
  const stopAt = performance.now()
  document.querySelector('#btn-spin').click()
  // 감속 끝까지
  await new Promise((r) => { const iv = setInterval(() => { if (!w.isSpinning) { clearInterval(iv); r() } }, 50) })
  run = false
  clearInterval(donor)
  const end = performance.now()
  // 예약된 딸깍(칸 경계)들 — 감속 후반 3초만 (이름이 눈에 보이게 바뀌는 구간)
  return { frames, stopAt, end }
}, DONATE)
// 프레임 간격
const dts = r.frames.slice(1).map((f, i) => f[0] - r.frames[i][0]).sort((a, b) => a - b)
const q = (x) => dts[Math.floor(dts.length * x)].toFixed(1)
// 정지 순간 회전 속도 이어짐 (프레임당 회전량이 갑자기 0 근처로 떨어지지 않는지)
const rot = r.frames.map((f) => f[1])
const iStop = r.frames.findIndex((f) => f[0] >= r.stopAt)
const perMs = (i) => (rot[i] - rot[i - 1]) / (r.frames[i][0] - r.frames[i - 1][0])
const around = [iStop - 2, iStop - 1, iStop, iStop + 1, iStop + 2].map((i) => +(perMs(i) * 1000).toFixed(1))
const backwards = rot.slice(1).filter((x, i) => x < rot[i] - 1e-9).length
// 이름이 바뀐 프레임 시각 vs 그 사이 예약된 칸 경계 시각
const last3 = r.frames.filter((f) => f[0] > r.end - 3000)
let changes = 0, maxLag = 0
for (let i = 1; i < last3.length; i++) if (last3[i][2] !== last3[i - 1][2]) changes++
console.log(JSON.stringify({ 메뉴: N, 도네: DONATE, 프레임: { 개수: r.frames.length, 중앙ms: q(0.5), p95ms: q(0.95), 최대ms: dts.at(-1).toFixed(1) }, 정지순간_초당회전rad: around, 거꾸로돈프레임: backwards, 마지막3초_이름바뀜: changes }))
await b.close()
