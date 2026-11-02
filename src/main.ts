import './styles.css'
import { REROLL_PRESETS, cheese, store, suggestNextRerollCost } from './state'
import type { AppliedDonation, FeedEntry, MenuItem, Round } from './state'
import { MIN_SPIN_MS, RouletteWheel, segColor, wheelGeometry } from './roulette'
import * as sound from './sound'
import * as chzzk from './chzzk'
import * as modal from './modal'
import { koPhrases } from './text'
import { watchForUpdates } from './update'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

// ---------- 룰렛 ----------
const wheel = new RouletteWheel($<HTMLCanvasElement>('#wheel'), () => store.menus)

function doSpin(useCredit = false): void {
  if (!store.beginSpin(useCredit)) return
  wheel.startFreeSpin()
  // 딸깍 소리는 화면 프레임이 아니라 오디오 시계로 돈다 (메뉴가 많아도 끊기지 않게)
  if (store.settings.sound) sound.startTicking((from, to) => wheel.tickEvents(from, to))
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
const elMenuSearch = $<HTMLInputElement>('#menu-search')
const elUndoBar = $('#undo-bar')
const elUndoText = $('#undo-text')
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
const btnBack = $<HTMLButtonElement>('#btn-back')
const elControls = $('.controls')
const btnPause = $<HTMLButtonElement>('#btn-pause')
const btnSound = $<HTMLButtonElement>('#btn-sound')
const btnFull = $<HTMLButtonElement>('#btn-full')
const elRerollCard = $('#reroll-card')
const btnCloseEntry = $<HTMLButtonElement>('#btn-close-entry')
const elWinnerStamp = $('#winner-stamp')
const elWinnerDonors = $('#winner-donors')
const elWinnerChance = $('#winner-chance')
const elConfetti = $('#confetti')
const elRoundTitle = $<HTMLInputElement>('#round-title')
const elRoundTitleDisplay = $('#round-title-display')

function renderRoundTitle(): void {
  // 적는 중에는 입력칸을 건드리지 않고(커서가 튀지 않게), 현판은 적고 있는 이름을 그대로 따라간다
  // — 도네가 들어와 화면이 다시 그려져도 현판이 저장된 옛 이름으로 되돌아가지 않게.
  const typing = document.activeElement === elRoundTitle
  if (!typing && elRoundTitle.value !== store.title) elRoundTitle.value = store.title
  // 룰렛 화면에는 이름이 있을 때만 현판을 띄운다
  const shown = typing ? elRoundTitle.value.trim() : store.title
  elRoundTitleDisplay.textContent = shown
  elRoundTitleDisplay.hidden = shown === ''
}

// ---------- 룰렛 이름 현판 자리 잡기 ----------
// 룰렛 상자 모서리에 고정해 두면, 이름이 길수록 원판·포인터 위 메뉴명·당첨 도장을 가린다.
// 그래서 현판은 프레임 오른쪽 위 빈 곳에 붙이고, 이름 길이에 맞춰 글자 크기와 줄 폭을 골라
// 그 상자가 아무것도 덮지 않는 가장 큰 크기로 앉힌다.
const elWheelArea = $('.wheel-area')
const elWheelCanvas = $<HTMLCanvasElement>('#wheel')
const TITLE_FONT_SIZES = [22, 20, 18, 16, 15, 14, 13]
const TITLE_GAP = 10 // 원판·메뉴명·도장과 띄울 최소 거리(px)
const TITLE_MAX_LINES = 3 // 이보다 길게 세로로 쌓이면 읽기 어렵다 — 차라리 글자를 줄인다
const TITLE_INSET_RIGHT = 16 // CSS right 값과 같게 (위쪽 14px은 CSS에만)

interface Box {
  l: number
  t: number
  r: number
  b: number
}

/** 당첨 도장이 떠 있으면 그 자리 — -8° 기울어져 있고 등장할 때 확대 애니메이션이 있으므로,
 *  지금 보이는 크기가 아니라 다 내려앉은 자리의 바깥 상자로 계산한다 */
/** 리롤 접수 카드가 떠 있으면 그 자리 */
function rerollCardBox(): Box | null {
  if (elRerollCard.hidden) return null
  const b = elRerollCard.getBoundingClientRect()
  return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null
}

function stampBox(): Box | null {
  if (elOverlay.hidden || elWinnerStamp.hidden) return null
  const w = elWinnerStamp.offsetWidth
  const h = elWinnerStamp.offsetHeight
  if (!w || !h) return null
  const ov = elOverlay.getBoundingClientRect()
  const x = ov.left + elWinnerStamp.offsetLeft + w / 2
  const y = ov.top + elWinnerStamp.offsetTop + h / 2
  const a = (8 * Math.PI) / 180
  const hw = (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a)
  const hh = (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a)
  return { l: x - hw, r: x + hw, t: y - hh, b: y + hh }
}

let lastTitleSig = ''

function placeRoundTitle(): void {
  const el = elRoundTitleDisplay
  if (el.hidden) {
    lastTitleSig = ''
    return
  }
  const area = elWheelArea.getBoundingClientRect()
  const cv = elWheelCanvas.getBoundingClientRect()
  if (!cv.width) return
  const stamp = stampBox()
  const card = rerollCardBox()
  // 이름·화면 크기·도장·리롤 카드 자리가 그대로면 다시 계산하지 않는다 (도네가 들어올 때마다 불리므로)
  const sig = [el.textContent, area.width, area.top, cv.width, cv.left, stamp && Object.values(stamp).map(Math.round), card && Object.values(card).map(Math.round)].join('|')
  if (sig === lastTitleSig) return
  lastTitleSig = sig

  // roulette.ts draw()와 같은 계산 — 원판 중심·반지름, 포인터 위 메뉴명 자리
  const size = cv.width
  const g = wheelGeometry(size)
  const cx = cv.left + g.cx
  const cy = cv.top + g.cy
  const R = g.R
  // 메뉴명은 돌아가는 동안 계속 바뀌므로 가운데 절반 폭을 통째로 비워 둔다
  const label: Box = { l: cx - size * 0.25, r: cx + size * 0.25, t: cv.top + g.labelBase - g.labelFont, b: cv.top + g.rimTop + 4 }

  const overlaps = (a: Box, o: Box): boolean =>
    a.l < o.r + TITLE_GAP && a.r > o.l - TITLE_GAP && a.t < o.b + TITLE_GAP && a.b > o.t - TITLE_GAP
  const hitsWheel = (a: Box): boolean => {
    const nx = Math.min(Math.max(cx, a.l), a.r)
    const ny = Math.min(Math.max(cy, a.t), a.b)
    return Math.hypot(cx - nx, cy - ny) < R + TITLE_GAP
  }

  // 오른쪽 위 모서리에서 메뉴명 자리 직전까지가 쓸 수 있는 폭
  const maxW = Math.max(60, area.right - TITLE_INSET_RIGHT - (label.r + TITLE_GAP))
  const apply = (font: number, width: number): Box => {
    el.style.fontSize = `${font}px`
    el.style.padding = `${Math.round(font * 0.32)}px ${Math.round(font * 0.64)}px`
    el.style.maxWidth = `${Math.floor(width)}px`
    const b = el.getBoundingClientRect()
    return { l: b.left, t: b.top, r: b.right, b: b.bottom }
  }
  /** 지금 현판이 몇 줄로 접혔는가 (line-height 1.25 기준) */
  const lineCount = (font: number): number => {
    const cs = getComputedStyle(el)
    const inner = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    return Math.round(inner / (font * 1.25))
  }

  // 도장까지 피해 보고, 그래도 안 맞으면 원판·메뉴명만 피한다
  const base = card ? [label, card] : [label] // 리롤 카드는 늘 피한다
  const rounds = stamp ? [[...base, stamp], base] : [base]
  for (const obstacles of rounds) {
    // 3줄 안에 들어가는 자리가 없을 때를 대비해, 아무것도 덮지 않는 자리 중 줄이 가장 적은 것을 기억해 둔다
    let fewest: { font: number; width: number; lines: number } | null = null
    for (const font of TITLE_FONT_SIZES) {
      // 한 줄로 넓게 → 좁혀서 여러 줄로 (좁히면 왼쪽 아래 모서리가 원판에서 멀어진다)
      for (const width of [maxW, maxW * 0.72, maxW * 0.5]) {
        const box = apply(font, width)
        const clear = box.l >= area.left + TITLE_INSET_RIGHT && !hitsWheel(box) && !obstacles.some((o) => overlaps(box, o))
        if (!clear) continue
        const lines = lineCount(font)
        if (lines <= TITLE_MAX_LINES) return // 가장 큰 글씨로 3줄 안에 들어감
        if (!fewest || lines < fewest.lines) fewest = { font, width, lines }
      }
    }
    if (fewest) {
      apply(fewest.font, fewest.width) // 아주 긴 이름 — 덮지 않는 선에서 줄이 가장 적게
      return
    }
  }
  // 어디에도 깨끗이 안 들어감 — 가장 작은 글씨로 넓게 (원판 쪽으로 내려가지 않게)
  apply(TITLE_FONT_SIZES[TITLE_FONT_SIZES.length - 1], maxW)
}

/** 오른쪽 위 효과음 스위치 — 켜진 쪽(🔊/🔇)에 불이 들어온다 */
function renderSound(): void {
  btnSound.setAttribute('aria-pressed', String(store.settings.sound))
  btnSound.title = `효과음 ${store.settings.sound ? '켜짐' : '꺼짐'} — 눌러서 ${store.settings.sound ? '끄기' : '켜기'} (단축키 M)`
}

/** 도네 반영 스위치 — 켜짐 ▶(초록) / 멈춤 ⏸(빨강, 깜빡임) */
function renderPause(): void {
  btnPause.setAttribute('aria-pressed', String(!store.paused))
  btnPause.title = store.paused
    ? '도네 반영 멈춤 — 지금 오는 도네는 메뉴에도 리롤권에도 안 들어갑니다. 눌러서 다시 받기'
    : '도네 반영 중 — 눌러서 잠깐 멈추기'
}

function renderMenus(): void {
  const busy = store.phase === 'spinning'
  // 총 칸 수는 사실상 도네 총액이 노출되는 셈이라 표시하지 않는다 (퍼센트는 노출 OK)
  elTotalSlots.textContent = store.menus.length ? `(${store.menus.length}종)` : ''
  // 이름을 고치는 중에는 목록을 다시 그리지 않는다 (도네가 들어올 때마다 입력칸이 사라지지 않게)
  if (editingId !== null) return
  const q = searchKey(elMenuSearch.value)
  const flashLeft = FLASH_MS - (Date.now() - flash.at)
  // 보이는 내용이 그대로면 다시 깔지 않는다 — 도는 중에도 도네(무시됨)가 올 때마다 300줄을 새로 깔아
  // 한 번에 30~120ms씩 걸려 룰렛이 끊겼다
  const sig = [busy, q, flashLeft > 0 ? `${flash.name}@${flash.at}` : '']
    .concat(store.menus.map((m) => `${m.id}:${m.name}:${m.weight}:${m.donors.length}`))
    .join('|')
  if (sig === menusSig) return
  menusSig = sig
  const total = store.totalWeight()
  elMenuList.innerHTML = ''
  let shown = 0
  // 새로 들어온 메뉴가 위에 오도록 거꾸로 깐다. 색 점은 원판 칸 순서(i) 그대로
  ;[...store.menus.entries()].reverse().forEach(([i, m]: [number, MenuItem]) => {
    // 검색칸에 뭔가 적혀 있으면 이름·추천자에 그 글자가 든 메뉴만 (띄어쓰기·대소문자 무시)
    if (q && !searchKey(m.name).includes(q) && !m.donors.some((dn) => searchKey(dn).includes(q))) return
    shown++
    const li = document.createElement('li')
    li.className = 'menu-item'
    // 방금 도네로 칸이 늘어난 메뉴는 잠깐 반짝인다 — 그 사이 목록이 다시 그려져도 이어서
    if (m.name === flash.name && flashLeft > 0) {
      li.classList.add('flash')
      li.style.animationDelay = `${flashLeft - FLASH_MS}ms`
    }

    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = segColor(i)

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = m.name
    name.title = busy ? m.name : `${m.name} — 두 번 누르면 이름 고치기`
    if (!busy) name.addEventListener('dblclick', () => startRename(li, name, m))

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
    const edit = iconBtn('🖊️', busy, () => startRename(li, name, m))
    edit.classList.add('edit')
    edit.title = '이름 고치기 — 이미 있는 메뉴 이름으로 고치면 칸과 추천자가 합쳐집니다'

    // 볼펜은 확률과 [−] 사이 — 이름 길이와 상관없이 늘 같은 자리
    li.append(dot, name, donors, w, pct, edit, minus, plus, del)
    elMenuList.appendChild(li)
  })
  if (q && shown === 0) {
    const li = document.createElement('li')
    li.className = 'menu-empty'
    li.textContent = '찾는 메뉴가 없습니다'
    elMenuList.appendChild(li)
  }
}

/** 검색용 글자 — 띄어쓰기를 지우고 소문자로 */
function searchKey(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/** 방금 도네로 칸이 늘어난 메뉴 (목록에서 FLASH_MS 동안 반짝임 — styles.css의 menu-flash 길이와 같게) */
const FLASH_MS = 1600
let flash = { name: '', at: 0 }

/** [↶ 되돌리기] 줄 — 받아주는 시간이 지나면 저절로 사라진다 */
let undoTimer = 0
function renderUndo(): void {
  clearTimeout(undoTimer)
  const u = store.undoable
  const left = u ? u.until - Date.now() : 0
  elUndoBar.hidden = !u || left <= 0 || store.phase === 'spinning'
  if (!u || elUndoBar.hidden) return
  elUndoText.textContent = `방금 ${u.label}`
  undoTimer = window.setTimeout(renderUndo, left + 20)
}

/** 지금 이름을 고치고 있는 메뉴 id (없으면 null) */
let editingId: number | null = null
/** 후보 목록을 마지막으로 그린 내용 — 같으면 다시 그리지 않는다 */
let menusSig = ''

/** 이름 칸을 입력칸으로 바꾼다. Enter·다른 곳 클릭 = 저장, Esc = 취소 */
function startRename(li: HTMLElement, nameEl: HTMLElement, m: MenuItem): void {
  editingId = m.id
  const input = document.createElement('input')
  input.className = 'name-edit'
  input.value = m.name
  input.autocomplete = 'off'
  li.replaceChild(input, nameEl)
  input.focus()
  input.select()
  let done = false
  const finish = (save: boolean): void => {
    if (done) return
    done = true
    editingId = null
    menusSig = '' // 입력칸을 끼워 넣었던 줄이라 내용이 같아도 새로 깐다
    if (save) store.renameMenu(m.id, input.value) // 바뀌면 store가 다시 그린다
    renderMenus() // 안 바뀌었거나 취소해도 원래 모양으로
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
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

/** 피드 맨 위에 그려 둔 줄 — 새 줄은 그 위에만 끼워 넣는다 (예전엔 도네마다 80줄을 새로 깔았다) */
let feedTop: FeedEntry | null = null
const FEED_ROWS = 80

function renderFeed(): void {
  const k = feedTop ? store.feed.indexOf(feedTop) : -1
  if (k === 0) return // 새 줄 없음
  const fresh = k > 0 && k < FEED_ROWS ? store.feed.slice(0, k) : store.feed.slice(0, FEED_ROWS)
  if (!(k > 0 && k < FEED_ROWS)) elFeedList.innerHTML = '' // 처음이거나 한꺼번에 많이 바뀌면 통째로
  const frag = document.createDocumentFragment()
  for (const f of fresh) frag.appendChild(feedRow(f))
  elFeedList.prepend(frag)
  while (elFeedList.children.length > FEED_ROWS) elFeedList.lastElementChild?.remove()
  feedTop = store.feed[0] ?? null
}

function feedRow(f: FeedEntry): HTMLLIElement {
  const li = document.createElement('li')
  li.className = `feed-${f.kind}`
  const t = document.createElement('span')
  t.className = 't'
  t.textContent = f.time
  li.appendChild(t)
  // 구 단위로 끊어 넣는다 — "반영되지 / 않습니다"처럼 말이 갈리지 않게
  koPhrases(f.text).forEach((p, i) => {
    if (i > 0) li.appendChild(document.createTextNode(' '))
    const span = document.createElement('span')
    span.className = 'phrase'
    span.textContent = p
    li.appendChild(span)
  })
  return li
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 기록은 이 브라우저(localStorage)에만 있다 — 마지막으로 JSON을 내려받은 때를 보여 백업을 챙기게 한다 */
const LS_BACKUP = 'mr:last-backup'
function renderBackupNote(): void {
  let at = 0
  try {
    at = Number(localStorage.getItem(LS_BACKUP)) || 0
  } catch {
    /* 저장소를 못 읽으면 "안 함"으로 */
  }
  const day = (t: number): number => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((day(Date.now()) - day(at)) / 86_400_000)
  const when = !at ? '아직 한 번도 안 했습니다' : days <= 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전`
  $('#backup-note').textContent = `💾 마지막 백업: ${when} — 기록은 이 브라우저에만 저장됩니다`
}

/** 기록 목록을 마지막으로 그린 내용 — 같으면 다시 그리지 않는다(펼쳐 둔 줄도 그대로 남는다) */
let historySig = ''

function renderHistory(): void {
  renderBackupNote()
  const sig = `${store.history.length}|${store.history[0]?.id ?? ''}|${store.history[0]?.endedAt ?? ''}`
  if (sig === historySig) return
  historySig = sig
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
    // 윗줄 당첨 메뉴, 아랫줄 날짜·룰렛 이름 — 둘 다 길면 줄을 바꿔 다 보인다 (한 줄에 몰면 잘리고 날짜가 세로로 접혔다)
    const meta = document.createElement('span')
    meta.className = 'round-meta'
    meta.append(left)
    head.append(caret, right, meta)

    // 룰렛 이름 — 그 판에 이름을 안 적었으면 아무것도 붙이지 않고 공란으로 둔다
    const title = (r.title ?? '').trim()
    if (title) {
      const tag = document.createElement('span')
      tag.className = 'round-title-tag'
      tag.textContent = `🏷 ${title}`
      tag.title = `룰렛 이름: ${title}`
      meta.append(tag)
    }

    const menus = document.createElement('ul')
    menus.className = 'round-menus'
    menus.hidden = true
    for (const m of [...r.menus].reverse()) { // 진행 중 목록과 같이 나중에 들어온 메뉴가 위
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
  const cost = cheese(store.effectiveRerollCost())
  let html = ''
  switch (store.phase) {
    case 'collect':
      html = store.confirmedWinner
        ? `<div class="big"><span class="phrase">오늘의 메뉴:</span> <span class="phrase"><b>${escapeHtml(store.confirmedWinner)}</b> 🎉</span></div>`
        : `<div class="muted">${ko(`도네이션 ${cheese(s.wonPerSlot)}당 1칸 · 후보가 들어오면 돌릴 수 있어요`)}</div>
           <div class="muted small-text">${ko('💬 이미 있는 메뉴 뒤에 쉼표(,)나 마침표(.)를 찍고 하고 싶은 말을 적으면 그 메뉴에 합쳐져요 (예: 부대찌개, 맛있겠다) · 처음 나오는 메뉴는 적은 그대로 들어가요')}</div>`
      break
    case 'closing': {
      const remain = Math.ceil(store.countdownRemainMs / 1000)
      const pct = (store.countdownRemainMs / Math.max(1, store.countdownDurationMs)) * 100
      html = `
        <div class="big reroll-note"><span class="phrase">⏱ <span id="remain-sec">${remain}</span>초 뒤 마감!</span> ${ko('지금 쏘는 메뉴까지만 룰렛에 들어갑니다')}</div>
        <div class="timer-track"><div class="timer-fill" id="timer-fill" style="width:${pct}%"></div></div>`
      break
    }
    case 'closed':
      // 마감 표시는 그대로 두고, 방송 딜레이만큼 늦게 도착한 도네는 조용히 더 받는다
      // (리롤 접수가 마감 뒤에도 지각 도네를 인정하는 것과 같은 방식)
      html = `<div class="big reroll-note">${ko('🔒 모집 마감 — 더 이상 메뉴가 추가되지 않습니다. [돌리기!]를 누르세요')}</div>${
        store.inGrace()
          ? `<div class="muted small-text">${ko('⏰ 방송 딜레이만큼 잠깐은 늦게 도착한 도네도 반영됩니다')}</div>`
          : `<div class="muted small-text">${ko('늦게 온 도네를 넣어주고 싶으면 후보 목록에서 직접 추가하세요')}</div>`
      }`
      break
    case 'spinning': {
      // 리롤 접수가 열려 있으면 돌아가는 동안에도 "다음 리롤" 도네를 받는다는 걸 알려 준다
      const openNote = store.windowOpened
        ? `<div class="muted small-text">${ko(`🔔 돌아가는 동안에도 ${cost} 이상 리롤 도네를 받습니다`)}</div>`
        : ''
      html = wheel.isStopping
        ? `<div class="big reroll-note">두구두구두구... 🥁</div>${openNote}`
        : `<div class="big">${ko('🌀 돌아가는 중 — [🛑 정지!]를 누르면 멈춥니다')}</div>${openNote}`
      break
    }
    case 'decision': {
      const creditNote =
        store.rerollCredits > 0
          ? `<div class="armed-banner">${ko(`🔄 리롤권 ×${store.rerollCredits} 보유 — 마지막 리롤이 최종!`)}</div>`
          : ''
      html = store.windowOpened
        ? `<div class="big reroll-note">${ko(`🔔 리롤 접수 중 — 단일 도네 ${cost} 이상이면 리롤권 (확정 전까지)`)}</div>`
        : `<div class="big">${ko('🎉 당첨! 아래 버튼에서 선택하세요')}</div>${creditNote}`
      break
    }
    case 'window': {
      const remain = Math.ceil(store.countdownRemainMs / 1000)
      const pct = (store.countdownRemainMs / Math.max(1, store.countdownDurationMs)) * 100
      // 리롤권 수·다음 회차 금액은 룰렛 오른쪽 리롤 카드에 (renderRerollCard)
      html = `
        <div class="big reroll-note"><span class="phrase">⏱ <span id="remain-sec">${remain}</span>초 안에</span> ${ko(`단일 도네 ${cost} 이상이면 리롤권 적립!`)}</div>
        <div class="timer-track"><div class="timer-fill" id="timer-fill" style="width:${pct}%"></div></div>`
      break
    }
  }
  elStatusBar.innerHTML = html
}

/** 리롤 접수 현황 카드 — 룰렛 오른쪽에 따로 띄운다. 시청자가 "지금 얼마를 쏴야 하는지"를 헷갈리지 않게
    지금 금액을 가장 크게, 다음 회차 금액은 작게 아래로 (예전엔 다음 금액 글씨가 더 커서 그 금액을 쏴야 하는 줄 알았다) */
let rerollCardSig = ''
function renderRerollCard(): void {
  // 첫 돌리기 전에 금액을 정해 뒀으면 돌리기 전부터 미리 보인다 (리롤을 한 번이라도 쓴 뒤엔 아니다 — [다음 없이]로 끝낸 경우)
  const preset = !store.windowOpened && store.rerollCount === 0 && store.currentRerollCost !== null
  const show = preset || (store.windowOpened && ['window', 'decision', 'spinning'].includes(store.phase))
  elRerollCard.hidden = !show
  if (!show) return
  const sig = `${preset}|${store.effectiveRerollCost()}|${store.rerollCredits}|${store.nextRerollCost}`
  if (sig === rerollCardSig) return
  rerollCardSig = sig
  const credits = store.rerollCredits > 0 ? `<div class="rc-credits">🔄 리롤권 ×${store.rerollCredits}</div>` : ''
  const next =
    store.nextRerollCost !== null
      ? `<div class="rc-next">다음 회차 <b>${cheese(store.nextRerollCost)}</b><span>지금 리롤권을 다 쓰면</span></div>`
      : ''
  elRerollCard.innerHTML =
    `<div class="rc-head">${preset ? '🔄 이번 판 리롤' : '🔔 리롤 접수 중'}</div>` +
    `<div class="rc-label">${preset ? '리롤 금액' : '지금 리롤'}</div>` +
    `<div class="rc-price">${store.effectiveRerollCost().toLocaleString('ko-KR')}<small>치즈</small></div>` +
    `<div class="rc-sub">${preset ? '돌리기 시작하면 접수' : '단일 도네 이 금액 이상'}</div>` +
    credits +
    next
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
  const beforeSpin = store.phase === 'collect' || closingNow || closedNow
  btnCloseEntry.hidden = !beforeSpin
  btnCloseEntry.disabled = store.menus.length < 1
  btnCloseEntry.textContent = closingNow
    ? `⏱ +${store.settings.closingSec}초 연장`
    : closedNow
      ? `⏱ ${store.settings.closingSec}초 더 받기`
      : `⏱ ${store.settings.closingSec}초 후 마감`
  // 첫 돌리기 전에는 리롤 금액만 미리 정해 둔다 — 리롤 버튼은 결과가 나와야 쓸 수 있으니 그 자리에
  btnOpenWindow.hidden = !(store.phase === 'decision' || beforeSpin)
  btnOpenWindow.textContent = beforeSpin
    ? '🔔 리롤 금액'
    : store.windowOpened
      ? '🔔 리롤 재접수 (금액 변경)'
      : '🔔 리롤 도네 받기'
  btnReroll.hidden = beforeSpin
  btnReroll.disabled = !(
    store.rerollCredits > 0 &&
    (store.phase === 'decision' || store.phase === 'window')
  )
  // 다음 금액을 안 정한 마지막 리롤권이면 누를 때 묻는다는 걸 미리 알린다.
  // 정해 둔 다음 금액은 버튼에 쓰지 않는다 — 상태바에 크게 나온다
  const askOnClick = store.rerollCredits === 1 && store.windowOpened && store.nextRerollCost === null
  btnReroll.textContent =
    store.rerollCredits < 1 ? '🔄 리롤' : askOnClick ? '🔄 리롤 ×1 (마지막)' : `🔄 리롤 ×${store.rerollCredits}`
  btnConfirm.hidden = !(store.phase === 'decision' || store.phase === 'window')
  btnBack.hidden = btnConfirm.hidden
  // 결과가 나온 뒤에는 버튼을 역할별로 나눠 놓는다 (윗줄 리롤 · 아랫줄 예외 · 오른쪽 따로 결과 확정 — styles.css)
  elControls.dataset.stage = btnConfirm.hidden ? 'play' : 'result'
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
  // 닉네임과 메뉴가 각각 덩어리 — 줄이 넘어가도 "→ 메뉴 ×3"이 갈리지 않는다
  el.innerHTML = `<span class="phrase">🍜 ${escapeHtml(d.nick)}님</span> <span class="phrase">→ ${escapeHtml(d.name)} <span class="toast-slots">×${d.slots}</span></span>`
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

/** 안내 문구를 구 단위 덩어리로 감싼다 — 한 문장이 줄 끝에서 어중간하게 갈리지 않게 */
function ko(text: string): string {
  return koPhrases(text)
    .map((p) => `<span class="phrase">${escapeHtml(p)}</span>`)
    .join(' ')
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
  // 버저비터(마감 직후 딜레이 보정)는 일부러 큰 시계를 띄우지 않는다 —
  // 리롤 접수와 같은 방식으로, 화면상 시간은 끝났지만 반영만 조용히 더 받는다.
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
  renderRoundTitle()
  renderSound()
  renderPause()
  renderMenus()
  renderUndo()
  renderFeed()
  renderHistory()
  renderStatus()
  renderButtons()
  renderRerollBuyers()
  renderRerollCard()
  renderBigTimer()
  renderOverlay()
  placeRoundTitle() // 도장이 뜨고 지는 것까지 본 뒤에 현판 자리를 잡는다
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
  sound.stopTicking()
  sound.stopDrumroll()
  celebrate()
  if (store.settings.sound) sound.fanfare()
})
store.on('armed', () => {
  if (store.settings.sound) sound.rerollChime()
})
store.on('donation', (d) => {
  const a = d as AppliedDonation
  flash = { name: a.name, at: Date.now() } // 바로 뒤 change에서 목록이 그 줄을 반짝인다
  showDonationToast(a)
})
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
  // 회차마다 리롤 금액을 올려 받는 운영(2만 → 4만 → 10만)을 위해 접수 시작 시 금액 입력.
  // 이번 금액과 함께 **다음 금액**도 미리 정해 두면, 마지막 리롤권을 쓰는 순간 그 금액으로 바로 이어서 받는다.
  // 방송 화면에 그대로 찍히므로 브라우저 기본 prompt 대신 가운데 뜨는 우리 창으로 받는다.
  // 첫 돌리기 전에 누르면 금액을 미리 정해 두고(룰렛 옆에 공개), 돌리기 시작하는 순간 그 금액으로 접수가 열린다
  const def = store.effectiveRerollCost()
  const beforeSpin = ['collect', 'closing', 'closed'].includes(store.phase)
  void modal
    .askAmounts({
      title: beforeSpin ? '🔔 이번 판 리롤 금액' : '🔔 리롤 도네 받기',
      // 구 단위로 끊어 넘긴다 — 한 문장이 줄 끝에서 어중간하게 갈리지 않게
      desc: beforeSpin
        ? ['돌리기 전에 미리 정해 두면', '룰렛 옆에 금액이 보이고,', '돌리기 시작하는 순간부터', '버튼 없이 리롤권을 받습니다.']
        : [`지금부터 ${store.settings.rerollWindowSec}초 동안,`, '이 금액 이상을 한 번에 쏜 사람마다', '리롤권이 1개씩 쌓입니다.'],
      fields: [
        { label: '이번 리롤 금액', value: def, min: 1000, presets: REROLL_PRESETS },
        {
          label: '다음 리롤 금액',
          value: store.nextRerollCost ?? suggestNextRerollCost(def),
          min: 1000,
          presets: REROLL_PRESETS,
          optional: true,
          // 리롤해 보고 정하고 싶을 수도 있다 — [나중 선택]이면 마지막 리롤권을 누를 때 묻는다
          laterText: '나중 선택',
          hint: '마지막 리롤권을 쓰는 순간 이 금액으로 바로 이어서 받습니다. [나중 선택]은 그때 묻습니다.',
        },
      ],
      confirmText: beforeSpin ? '정하기' : '접수 시작',
      note: ['여러 명이 사면 그만큼 쌓이고,', '마지막 리롤이 최종입니다.', '합산은 인정되지 않습니다.'],
    })
    .then((r) => {
      if (r === null || r === 'skip') return
      if (beforeSpin) store.presetRerollCosts(r[0] ?? def, r[1])
      else store.startRerollWindow(r[0] ?? def, r[1])
    })
})

/** [🔄 리롤] — 마지막 리롤권인데 다음 금액을 아직 안 정했으면 돌리기 전에 정한다.
 *  정해 두면 돌아가는 동안·결과가 나온 뒤에 미리 쏜 "다음 리롤" 도네도 바로 인정된다 */
async function doReroll(): Promise<void> {
  if (store.rerollCredits < 1) return
  if (store.rerollCredits === 1 && store.windowOpened && store.nextRerollCost === null) {
    const cur = store.effectiveRerollCost()
    const r = await modal.askAmounts({
      title: '🔄 마지막 리롤권',
      desc: ['이 리롤을 돌리면 남은 리롤권이 없습니다.', '다음 리롤 금액을 정해 두면', '돌아가는 동안에도 바로 받습니다.'],
      fields: [{ label: '다음 리롤 금액', value: suggestNextRerollCost(cur), min: 1000, presets: REROLL_PRESETS }],
      confirmText: '정하고 돌리기',
      skipText: '다음 없이 돌리기',
      note: [`지금 리롤 금액은 ${cheese(cur)}입니다.`, '[다음 없이 돌리기]는 이번 리롤이 마지막입니다.'],
    })
    if (r === null) return // 취소 — 돌리지 않는다
    if (r === 'skip') store.endRerollSales()
    else store.setNextRerollCost(r[0])
  }
  doSpin(true)
}
btnReroll.addEventListener('click', () => void doReroll())
btnConfirm.addEventListener('click', () => {
  store.confirmResult()
  activateTab('history') // 확정 직후 방금 저장된 라운드를 바로 보여준다
})
btnBack.addEventListener('click', async () => {
  // 시청자가 돈 내고 산 리롤권이 남아 있으면 사라지므로 한 번 묻는다 (없으면 바로 돌아간다)
  if (store.rerollCredits > 0) {
    const ok = await modal.askAmounts({
      title: '↩ 메뉴 추가로 돌아가기',
      desc: ['이번 결과는 기록하지 않습니다.', `남은 리롤권 ${store.rerollCredits}개는 사라집니다.`],
      fields: [],
      confirmText: '돌아가기',
    })
    if (ok === null) return
  }
  store.backToCollect()
  activateTab('current') // 들어오는 메뉴를 바로 볼 수 있게
})
btnPause.addEventListener('click', () => store.togglePaused())
// 전체화면 — 방송 중 크롬 탭·주소창·북마크·작업표시줄을 숨긴다. 끄기는 이 스위치나 Esc
function renderFull(): void {
  const on = Boolean(document.fullscreenElement)
  btnFull.setAttribute('aria-pressed', String(on))
  btnFull.title = on ? '전체화면 — 눌러서 끄기 (Esc도 됨)' : '전체화면 켜기 — 방송 중 크롬 탭·주소창·북마크를 숨긴다'
}
btnFull.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen().catch(() => undefined)
})
document.addEventListener('fullscreenchange', () => {
  renderFull()
  maybeReload() // 전체화면을 끄면 미뤄 둔 새 버전 적용
})
renderFull()

btnSound.addEventListener('click', () => {
  const on = !store.settings.sound
  store.updateSettings({ sound: on })
  // 도는 중에 끄면 이미 울리고 있는 딸깍·드럼롤도 바로 멈춘다 (다시 켜면 딸깍은 이어서)
  if (!on) {
    sound.stopTicking()
    sound.stopDrumroll()
  } else if (wheel.isSpinning) {
    sound.startTicking((from, to) => wheel.tickEvents(from, to))
  }
})
$('#btn-undo').addEventListener('click', () => store.undo())
elMenuSearch.addEventListener('input', () => renderMenus())
// 타이핑 중에는 룰렛 현판만 미리 보여주고, 저장은 입력을 마칠 때(blur) 한 번만 한다
elRoundTitle.addEventListener('input', () => {
  renderRoundTitle()
  placeRoundTitle()
})
elRoundTitle.addEventListener('blur', () => store.setTitle(elRoundTitle.value))
elRoundTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') elRoundTitle.blur()
})

// ---------- 키보드 단축키 (Space 돌리기·정지 / R 리롤 / Enter 확정) ----------
function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}
document.addEventListener('keydown', (e) => {
  // 입력 창이 떠 있는 동안에는 뒤쪽 버튼이 눌리지 않게 한다 (Enter는 창의 [확인]이 받는다)
  if (modal.isOpen()) return
  if (isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
  let target: HTMLButtonElement | null = null
  if (e.code === 'Space') target = btnSpin
  else if (e.code === 'KeyR') target = btnReroll
  else if (e.code === 'Enter') target = btnConfirm
  else if (e.code === 'KeyM') target = btnSound
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
  // 확정 뒤 [진행 중]으로 돌아오면 다음 판이니 확정 도장을 내리고 첫 화면처럼
  if (name === 'current') store.dismissConfirmed()
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
  try {
    localStorage.setItem(LS_BACKUP, String(Date.now()))
  } catch {
    /* 저장소가 막혀 있으면 표시만 못 바꾼다 */
  }
  renderBackupNote()
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
  $<HTMLInputElement>('#set-grace-sec').value = String(store.settings.graceSec)
  $<HTMLInputElement>('#set-min-amount').value = String(store.settings.minAmount)
  $<HTMLInputElement>('#set-won-per-slot').value = String(store.settings.wonPerSlot)
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
    // 0이면 버저비터 없이 칼같이 마감
    graceSec: Math.max(0, Math.floor(num('#set-grace-sec', 5))),
    // 0원 설정 가능 (모든 도네 인정)
    minAmount: Math.max(0, Math.floor(num('#set-min-amount', 1000))),
    // 0 나눗셈 방지만
    wonPerSlot: Math.max(1, Math.floor(num('#set-won-per-slot', 1000))),
  })
}

for (const id of ['#set-reroll-cost', '#set-reroll-sec', '#set-closing-sec', '#set-grace-sec', '#set-min-amount', '#set-won-per-slot']) {
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

// ---------- 새 버전 자동 반영 ----------
// 새 버전이 올라오면 이미 열어둔 화면도 따라가게 한다.
// 다만 판이 돌아가는 중에 새로고침하면 흐름이 끊기므로, 모집 중일 때만 실제로 새로고침한다.
const elUpdateBanner = $('#update-banner')
const elUpdateWhen = $('#update-when')
let updateReady = false

function reloadForUpdate(): void {
  // 진행 중 상태는 localStorage에 저장돼 있어 새로고침해도 이어진다
  location.reload()
}

function maybeReload(): void {
  if (!updateReady) return
  // 새로고침하면 전체화면이 풀리고(브라우저는 클릭으로만 다시 켜 준다) 방송에 크롬 창이 드러난다
  if (document.fullscreenElement) {
    elUpdateWhen.textContent = '— 전체화면을 끄면 적용합니다'
    return
  }
  if (store.phase === 'collect') {
    elUpdateWhen.textContent = '— 잠시 후 자동으로 적용합니다'
    setTimeout(reloadForUpdate, 3000)
  } else {
    elUpdateWhen.textContent = '— 이번 판이 끝나면 자동으로 적용합니다'
  }
}

watchForUpdates(() => {
  updateReady = true
  elUpdateBanner.hidden = false
  store.addFeed('info', '🔄 새 버전이 배포되어 곧 자동으로 적용됩니다')
  store.emitChange()
  maybeReload()
})
$('#btn-update-now').addEventListener('click', reloadForUpdate)
store.on('change', maybeReload) // 판이 끝나 모집 중으로 돌아오면 그때 적용

// ---------- 시작 ----------
renderAll()
updateAuthButtons()
// 웹폰트가 늦게 도착하면 룰렛 라벨이 기본 폰트로 남으므로, 로드가 끝난 뒤 한 번 더 그린다
if (document.fonts?.ready) {
  void document.fonts.ready.then(() => {
    if (!wheel.isSpinning) wheel.draw()
    lastTitleSig = '' // 글꼴이 바뀌면 현판 크기도 달라지므로 다시 자리를 잡는다
    placeRoundTitle()
  })
}
// 창 크기가 바뀌면 룰렛 크기도 바뀌므로 현판 자리를 다시 잡는다
window.addEventListener('resize', () => requestAnimationFrame(placeRoundTitle))
void (async () => {
  const loggedInNow = await chzzk.handleOAuthRedirect()
  updateAuthButtons()
  if (loggedInNow || (chzzk.hasToken() && store.settings.clientId)) void chzzk.connect()
})()

// 콘솔 디버깅용 (개발 서버에서만)
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__store = store
  ;(window as unknown as Record<string, unknown>).__wheel = wheel // 회전·딸깍 동기 측정용
}
