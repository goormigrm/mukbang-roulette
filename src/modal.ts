// 화면 가운데에 뜨는 우리 디자인 입력 창.
// 브라우저 기본 prompt/alert는 방송 화면에 그대로 찍히면 볼품이 없어서, 금액 입력은 이 창으로 받는다.

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

const backdrop = $('#modal-backdrop')
const card = $('#modal-card')
const elTitle = $('#modal-title')
const elDesc = $('#modal-desc')
const elLabel = $('#modal-label')
const elInput = $<HTMLInputElement>('#modal-input')
const elPresets = $('#modal-presets')
const elError = $('#modal-error')
const elNote = $('#modal-note')
const elForm = $<HTMLFormElement>('#modal-form')
const btnCancel = $<HTMLButtonElement>('#modal-cancel')
const btnOk = $<HTMLButtonElement>('#modal-ok')

export interface AmountDialogOptions {
  /** 창 제목 (예: 🔔 리롤 도네 받기) */
  title: string
  /** 제목 아래 설명 한 줄 */
  desc?: string
  /** 입력칸 위 라벨 */
  label: string
  /** 처음 채워둘 금액 */
  value: number
  /** 이 금액 미만은 거절 */
  min: number
  /** 한 번에 고르는 금액 버튼들 */
  presets?: number[]
  /** 확인 버튼 글자 */
  confirmText?: string
  /** 맨 아래 작은 안내 */
  note?: string
}

let resolveCurrent: ((v: number | null) => void) | null = null
let lastFocused: HTMLElement | null = null

/** 창이 열려 있는가 — 단축키(Space/R/Enter)가 뒤에서 눌리지 않게 main.ts가 확인한다 */
export function isOpen(): boolean {
  return !backdrop.hidden
}

const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`

/** 버튼에 쓰는 짧은 표기 — 20000 → "2만" (딱 떨어지지 않으면 원 단위 그대로) */
function shortWon(n: number): string {
  return n >= 10000 && n % 10000 === 0 ? `${n / 10000}만` : won(n)
}

/** 쉼표·"원"·공백은 물론 "2만", "20000" 모두 받아준다 */
function parseAmount(raw: string): number | null {
  const t = raw.replace(/[,\s원]/g, '').trim()
  if (!t) return null
  const man = /^(\d+(?:\.\d+)?)만$/.exec(t)
  if (man) return Math.round(Number(man[1]) * 10000)
  if (!/^\d+$/.test(t)) return null
  return Number(t)
}

function close(value: number | null): void {
  if (!resolveCurrent) return
  const done = resolveCurrent
  resolveCurrent = null
  backdrop.hidden = true
  elPresets.innerHTML = ''
  lastFocused?.focus()
  lastFocused = null
  done(value)
}

function showError(msg: string): void {
  elError.textContent = msg
  elError.hidden = false
  card.classList.remove('shake')
  void card.offsetWidth // 애니메이션 재시작
  card.classList.add('shake')
}

/** 금액 입력 창을 띄운다. 확인하면 금액, 취소(Esc·바깥 클릭·[취소])하면 null */
export function askAmount(opts: AmountDialogOptions): Promise<number | null> {
  close(null) // 혹시 열려 있으면 먼저 닫는다
  elTitle.textContent = opts.title
  elDesc.textContent = opts.desc ?? ''
  elDesc.hidden = !opts.desc
  elLabel.textContent = opts.label
  elNote.textContent = opts.note ?? ''
  elNote.hidden = !opts.note
  btnOk.textContent = opts.confirmText ?? '확인'
  elError.hidden = true
  elInput.value = String(opts.value)

  elPresets.innerHTML = ''
  for (const p of opts.presets ?? []) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = p === opts.value ? 'modal-preset on' : 'modal-preset'
    b.textContent = shortWon(p)
    b.title = won(p)
    b.addEventListener('click', () => {
      elInput.value = String(p)
      elError.hidden = true
      // 지금 고른 금액이 어느 것인지 버튼에도 드러낸다
      for (const other of elPresets.children) other.classList.toggle('on', other === b)
      elInput.focus()
    })
    elPresets.appendChild(b)
  }
  elPresets.hidden = elPresets.children.length === 0

  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  backdrop.hidden = false
  // 바로 다른 금액을 타이핑할 수 있게 전체 선택해둔다
  requestAnimationFrame(() => {
    elInput.focus()
    elInput.select()
  })

  return new Promise<number | null>((resolve) => {
    resolveCurrent = resolve
    elForm.onsubmit = (e: SubmitEvent) => {
      e.preventDefault()
      const n = parseAmount(elInput.value)
      if (n === null) {
        showError('숫자로 금액을 적어주세요 (예: 40000 또는 4만)')
        return
      }
      if (n < opts.min) {
        showError(`${won(opts.min)} 이상이어야 합니다`)
        return
      }
      close(n)
    }
  })
}

// ---- 닫기 경로: [취소] · 바깥 클릭 · Esc ----
btnCancel.addEventListener('click', () => close(null))
backdrop.addEventListener('mousedown', (e) => {
  if (e.target === backdrop) close(null)
})
elInput.addEventListener('input', () => {
  elError.hidden = true
  // 직접 고쳐 적으면 버튼 표시도 입력값에 맞춘다
  for (const b of elPresets.children) {
    b.classList.toggle('on', (b as HTMLElement).title.replace(/[,원]/g, '') === elInput.value.trim())
  }
})
document.addEventListener('keydown', (e) => {
  if (!isOpen()) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close(null)
  }
})
