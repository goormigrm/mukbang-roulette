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
  () => {
    if (store.settings.sound) sound.tick()
  },
)

function doSpin(): void {
  const r = store.beginSpin()
  if (!r) return
  wheel.spin(r.index, () => store.finishSpin())
}

// ---------- 렌더링 ----------
const elMenuList = $('#menu-list')
const elFeedList = $('#feed-list')
const elHistoryList = $('#history-list')
const elStatusBar = $('#status-bar')
const elTotalSlots = $('#total-slots')
const elOverlay = $('#winner-overlay')
const elWinnerName = $('#winner-name')
const btnSpin = $<HTMLButtonElement>('#btn-spin')
const btnReroll = $<HTMLButtonElement>('#btn-reroll')
const btnConfirm = $<HTMLButtonElement>('#btn-confirm')
const btnPause = $<HTMLButtonElement>('#btn-pause')

function renderPause(): void {
  btnPause.textContent = store.paused ? '⏸ 도네 반영 정지됨' : '▶ 도네 반영 중'
  btnPause.classList.toggle('paused', store.paused)
}

function renderMenus(): void {
  const busy = store.phase === 'spinning'
  elTotalSlots.textContent = store.menus.length
    ? `(${store.menus.length}종 · 총 ${store.totalWeight()}칸)`
    : ''
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

    const stepHint = '클릭 ±1 · Ctrl+클릭 ±10 · Alt+클릭 ±100'
    const minus = iconBtn('−', busy, (e) => store.changeWeight(m.id, -clickStep(e)))
    minus.title = `칸 빼기 (${stepHint})`
    const plus = iconBtn('+', busy, (e) => store.changeWeight(m.id, +clickStep(e)))
    plus.title = `칸 더하기 (${stepHint})`
    const del = iconBtn('✕', busy, () => store.removeMenu(m.id))
    del.classList.add('del')
    del.title = '이 메뉴 빼기'

    li.append(dot, name, donors, w, minus, plus, del)
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
  const cost = s.rerollCost.toLocaleString('ko-KR')
  let html = ''
  switch (store.phase) {
    case 'collect':
      html = store.confirmedWinner
        ? `<div class="big">오늘의 메뉴: <b>${escapeHtml(store.confirmedWinner)}</b> 🎉</div>`
        : `<div class="muted">도네이션 ${s.wonPerSlot.toLocaleString('ko-KR')}원당 1칸 · 후보가 2개 이상이면 돌릴 수 있어요</div>`
      break
    case 'spinning':
      html = `<div class="big">🌀 돌아가는 중...</div>`
      break
    case 'window': {
      const remain = Math.ceil(store.windowRemainMs / 1000)
      const pct = (store.windowRemainMs / (s.rerollWindowSec * 1000)) * 100
      html = `
        <div class="big reroll-note">⏱ <span id="remain-sec">${remain}</span>초 안에 단일 도네 ${cost}원 이상이면 리롤!</div>
        <div class="timer-track"><div class="timer-fill" id="timer-fill" style="width:${pct}%"></div></div>`
      break
    }
    case 'armed': {
      const users = store.rerollUsers.slice(-3).map(escapeHtml).join(', ')
      const more = store.rerollUsers.length > 3 ? ' 외' : ''
      html = `<div class="big armed-banner">🔄 리롤권 ×${store.rerollCredits} 보유! (${users}${more}님 후원) — [리롤] 버튼을 누르세요. 마지막 리롤 결과가 최종입니다</div>`
      break
    }
  }
  elStatusBar.innerHTML = html
}

function renderButtons(): void {
  btnSpin.disabled = !(store.phase === 'collect' && store.menus.length >= 2)
  btnReroll.disabled = store.phase !== 'armed'
  btnReroll.textContent = store.rerollCredits > 0 ? `🔄 리롤 ×${store.rerollCredits}` : '🔄 리롤'
  btnConfirm.hidden = !(store.phase === 'window' || store.phase === 'armed')
}

function renderOverlay(): void {
  const showLive = (store.phase === 'window' || store.phase === 'armed') && store.winner
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

function renderAll(): void {
  renderPause()
  renderMenus()
  renderFeed()
  renderHistory()
  renderStatus()
  renderButtons()
  renderOverlay()
  if (!wheel.isSpinning) wheel.draw()
}

store.on('change', renderAll)
store.on('tick', (remainMs) => {
  const sec = document.getElementById('remain-sec')
  const fill = document.getElementById('timer-fill')
  const ms = remainMs as number
  if (sec) sec.textContent = String(Math.ceil(ms / 1000))
  if (fill) fill.style.width = `${(ms / (store.settings.rerollWindowSec * 1000)) * 100}%`
})
store.on('winner', () => {
  if (store.settings.sound) sound.fanfare()
})
store.on('armed', () => {
  if (store.settings.sound) sound.rerollChime()
})

// ---------- 컨트롤 ----------
btnSpin.addEventListener('click', doSpin)
btnReroll.addEventListener('click', doSpin)
btnConfirm.addEventListener('click', () => store.confirmResult())
btnPause.addEventListener('click', () => store.togglePaused())

$('#btn-clear').addEventListener('click', () => {
  if (store.phase === 'spinning') return
  if (confirm('후보 목록을 전부 비울까요? (기록 탭의 지난 라운드는 유지됩니다)')) {
    store.clearMenus()
    modal.close('cancel')
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
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn))
    $('#tab-current').hidden = btn.dataset.tab !== 'current'
    $('#tab-history').hidden = btn.dataset.tab !== 'history'
  })
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

// ---------- 설정 모달 ----------
const modal = $<HTMLDialogElement>('#settings-modal')
$('#btn-settings').addEventListener('click', () => {
  $<HTMLInputElement>('#set-reroll-cost').value = String(store.settings.rerollCost)
  $<HTMLInputElement>('#set-reroll-sec').value = String(store.settings.rerollWindowSec)
  $<HTMLInputElement>('#set-min-amount').value = String(store.settings.minAmount)
  $<HTMLInputElement>('#set-won-per-slot').value = String(store.settings.wonPerSlot)
  $<HTMLInputElement>('#set-sound').checked = store.settings.sound
  $<HTMLInputElement>('#set-client-id').value = store.settings.clientId
  $<HTMLInputElement>('#set-client-secret').value = store.settings.clientSecret
  $<HTMLInputElement>('#set-proxy-url').value = store.settings.proxyUrl
  modal.showModal()
})

function saveSettingsInputs(): void {
  store.updateSettings({
    rerollCost: Math.max(1000, Number($<HTMLInputElement>('#set-reroll-cost').value) || 20000),
    rerollWindowSec: Math.min(600, Math.max(5, Number($<HTMLInputElement>('#set-reroll-sec').value) || 60)),
    minAmount: Math.max(0, Number($<HTMLInputElement>('#set-min-amount').value) || 1000),
    wonPerSlot: Math.max(500, Number($<HTMLInputElement>('#set-won-per-slot').value) || 1000),
    sound: $<HTMLInputElement>('#set-sound').checked,
    clientId: $<HTMLInputElement>('#set-client-id').value.trim(),
    clientSecret: $<HTMLInputElement>('#set-client-secret').value.trim(),
    proxyUrl: $<HTMLInputElement>('#set-proxy-url').value.trim(),
  })
}

modal.addEventListener('close', () => {
  if (modal.returnValue === 'save') saveSettingsInputs()
})

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

$('#redirect-uri-hint').textContent = chzzk.redirectUri()

$('#btn-chzzk-login').addEventListener('click', () => {
  saveSettingsInputs() // 로그인 페이지로 이동하기 전에 입력값 보존
  chzzk.startLogin()
})

$('#btn-chzzk-connect').addEventListener('click', () => {
  saveSettingsInputs()
  if (!chzzk.hasToken()) {
    alert('먼저 [1) 치지직 로그인]을 진행해주세요.')
    return
  }
  modal.close('cancel')
  void chzzk.connect()
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
