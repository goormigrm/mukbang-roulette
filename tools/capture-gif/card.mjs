// 리롤 카드가 단계마다 제자리에 뜨고, 큰 시계·도장·구매자 카드·룰렛 이름 현판과 겹치지 않는지 · 전체화면 스위치
import { chromium } from 'playwright'
const OUT = process.env.SHOT_DIR ?? '.'
const b = await chromium.launch()
for (const [w, h] of [[1920, 920], [1920, 1080]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.addInitScript(() => { for (const k of ['mr:menus', 'mr:round', 'mr:feed']) localStorage.removeItem(k); localStorage.setItem('mr:settings', JSON.stringify({ sound: false })) })
  await p.goto('http://localhost:5173/mukbang-roulette/', { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  await p.evaluate(() => { const s = window.__store; s.setTitle('오늘의 메인 메뉴'); for (const [n, wt] of [['차돌짬뽕', 9], ['마라탕', 7], ['탕수육', 5], ['양꼬치', 5], ['곱창전골', 4], ['짜장면', 3]]) s.addMenu(n, wt, '가') })
  const look = () => p.evaluate(() => {
    const box = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return r.width ? r : null }
    const card = box('#reroll-card')
    const hit = (o) => !!(card && o && card.left < o.right && card.right > o.left && card.top < o.bottom && card.bottom > o.top)
    const area = box('.wheel-area')
    return {
      카드: card ? { 보임: true, 오른쪽여백: Math.round(area.right - card.right), 금액: document.querySelector('.rc-price')?.textContent, 다음: document.querySelector('.rc-next b')?.textContent ?? null, 리롤권: document.querySelector('.rc-credits')?.textContent ?? null } : null,
      겹침: { 큰시계: hit(box('#big-timer')), 도장: hit(box('#winner-stamp')), 구매자카드: hit(box('#reroll-buyers')), 현판: hit(box('#round-title-display')) },
      상태바: document.getElementById('status-bar').innerText.replace(/\s+/g, ' ').trim(),
    }
  })
  const r = {}
  await p.evaluate(() => { const s = window.__store; s.beginSpin(); s.pickWinner(); s.finishSpin() })
  r.당첨발표_접수전 = await look()
  await p.evaluate(() => { const s = window.__store; s.startRerollWindow(20000, 40000); s.handleDonation({ id: 'a', nick: '큰손', amount: 20000, message: '', isVideo: false }) })
  await p.waitForTimeout(300)
  r.리롤접수중 = await look()
  await p.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish() } catch { a.pause() } }))
  await p.locator('.wheel-area').screenshot({ path: `${OUT}/card-window-${w}x${h}.png` })
  await p.evaluate(() => { const s = window.__store; s.beginSpin(true) })
  await p.waitForTimeout(200)
  r.리롤돌리는중 = await look()
  await p.evaluate(() => { const s = window.__store; s.pickWinner(); s.finishSpin() })
  await p.waitForTimeout(300)
  r.리롤결과_접수유지 = await look()
  await p.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish() } catch { a.pause() } }))
  await p.locator('.wheel-area').screenshot({ path: `${OUT}/card-decision-${w}x${h}.png` })
  await p.evaluate(() => window.__store.confirmResult())
  r.확정뒤 = (await look()).카드
  // 전체화면 스위치 (헤드리스는 진짜 전체화면이 안 될 수 있어 상태 반영만 본다)
  await p.click('#btn-full')
  await p.waitForTimeout(300)
  r.전체화면 = await p.evaluate(() => ({ 켜짐: !!document.fullscreenElement, pressed: document.getElementById('btn-full').getAttribute('aria-pressed') }))
  r.페이지에러 = errors
  console.log(`${w}x${h}`, JSON.stringify(r, null, 1))
  await p.close()
}
await b.close()
