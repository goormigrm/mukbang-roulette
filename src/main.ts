import './styles.css'
import { store } from './state'
import type { AppliedDonation, MenuItem, Round } from './state'
import { MIN_SPIN_MS, RouletteWheel, segColor } from './roulette'
import * as sound from './sound'
import * as chzzk from './chzzk'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

// ---------- 룰렛 ----------
const wheel = new RouletteWheel(
  $<HTMLCanvasElement>('#wheel'),
  () => store.menus,
  // 핀을 하나 지날 때마다 딸깍
  (progress) => {
    if (store.settings.sound) sound.tick(progress)
  },
)

function doSpin(useCredit = false): void {
  if (!store.beginSpin(useCredit)) return
  wheel.startFreeSpin()
  // 최소 회전 시간이 지나면 [정지!]를 켜준다 (그 사이엔 스토어 변경이 없어 자동 리렌더가 안 되므로)
  setTimeout(renderButtons, MIN_SPIN_MS + 30)
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
const elRerollBuyers = $('#reroll-buyers')
const elToastArea = $('#toast-area')
const elConnAlert = $('#conn-alert')
const elConnAlertText = $('#conn-alert-text')
const btnSpin = $<HTMLButtonElement>('#btn-spin')
const btnOpenWindow = $<HTMLButtonElement>('#btn-open-window')
const btnReroll = $<HTMLButtonElement>('#btn-reroll')
const btnConfirm = $<HTMLButtonElement>('#btn-confirm')
const btnPause = $<HTMLButtonElement>('#btn-pause')
const btnCloseEntry = $<HTMLButtonElement>('#btn-close-entry')
const elWinnerStamp = $('#winner-stamp')
const elWinnerDonors = $('#winner-donors')
const elWinnerChance = $('#winner-chance')
const elConfetti = $('#confetti')

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
  $('#history-hint').hidden = store.history.length === 0
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
    head.title = '누르면 이 판의 후보 메뉴가 펼쳐집니다'
    const caret = document.createElement('span')
    caret.className = 'caret'
    caret.textContent = '▶'
    const left = document.createElement('span')
    left.className = 'round-when'
    left.textContent = `${fmtDate(r.endedAt)} · ${r.menus.length}종`
    const right = document.createElement('span')
    right.className = 'win'
    const chance = r.chance ? ` ${r.chance.toFixed(1)}%` : ''
    right.textContent = `🏆 ${r.winner}${chance}${r.rerollCount > 0 ? ` (리롤 ${r.rerollCount}회)` : ''}`
    head.append(caret, left, right)

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
      head.classList.toggle('open', !menus.hidden)
      caret.textContent = menus.hidden ? '▶' : '▼'
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
        : `<div class="muted">도네이션 ${s.wonPerSlot.toLocaleString('ko-KR')}원당 1칸 · 후보가 들어오면 돌릴 수 있어요</div>`
      break
    case 'closing': {
      const remain = Math.ceil(store.countdownRemainMs / 1000)
      const pct = (store.countdownRemainMs / Math.max(1, store.countdownDurationMs)) * 100
      html = `
        <div class="big reroll-note">⏱ <span id="remain-sec">${remain}</span>초 뒤 마감! 지금 쏘는 메뉴까지만 룰렛에 들어갑니다</div>
        <div class="timer-track"><div class="timer-fill" id="timer-fill" style="width:${pct}%"></div></div>`
      break
    }
    case 'closed':
      html = `<div class="big reroll-note">🔒 모집 마감 — 더 이상 메뉴가 추가되지 않습니다. [돌리기!]를 누르세요</div>`
      break
    case 'spinning':
      html = wheel.isStopping
        ? `<div class="big reroll-note">두구두구두구... 🥁</div>`
        : `<div class="big">🌀 돌아가는 중 — [🛑 정지!]를 누르면 멈춥니다</div>`
      break
    case 'decision': {
      const creditNote =
        store.rerollCredits > 0
          ? `<div class="armed-banner">🔄 리롤권 ×${store.rerollCredits} 보유 — 마지막 리롤이 최종!</div>`
          : ''
      html = store.windowOpened
        ? `<div class="big reroll-note">⏱ 접수 마감 — 늦게 도착한 ${cost}원 이상 도네도 확정 전까지 인정됩니다</div>${creditNote}`
        : `<div class="big">🎉 당첨! 아래 버튼에서 선택하세요</div>${creditNote}`
      break
    }
    case 'window': {
      const remain = Math.ceil(store.countdownRemainMs / 1000)
      const pct = (store.countdownRemainMs / Math.max(1, store.countdownDurationMs)) * 100
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
    // 돌자마자 멈추면 거의 돌지 않은 채 끝나 보이므로 최소 1초는 돌게 한다
    btnSpin.disabled = wheel.isStopping || !wheel.canStop
    btnSpin.classList.add('stop-mode')
  } else {
    // 이번 판의 결과가 이미 나온 뒤(당첨 발표·리롤 접수)에만 '다시 돌리기'로 바뀐다
    const hasResult = store.phase === 'decision' || store.phase === 'window'
    btnSpin.textContent = hasResult ? '🔁 다시 돌리기' : '돌리기!'
    btnSpin.disabled = store.menus.length < 1
    btnSpin.classList.remove('stop-mode')
  }
  const closingNow = store.phase === 'closing'
  const closedNow = store.phase === 'closed'
  btnCloseEntry.hidden = !(store.phase === 'collect' || closingNow || closedNow)
  btnCloseEntry.disabled = store.menus.length < 1
  btnCloseEntry.textContent = closingNow
    ? `⏱ +${store.settings.closingSec}초 연장`
    : closedNow
      ? `⏱ ${store.settings.closingSec}초 더 받기`
      : `⏱ ${store.settings.closingSec}초 후 마감`
  btnOpenWindow.hidden = store.phase !== 'decision'
  btnOpenWindow.textContent = store.windowOpened ? '🔔 리롤 재접수 (금액 변경)' : '🔔 리롤 도네 받기'
  btnReroll.disabled = !(
    store.rerollCredits > 0 &&
    (store.phase === 'decision' || store.phase === 'window')
  )
  btnReroll.textContent = store.rerollCredits > 0 ? `🔄 리롤 ×${store.rerollCredits}` : '🔄 리롤'
  btnConfirm.hidden = !(store.phase === 'decision' || store.phase === 'window')
}

let lastBuyerSig = ''
function renderRerollBuyers(): void {
  const active = (store.phase === 'decision' || store.phase === 'window') && store.rerollCredits > 0
  if (!active) {
    elRerollBuyers.hidden = true
    lastBuyerSig = ''
    return
  }
  // 산 사람 전원을 최신순으로, 닉네임을 줄이지 않고 표시한다.
  // 같은 이름이 여러 번이면 "이름 ×2" — 익명 후원자가 여럿일 때 한 명으로 보이지 않게.
  const counts = new Map<string, number>()
  for (const u of [...store.rerollUsers].reverse()) counts.set(u, (counts.get(u) ?? 0) + 1)
  const buyers = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
  const sig = `${store.rerollCredits}|${buyers.join(',')}`
  if (sig === lastBuyerSig) return
  lastBuyerSig = sig
  elRerollBuyers.innerHTML = `
    <span class="rb-count">🔄 리롤권 ×${store.rerollCredits} 획득!</span>
    <span class="rb-names">${buyers.map(escapeHtml).join(' · ')}</span>
    <span class="rb-thanks">님 감사합니다 🙏</span>`
  elRerollBuyers.hidden = false
}

// 메뉴가 추가되는 순간 룰렛 위에 크게 띄우는 토스트
function showDonationToast(d: AppliedDonation): void {
  const el = document.createElement('div')
  el.className = 'toast'
  el.innerHTML = `🍜 ${escapeHtml(d.nick)}님 → ${escapeHtml(d.name)} <span class="toast-slots">×${d.slots}</span>`
  elToastArea.appendChild(el)
  while (elToastArea.children.length > 3) elToastArea.firstElementChild?.remove()
  setTimeout(() => {
    el.classList.add('out')
    setTimeout(() => el.remove(), 500)
  }, 3500)
}

function setChance(chance: number): void {
  if (!chance) {
    elWinnerChance.hidden = true
    return
  }
  elWinnerChance.textContent = `당첨 확률 ${chance.toFixed(2)}%`
  elWinnerChance.hidden = false
}

function setDonors(donors: string[]): void {
  // '수동'은 스트리머가 직접 넣은 것이므로 추천자로 보여주지 않는다
  const names = donors.filter((n) => n !== '수동')
  if (names.length === 0) {
    elWinnerDonors.hidden = true
    return
  }
  elWinnerDonors.textContent = `🙌 쏜 사람: ${names.join(' · ')}`
  elWinnerDonors.hidden = false
}

function renderOverlay(): void {
  const showLive = (store.phase === 'decision' || store.phase === 'window') && store.winner
  const showConfirmed = store.phase === 'collect' && store.confirmedWinner
  if (showLive) {
    elWinnerName.textContent = store.winner!.name
    setChance(store.winnerChance)
    setDonors(store.winner!.donors)
    elWinnerStamp.hidden = false
  } else if (showConfirmed) {
    elWinnerName.textContent = store.confirmedWinner!
    setChance(store.confirmedChance)
    setDonors(store.confirmedDonors)
    elWinnerStamp.hidden = false
  } else {
    // 마감 카운트다운·스핀 중에는 지난 판의 도장을 감춘다
    elWinnerStamp.hidden = true
  }
  // 도장·타이머·리롤권 카드 중 하나라도 보이면 오버레이를 띄운다
  elOverlay.hidden = elWinnerStamp.hidden && elBigTimer.hidden && elRerollBuyers.hidden
}

// 팡! 하고 터지는 폭죽 — 한 지점에서 사방으로 터져 나간 뒤 아래로 떨어진다
function firework(x: number, y: number, count = 46): void {
  const flash = document.createElement('i')
  flash.className = 'burst-flash'
  flash.style.left = `${x}px`
  flash.style.top = `${y}px`
  elConfetti.appendChild(flash)
  setTimeout(() => flash.remove(), 600)

  for (let i = 0; i < count; i++) {
    const p = document.createElement('i')
    p.className = i % 3 === 0 ? 'burst-piece strip' : 'burst-piece'
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.25
    const dist = 130 + Math.random() * 280
    p.style.left = `${x}px`
    p.style.top = `${y}px`
    p.style.background = segColor(i + Math.floor(Math.random() * 3))
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    // 아래로 더 멀리 — 터진 뒤 중력에 끌려 떨어지는 느낌
    p.style.setProperty('--dy', `${Math.sin(angle) * dist + 130 + Math.random() * 120}px`)
    p.style.setProperty('--r', `${Math.random() * 720 - 360}deg`)
    p.style.animationDuration = `${0.9 + Math.random() * 0.7}s`
    elConfetti.appendChild(p)
    setTimeout(() => p.remove(), 1900)
  }
}

/** 당첨 축포 — 룰렛 위에서 세 번 연달아 터지고, 이어서 색종이가 쏟아진다 */
function celebrate(): void {
  const r = $('#wheel').getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const shots: [number, number, number][] = [
    [0, cx, cy],
    [170, cx - r.width * 0.3, cy - r.height * 0.18],
    [340, cx + r.width * 0.28, cy - r.height * 0.12],
  ]
  for (const [delay, x, y] of shots) {
    setTimeout(() => firework(x, y), delay)
    if (store.settings.sound) sound.pop(delay / 1000)
  }
  confetti()
}

// 당첨 순간 색종이 — 화면 전체에 쏟아진다 (클립용 연출)
function confetti(count = 220): void {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i')
    p.className = i % 4 === 0 ? 'confetti-piece round' : 'confetti-piece'
    p.style.left = `${Math.random() * 100}%`
    p.style.background = segColor(i)
    p.style.animationDelay = `${Math.random() * 0.5}s`
    p.style.animationDuration = `${2.2 + Math.random() * 1.6}s`
    p.style.setProperty('--x', `${Math.random() * 400 - 200}px`)
    p.style.setProperty('--r', `${Math.random() * 1200 - 600}deg`)
    p.style.setProperty('--s', `${0.7 + Math.random() * 0.9}`)
    elConfetti.appendChild(p)
    setTimeout(() => p.remove(), 4400)
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

function countdownActive(): boolean {
  return store.phase === 'window' || store.phase === 'closing'
}

function bigTimerFrame(): void {
  if (!countdownActive()) {
    elBigTimer.hidden = true
    return
  }
  const remain = Math.max(0, store.countdownDeadline - Date.now())
  elBigTimer.textContent = fmtRemain(remain)
  elBigTimer.classList.toggle('urgent', remain <= 10_000)
  elBigTimer.classList.toggle('closing', store.phase === 'closing')
  bigTimerRaf = requestAnimationFrame(bigTimerFrame)
}

function renderBigTimer(): void {
  cancelAnimationFrame(bigTimerRaf)
  if (countdownActive()) {
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
  renderRerollBuyers()
  renderBigTimer()
  renderOverlay()
  if (!wheel.isSpinning) wheel.draw()
}

store.on('change', renderAll)
let lastClockUnit = -1
store.on('tick', (remainMs) => {
  const sec = document.getElementById('remain-sec')
  const fill = document.getElementById('timer-fill')
  const ms = remainMs as number
  if (sec) sec.textContent = String(Math.ceil(ms / 1000))
  if (fill) fill.style.width = `${(ms / Math.max(1, store.countdownDurationMs)) * 100}%`

  // 째깍째깍 — 평소엔 1초 간격, 마지막 10초는 0.5초 간격으로 긴박하게
  if (!store.settings.sound || !countdownActive()) return
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
  celebrate()
  if (store.settings.sound) sound.fanfare()
})
store.on('armed', () => {
  if (store.settings.sound) sound.rerollChime()
})
store.on('donation', (d) => showDonationToast(d as AppliedDonation))
store.on('confirmed', () => {
  if (store.settings.sound) sound.finale()
})

// ---------- 컨트롤 ----------
btnSpin.addEventListener('click', () => {
  if (store.phase === 'spinning') doStop()
  else doSpin(false)
})
btnCloseEntry.addEventListener('click', () => store.startClosing())
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
btnConfirm.addEventListener('click', () => {
  store.confirmResult()
  activateTab('history') // 확정 직후 방금 저장된 라운드를 바로 보여준다
})
btnPause.addEventListener('click', () => store.togglePaused())

// ---------- 키보드 단축키 (Space 돌리기·정지 / R 리롤 / Enter 확정) ----------
function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}
document.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
  let target: HTMLButtonElement | null = null
  if (e.code === 'Space') target = btnSpin
  else if (e.code === 'KeyR') target = btnReroll
  else if (e.code === 'Enter') target = btnConfirm
  if (!target) return
  e.preventDefault()
  // 포커스가 버튼에 남아 있으면 브라우저 기본 동작으로 한 번 더 눌리는 걸 막는다
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  if (!target.hidden && !target.disabled) target.click()
})
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !isTypingTarget(e.target)) e.preventDefault()
})

$('#btn-clear').addEventListener('click', () => {
  if (store.phase === 'spinning') return
  if (confirm('후보 목록을 전부 비울까요? (기록 탭의 지난 라운드는 유지됩니다)')) {
    store.clearMenus()
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
  $<HTMLInputElement>('#set-closing-sec').value = String(store.settings.closingSec)
  $<HTMLInputElement>('#set-min-amount').value = String(store.settings.minAmount)
  $<HTMLInputElement>('#set-won-per-slot').value = String(store.settings.wonPerSlot)
  $<HTMLInputElement>('#set-sound').checked = store.settings.sound
}

function applySettingsInputs(): void {
  const num = (sel: string, fallback: number): number => {
    const raw = $<HTMLInputElement>(sel).value.trim()
    if (raw === '') return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  }
  store.updateSettings({
    // 리롤 비용 하한 1,000원: 최소 인정 금액 단위(1,000원=1칸)와의 정합용
    rerollCost: Math.max(1000, Math.floor(num('#set-reroll-cost', 20000))),
    // 상한 없음, 0초 방지만
    rerollWindowSec: Math.max(1, Math.floor(num('#set-reroll-sec', 60))),
    closingSec: Math.max(1, Math.floor(num('#set-closing-sec', 30))),
    // 0원 설정 가능 (모든 도네 인정)
    minAmount: Math.max(0, Math.floor(num('#set-min-amount', 1000))),
    // 0 나눗셈 방지만
    wonPerSlot: Math.max(1, Math.floor(num('#set-won-per-slot', 1000))),
    sound: $<HTMLInputElement>('#set-sound').checked,
  })
}

for (const id of ['#set-reroll-cost', '#set-reroll-sec', '#set-closing-sec', '#set-min-amount', '#set-won-per-slot', '#set-sound']) {
  $(id).addEventListener('change', applySettingsInputs)
}
initSettingsInputs()

// ---------- 치지직 연동 ----------
const connBadge = $('#conn-badge')
const btnChzzkLogin = $<HTMLButtonElement>('#btn-chzzk-login')
const btnChzzkLogout = $<HTMLButtonElement>('#btn-chzzk-logout')

// 로그인 상태에 따라 로그인/로그아웃 버튼 중 하나만 보여준다
function updateAuthButtons(): void {
  const loggedIn = chzzk.hasToken()
  btnChzzkLogin.hidden = loggedIn
  btnChzzkLogout.hidden = !loggedIn
}
let alertShowing = false
let lastAlarmAt = 0

function showConnAlert(detail?: string): void {
  elConnAlertText.textContent = detail
    ? `치지직 연결 문제 — 도네이션이 반영되지 않습니다 (${detail})`
    : '치지직 연결이 끊겼습니다 — 도네이션이 반영되지 않습니다'
  elConnAlert.hidden = false
  // 경보음은 20초에 한 번까지만 (재연결 시도마다 울려 시끄러워지는 것 방지)
  const now = Date.now()
  if (store.settings.sound && now - lastAlarmAt > 20_000) {
    lastAlarmAt = now
    sound.connectionLost()
  }
  alertShowing = true
}

function hideConnAlert(playChime: boolean): void {
  elConnAlert.hidden = true
  if (alertShowing && playChime && store.settings.sound) sound.connectionRestored()
  alertShowing = false
}

chzzk.onStatus((s, detail) => {
  connBadge.classList.remove('badge-off', 'badge-on', 'badge-err')
  switch (s) {
    case 'on':
      connBadge.classList.add('badge-on')
      connBadge.textContent = '🟢 치지직 수신 중'
      hideConnAlert(true)
      break
    case 'connecting':
      connBadge.classList.add('badge-off')
      connBadge.textContent = '⏳ 연결 중...'
      break
    case 'error':
      connBadge.classList.add('badge-err')
      connBadge.textContent = '⚠ 연결 오류'
      if (detail) store.addFeed('info', `⚠ 치지직: ${detail}`)
      showConnAlert(detail)
      store.emitChange()
      break
    default:
      connBadge.classList.add('badge-off')
      connBadge.textContent = '치지직 미연결'
      hideConnAlert(false) // 수동 로그아웃 — 경보 없이 닫는다
  }
  connBadge.title = detail ?? ''
  updateAuthButtons()
})

$('#btn-conn-retry').addEventListener('click', () => {
  if (chzzk.hasToken()) void chzzk.connect()
  else chzzk.startLogin()
})

btnChzzkLogin.addEventListener('click', () => {
  // 버튼이 보이는 건 미로그인 상태뿐이지만, 혹시 토큰이 있으면 재연결로 처리
  if (chzzk.hasToken()) void chzzk.connect()
  else chzzk.startLogin()
})

btnChzzkLogout.addEventListener('click', () => {
  chzzk.logout()
  updateAuthButtons()
})

// ---------- 시작 ----------
renderAll()
updateAuthButtons()
// 웹폰트가 늦게 도착하면 룰렛 라벨이 기본 폰트로 남으므로, 로드가 끝난 뒤 한 번 더 그린다
if (document.fonts?.ready) {
  void document.fonts.ready.then(() => {
    if (!wheel.isSpinning) wheel.draw()
  })
}
void (async () => {
  const loggedInNow = await chzzk.handleOAuthRedirect()
  updateAuthButtons()
  if (loggedInNow || (chzzk.hasToken() && store.settings.clientId)) void chzzk.connect()
})()

// 콘솔 디버깅용 (개발 서버에서만)
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__store = store
}
