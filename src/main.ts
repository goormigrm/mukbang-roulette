import './styles.css'
import { store } from './state'
import type { MenuItem, Round } from './state'
import { RouletteWheel, segColor } from './roulette'
import * as sound from './sound'
import * as chzzk from './chzzk'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

// ---------- 룰렛 ----------
const wheel = new RouletteWheel(
  $<HTMLCanvasElement>('#wheel'),
  () => store.menus,
  (progress) => {
    if (store.settings.sound) sound.tick(progress)
  },
)

function doSpin(useCredit = false): void {
  if (!store.beginSpin(useCredit)) return
  wheel.startFreeSpin()
}

function doStop(): void {
  if (!wheel.isFreeSpinning) return
  const r = store.pickWinner()
  if (!r) return
  wheel.requestStop(r.index, () => store.finishSpin())
  if (store.settings.sound) sound.startDrumroll()
  renderStatus()
  renderButtons()
}

// ---------- 렌더링 ----------
const elMenuList = $('#menu-list')
const elFeedList = $('#feed-list')
const elHistoryList = $('#history-list')
const elStatusBar = $('#status-bar')
const elTotalSlots = $('#total-slots')
const elOverlay = $('#winner-overlay')
const elWinnerName = $('#winner-name')
const elBigTimer = $('#big-timer')
const btnSpin = $<HTMLButtonElement>('#btn-spin')
const btnOpenWindow = $<HTMLButtonElement>('#btn-open-window')
const btnReroll = $<HTMLButtonElement>('#btn-reroll')
const btnConfirm = $<HTMLButtonElement>('#btn-confirm')
const btnPause = $<HTMLButtonElement>('#btn-pause')

function renderPause(): void {
  btnPause.textContent = store.paused ? '⏸ 도네 반영 정지됨' : '▶ 도네 반영 중'
  btnPause.classList.toggle('paused', store.paused)
}

function renderMenus(): void {
  const busy = store.phase === 'spinning'
  // 총 칸 수는 사실상 도네 총액이 노출되는 셈이라 표시하지 않는다 (퍼센트는 노출 OK)
  elTotalSlots.textContent = store.menus.length ? `(${store.menus.length}종)` : ''
  const total = store.totalWeight()
  elMenuList.innerHTML = ''
  store.menus.forEach((m: MenuItem, i: number) => {
    const li = document.createElement('li')
    li.className = 'menu-item'

    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = segColor(i)

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = m.name
    name.title = m.name

    const donors = document.createElement('span')
    donors.className = 'donors'
    donors.textContent = m.donors.join(', ')
    donors.title = m.donors.join(', ')

    const w = document.createElement('span')
    w.className = 'w'
    w.textContent = `×${m.weight}`

    const pct = document.createElement('span')
    pct.className = 'pct'
    pct.textContent = `${((m.weight / total) * 100).toFixed(2)}%`

    const stepHint = '클릭 ±1 · Ctrl+클릭 ±10 · Alt+클릭 ±100'
    const minus = iconBtn('−', busy, (e) => store.changeWeight(m.id, -clickStep(e)))
    minus.title = `칸 빼기 (${stepHint})`
    const plus = iconBtn('+', busy, (e) => store.changeWeight(m.id, +clickStep(e)))
    plus.title = `칸 더하기 (${stepHint})`
    const del = iconBtn('✕', busy, () => store.removeMenu(m.id))
    del.classList.add('del')
    del.title = '이 메뉴 빼기'

    li.append(dot, name, donors, w, pct, minus, plus, del)
    elMenuList.appendChild(li)
  })
}

// Ctrl+클릭 = 10칸, Alt+클릭 = 100칸 단위로 조절
function clickStep(e: MouseEvent): number {
  if (e.altKey) return 100
  if (e.ctrlKey) return 10
  return 1
}

function iconBtn(label: string, disabled: boolean, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'icon-btn'
  b.type = 'button'
  b.textContent = label
  b.disabled = disabled
  b.addEventListener('click', onClick)
  return b
}

function renderFeed(): void {
  elFeedList.innerHTML = ''
  for (const f of store.feed.slice(0, 80)) {
    const li = document.createElement('li')
    li.className = `feed-${f.kind}`
    const t = document.createElement('span')
    t.className = 't'
    t.textContent = f.time
    li.appendChild(t)
    li.appendChild(document.createTextNode(f.text))
    elFeedList.appendChild(li)
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function renderHistory(): void {
  elHistoryList.innerHTML = ''
  if (store.history.length === 0) {
    const li = document.createElement('li')
    li.className = 'muted'
    li.textContent = '아직 기록이 없습니다. 결과가 확정되면 자동 저장됩니다.'
    elHistoryList.appendChild(li)
    return
  }
  store.history.forEach((r: Round) => {
    const li = document.createElement('li')
    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'round-head'
    const left = document.createElement('span')
    left.textContent = `${fmtDate(r.endedAt)} · ${r.menus.length}종`
    const right = document.createElement('span')
    right.className = 'win'
    right.textContent = `🏆 ${r.winner}${r.rerollCount > 0 ? ` (리롤 ${r.rerollCount}회)` : ''}`
    head.append(left, right)

    const menus = document.createElement('ul')
    menus.className = 'round-menus'
    menus.hidden = true
    for (const m of r.menus) {
      const mi = document.createElement('li')
      mi.textContent = `${m.name} ×${m.weight}${m.donors.length ? ` — ${m.donors.join(', ')}` : ''}`
      menus.appendChild(mi)
    }
    head.addEventListener('click', () => {
      menus.hidden = !menus.hidden
    })
    li.append(head, menus)
    elHistoryList.appendChild(li)
  })
}

function renderStatus(): void {
  const s = store.settings
  const cost = store.effectiveRerollCost().toLocaleString('ko-KR')
  let html = ''
  switch (store.phase) {
    case 'collect':
      html = store.confirmedWinner
        ? `<div class="big">오늘의 메뉴: <b>${escapeHtml(store.confirmedWinner)}</b> 🎉</div>`
        : `<div class="muted">도네이션 ${s.wonPerSlot.toLocaleString('ko-KR')}원당 1칸 · 후보가 2개 이상이면 돌릴 수 있어요</div>`
      break
    case 'spinning':
      html = wheel.isStopping
        ? `<div class="big reroll-note">두구두구두구... 🥁</div>`
        : `<div class="big">🌀 돌아가는 중 — [🛑 정지!]를 누르면 멈춥니다</div>`
      break
    case 'decision': {
      const creditNote =
        store.rerollCredits > 0
          ? ` <b class="armed-banner">🔄 리롤권 ×${store.rerollCredits} 보유 — 마지막 리롤이 최종!</b>`
          : ''
      html = store.windowOpened
        ? `<div class="big reroll-note">⏱ 접수 마감 — 늦게 도착한 ${cost}원 이상 도네도 확정 전까지 인정됩니다.${creditNote}</div>`
        : `<div class="big">🎉 당첨! [🔔 리롤 도네 받기] · [🔁 다시 돌리기] · [✅ 결과 확정] 중 선택하세요${creditNote}</div>`
      break
    }
    case 'window': {
      const remain = Math.ceil(store.windowRemainMs / 1000)
      const pct = (store.windowRemainMs / (s.rerollWindowSec * 1000)) * 100
      const creditNote =
        store.rerollCredits > 0
          ? `<div class="armed-banner">🔄 리롤권 ×${store.rerollCredits} 누적! 시간이 끝날 때까지 계속 쌓입니다</div>`
          : ''
      html = `
        <div class="big reroll-note">⏱ <span id="remain-sec">${remain}</span>초 안에 단일 도네 ${cost}원 이상이면 리롤권 적립!</div>
        <div class="timer-track"><div class="timer-fill" id="timer-fill" style="width:${pct}%"></div></div>
        ${creditNote}`
      break
    }
  }
  elStatusBar.innerHTML = html
}

function renderButtons(): void {
  if (store.phase === 'spinning') {
    btnSpin.textContent = wheel.isStopping ? '두구두구...' : '🛑 정지!'
    btnSpin.disabled = wheel.isStopping
    btnSpin.classList.add('stop-mode')
  } else {
    btnSpin.textContent = store.phase === 'collect' ? '돌리기!' : '🔁 다시 돌리기'
    btnSpin.disabled = store.menus.length < 2
    btnSpin.classList.remove('stop-mode')
  }
  btnOpenWindow.hidden = store.phase !== 'decision'
  btnOpenWindow.textContent = store.windowOpened ? '🔔 리롤 재접수 (금액 변경)' : '🔔 리롤 도네 받기'
  btnReroll.disabled = !(
    store.rerollCredits > 0 &&
    (store.phase === 'decision' || store.phase === 'window')
  )
  btnReroll.textContent = store.rerollCredits > 0 ? `🔄 리롤 ×${store.rerollCredits}` : '🔄 리롤'
  btnConfirm.hidden = !(store.phase === 'decision' || store.phase === 'window')
}

function renderOverlay(): void {
  const showLive = (store.phase === 'decision' || store.phase === 'window') && store.winner
  const showConfirmed = store.phase === 'collect' && store.confirmedWinner
  if (showLive) {
    elWinnerName.textContent = store.winner!.name
    elOverlay.hidden = false
  } else if (showConfirmed) {
    elWinnerName.textContent = store.confirmedWinner!
    elOverlay.hidden = false
  } else {
    elOverlay.hidden = true
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

// ---------- 룰렛 중앙 대형 카운트다운 (10ms 단위) ----------
let bigTimerRaf = 0

function fmtRemain(ms: number): string {
  const cs = Math.floor((ms % 1000) / 10) // 10ms 단위 (센티초)
  const s = Math.floor(ms / 1000)
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
  return `${s}.${String(cs).padStart(2, '0')}`
}

function bigTimerFrame(): void {
  if (store.phase !== 'window') {
    elBigTimer.hidden = true
    return
  }
  const remain = Math.max(0, store.windowDeadline - Date.now())
  elBigTimer.textContent = fmtRemain(remain)
  elBigTimer.classList.toggle('urgent', remain <= 10_000)
  bigTimerRaf = requestAnimationFrame(bigTimerFrame)
}

function renderBigTimer(): void {
  cancelAnimationFrame(bigTimerRaf)
  if (store.phase === 'window') {
    elBigTimer.hidden = false
    bigTimerFrame()
  } else {
    elBigTimer.hidden = true
  }
}

function renderAll(): void {
  renderPause()
  renderMenus()
  renderFeed()
  renderHistory()
  renderStatus()
  renderButtons()
  renderOverlay()
  renderBigTimer()
  if (!wheel.isSpinning) wheel.draw()
}

store.on('change', renderAll)
let lastClockUnit = -1
store.on('tick', (remainMs) => {
  const sec = document.getElementById('remain-sec')
  const fill = document.getElementById('timer-fill')
  const ms = remainMs as number
  if (sec) sec.textContent = String(Math.ceil(ms / 1000))
  if (fill) fill.style.width = `${(ms / (store.settings.rerollWindowSec * 1000)) * 100}%`

  // 째깍째깍 — 평소엔 1초 간격, 마지막 10초는 0.5초 간격으로 긴박하게
  if (!store.settings.sound || store.phase !== 'window') return
  if (ms <= 0) {
    lastClockUnit = -1
    sound.timeUp()
    return
  }
  const urgent = ms <= 10_000
  const unit = urgent ? Math.floor(ms / 500) : Math.floor(ms / 1000)
  if (unit !== lastClockUnit) {
    lastClockUnit = unit
    sound.clockTick(urgent, urgent ? 1 - ms / 10_000 : 0)
  }
})
store.on('winner', () => {
  sound.stopDrumroll()
  if (store.settings.sound) sound.fanfare()
})
store.on('armed', () => {
  if (store.settings.sound) sound.rerollChime()
})

// ---------- 컨트롤 ----------
btnSpin.addEventListener('click', () => {
  if (store.phase === 'spinning') doStop()
  else doSpin(false)
})
btnOpenWindow.addEventListener('click', () => {
  // 회차마다 리롤 금액을 올려 받는 운영(2만 → 4만 → 10만)을 위해 접수 시작 시 금액 입력
  const def = store.effectiveRerollCost()
  const input = prompt('이번 리롤 비용(원)을 입력하세요', String(def))
  if (input === null) return
  const cost = Number(input.replace(/[,\s원]/g, ''))
  if (!Number.isFinite(cost) || cost < 1000) {
    alert('1,000원 이상의 숫자를 입력해주세요.')
    return
  }
  store.startRerollWindow(cost)
})
btnReroll.addEventListener('click', () => doSpin(true))
btnConfirm.addEventListener('click', () => store.confirmResult())
btnPause.addEventListener('click', () => store.togglePaused())

$('#btn-clear').addEventListener('click', () => {
  if (store.phase === 'spinning') return
  if (confirm('후보 목록을 전부 비울까요? (기록 탭의 지난 라운드는 유지됩니다)')) {
    store.clearMenus()
    activateTab('current')
  }
})

$<HTMLFormElement>('#manual-add').addEventListener('submit', (e) => {
  e.preventDefault()
  if (store.phase === 'spinning') return
  const nameInput = $<HTMLInputElement>('#add-name')
  const weightInput = $<HTMLInputElement>('#add-weight')
  store.addMenu(nameInput.value, Math.max(1, Number(weightInput.value) || 1), '수동')
  nameInput.value = ''
  weightInput.value = '1'
  nameInput.focus()
})

// 테스트 도네이션
$<HTMLFormElement>('#test-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const nick = $<HTMLInputElement>('#test-nick').value.trim() || '테스터'
  const amount = Math.max(0, Number($<HTMLInputElement>('#test-amount').value) || 0)
  const message = $<HTMLInputElement>('#test-msg').value
  store.handleDonation({
    id: `test-${Date.now()}-${Math.random()}`,
    nick,
    amount,
    message,
    isVideo: false,
  })
})

// ---------- 탭 ----------
function activateTab(name: string): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name)
  })
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => {
    p.hidden = p.id !== `tab-${name}`
  })
}
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab ?? 'current'))
})

// ---------- 메뉴 목록 내보내기 / 불러오기 ----------
$('#btn-export-menus').addEventListener('click', () => {
  const blob = new Blob([store.exportMenusJson()], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `mukbang-roulette-메뉴.json`
  a.click()
  URL.revokeObjectURL(a.href)
})

$<HTMLInputElement>('#import-menus-file').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (store.phase === 'spinning') return
  if (store.menus.length > 0 && !confirm(`현재 후보 ${store.menus.length}종을 지우고 파일의 메뉴로 교체할까요?`)) {
    return
  }
  try {
    const n = store.importMenusJson(await file.text())
    alert(`메뉴 ${n}종을 불러왔습니다.`)
  } catch (err) {
    alert(`불러오기 실패: ${err instanceof Error ? err.message : String(err)}`)
  }
})

// ---------- 기록 내보내기 / 불러오기 ----------
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([store.exportHistoryJson()], { type: 'application/json' })
  const a = document.createElement('a')
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  a.href = URL.createObjectURL(blob)
  a.download = `mukbang-roulette-기록-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`
  a.click()
  URL.revokeObjectURL(a.href)
})

$<HTMLInputElement>('#import-file').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const n = store.importHistoryJson(await file.text())
    alert(`기록 ${n}개를 불러왔습니다.`)
  } catch (err) {
    alert(`불러오기 실패: ${err instanceof Error ? err.message : String(err)}`)
  }
})

// ---------- 설정 (설정 탭, 변경 즉시 저장) ----------
function initSettingsInputs(): void {
  $<HTMLInputElement>('#set-reroll-cost').value = String(store.settings.rerollCost)
  $<HTMLInputElement>('#set-reroll-sec').value = String(store.settings.rerollWindowSec)
  $<HTMLInputElement>('#set-min-amount').value = String(store.settings.minAmount)
  $<HTMLInputElement>('#set-won-per-slot').value = String(store.settings.wonPerSlot)
  $<HTMLInputElement>('#set-sound').checked = store.settings.sound
}

function applySettingsInputs(): void {
  store.updateSettings({
    rerollCost: Math.max(1000, Number($<HTMLInputElement>('#set-reroll-cost').value) || 20000),
    rerollWindowSec: Math.min(600, Math.max(5, Number($<HTMLInputElement>('#set-reroll-sec').value) || 60)),
    minAmount: Math.max(0, Number($<HTMLInputElement>('#set-min-amount').value) || 1000),
    wonPerSlot: Math.max(500, Number($<HTMLInputElement>('#set-won-per-slot').value) || 1000),
    sound: $<HTMLInputElement>('#set-sound').checked,
  })
}

for (const id of ['#set-reroll-cost', '#set-reroll-sec', '#set-min-amount', '#set-won-per-slot', '#set-sound']) {
  $(id).addEventListener('change', applySettingsInputs)
}
initSettingsInputs()

// ---------- 치지직 연동 ----------
const connBadge = $('#conn-badge')
chzzk.onStatus((s, detail) => {
  connBadge.classList.remove('badge-off', 'badge-on', 'badge-err')
  switch (s) {
    case 'on':
      connBadge.classList.add('badge-on')
      connBadge.textContent = '🟢 치지직 수신 중'
      break
    case 'connecting':
      connBadge.classList.add('badge-off')
      connBadge.textContent = '⏳ 연결 중...'
      break
    case 'error':
      connBadge.classList.add('badge-err')
      connBadge.textContent = '⚠ 연결 오류'
      if (detail) store.addFeed('info', `⚠ 치지직: ${detail}`)
      store.emitChange()
      break
    default:
      connBadge.classList.add('badge-off')
      connBadge.textContent = '치지직 미연결'
  }
  connBadge.title = detail ?? ''
})

$('#btn-chzzk-login').addEventListener('click', () => {
  // 이미 로그인돼 있으면 재연결, 아니면 공식 치지직 동의 페이지로 이동
  if (chzzk.hasToken()) void chzzk.connect()
  else chzzk.startLogin()
})

$('#btn-chzzk-logout').addEventListener('click', () => {
  chzzk.logout()
})

// ---------- 시작 ----------
renderAll()
void (async () => {
  const loggedInNow = await chzzk.handleOAuthRedirect()
  if (loggedInNow || (chzzk.hasToken() && store.settings.clientId)) void chzzk.connect()
})()

// 콘솔 디버깅용
;(window as unknown as Record<string, unknown>).__store = store
