// 화면 가운데에 뜨는 우리 디자인 입력 창.
// 브라우저 기본 prompt/alert는 방송 화면에 그대로 찍히면 볼품이 없어서, 금액 입력은 이 창으로 받는다.
// 금액 칸은 여러 개를 둘 수 있다 (예: 이번 리롤 금액 + 다음 리롤 금액).

import { koPhrases } from './text'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

const backdrop = $('#modal-backdrop')
const card = $('#modal-card')
const elTitle = $('#modal-title')
const elDesc = $('#modal-desc')
const elFields = $('#modal-fields')
const elError = $('#modal-error')
const elNote = $('#modal-note')
const elForm = $<HTMLFormElement>('#modal-form')
const btnCancel = $<HTMLButtonElement>('#modal-cancel')
const btnSkip = $<HTMLButtonElement>('#modal-skip')
const btnOk = $<HTMLButtonElement>('#modal-ok')

/** 금액 입력칸 하나 */
export interface AmountField {
  /** 입력칸 위 라벨 */
  label: string
  /** 처음 채워둘 금액 (null이면 빈 칸) */
  value: number | null
  /** 이 금액 미만은 거절 */
  min: number
  /** 한 번에 고르는 금액 버튼들 */
  presets?: number[]
  /** 비워 둘 수 있는 칸 — 비우면 결과가 null */
  optional?: boolean
  /** 칸 아래 작은 안내 */
  hint?: string
}

export interface AmountDialogOptions {
  /** 창 제목 (예: 🔔 리롤 도네 받기) */
  title: string
  /** 제목 아래 설명. 여러 개를 주면 **구(句) 단위로 끊어** 줄을 넘긴다(문장이 어중간하게 갈리지 않게) */
  desc?: string | string[]
  fields: AmountField[]
  /** 확인 버튼 글자 */
  confirmText?: string
  /** 있으면 [취소]와 [확인] 사이에 버튼이 하나 더 생기고, 누르면 'skip'으로 닫힌다 */
  skipText?: string
  /** 맨 아래 작은 안내. desc와 같이 여러 개를 주면 구 단위로 끊어 넘긴다 */
  note?: string | string[]
}

/** 창을 닫은 결과 — 확인: 칸마다 금액(비운 칸은 null) · 'skip': 보조 버튼 · null: 취소 */
export type AmountDialogResult = (number | null)[] | 'skip' | null

let resolveCurrent: ((v: AmountDialogResult) => void) | null = null
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

function close(value: AmountDialogResult): void {
  if (!resolveCurrent) return
  const done = resolveCurrent
  resolveCurrent = null
  backdrop.hidden = true
  elFields.innerHTML = ''
  lastFocused?.focus()
  lastFocused = null
  done(value)
}

/** 문구를 구(句) 단위 덩어리로 넣는다 — 덩어리 통째로 다음 줄로 넘어가므로
 *  "…합산은 / 인정되지 않습니다"처럼 한 문장이 어중간하게 갈리지 않는다 */
function setPhrases(el: HTMLElement, text: string | string[] | undefined): void {
  el.textContent = ''
  // 배열이면 준 대로, 한 문장이면 자동으로 구 단위로 끊는다
  const parts = (typeof text === 'string' ? koPhrases(text) : (text ?? [])).filter((p) => p.trim())
  el.hidden = parts.length === 0
  parts.forEach((p, i) => {
    const span = document.createElement('span')
    span.className = 'phrase'
    span.textContent = p
    el.appendChild(span)
    if (i < parts.length - 1) el.appendChild(document.createTextNode(' '))
  })
}

function showError(msg: string, focus?: HTMLInputElement): void {
  elError.textContent = msg
  elError.hidden = false
  card.classList.remove('shake')
  void card.offsetWidth // 애니메이션 재시작
  card.classList.add('shake')
  focus?.focus()
  focus?.select()
}

/** 금액 칸 하나를 그린다 — 라벨 · 입력 · 빠른 선택 버튼 · 작은 안내 */
function buildField(f: AmountField, i: number): HTMLInputElement {
  const wrap = document.createElement('div')
  wrap.className = 'modal-field'

  const label = document.createElement('label')
  label.className = 'modal-label'
  label.htmlFor = `modal-input-${i}`
  label.textContent = f.label

  const row = document.createElement('div')
  row.className = 'modal-input-row'
  const input = document.createElement('input')
  input.id = `modal-input-${i}`
  input.className = 'modal-input'
  input.type = 'text'
  input.inputMode = 'numeric'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = f.value === null ? '' : String(f.value)
  if (f.optional) input.placeholder = '비워 두기'
  const unit = document.createElement('span')
  unit.className = 'modal-unit'
  unit.textContent = '원'
  row.append(input, unit)
  wrap.append(label, row)

  // 지금 칸에 들어 있는 금액과 같은 버튼을 켜 둔다 (직접 고쳐 적어도 따라간다)
  const presets = document.createElement('div')
  presets.className = 'modal-presets'
  const mark = (): void => {
    const v = parseAmount(input.value)
    for (const b of presets.children) b.classList.toggle('on', Number((b as HTMLElement).dataset.v) === v)
  }
  for (const p of f.presets ?? []) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'modal-preset'
    b.textContent = shortWon(p)
    b.title = won(p)
    b.dataset.v = String(p)
    b.addEventListener('click', () => {
      input.value = String(p)
      elError.hidden = true
      mark()
      input.focus()
    })
    presets.appendChild(b)
  }
  if (presets.children.length > 0) wrap.appendChild(presets)
  input.addEventListener('input', () => {
    elError.hidden = true
    mark()
  })
  mark()

  if (f.hint) {
    const hint = document.createElement('p')
    hint.className = 'modal-hint'
    setPhrases(hint, f.hint)
    wrap.appendChild(hint)
  }
  elFields.appendChild(wrap)
  return input
}

/** 금액 입력 창을 띄운다.
 *  확인하면 칸마다 금액(비운 칸은 null), 보조 버튼은 'skip', 취소(Esc·바깥 클릭·[취소])는 null */
export function askAmounts(opts: AmountDialogOptions): Promise<AmountDialogResult> {
  close(null) // 혹시 열려 있으면 먼저 닫는다
  elTitle.textContent = opts.title
  setPhrases(elDesc, opts.desc)
  setPhrases(elNote, opts.note)
  btnOk.textContent = opts.confirmText ?? '확인'
  btnSkip.textContent = opts.skipText ?? ''
  btnSkip.hidden = !opts.skipText
  elError.hidden = true
  elFields.innerHTML = ''
  const inputs = opts.fields.map(buildField)

  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  backdrop.hidden = false
  // 바로 다른 금액을 타이핑할 수 있게 첫 칸을 전체 선택해둔다
  requestAnimationFrame(() => {
    inputs[0]?.focus()
    inputs[0]?.select()
  })

  return new Promise<AmountDialogResult>((resolve) => {
    resolveCurrent = resolve
    elForm.onsubmit = (e: SubmitEvent) => {
      e.preventDefault()
      const values: (number | null)[] = []
      for (const [i, f] of opts.fields.entries()) {
        const raw = inputs[i].value.trim()
        if (!raw && f.optional) {
          values.push(null)
          continue
        }
        const n = parseAmount(raw)
        if (n === null) return showError(`${f.label} — 숫자로 적어주세요 (예: 40000 또는 4만)`, inputs[i])
        if (n < f.min) return showError(`${f.label} — ${won(f.min)} 이상이어야 합니다`, inputs[i])
        values.push(n)
      }
      close(values)
    }
  })
}

// ---- 닫기 경로: [취소] · 보조 버튼 · 바깥 클릭 · Esc ----
btnCancel.addEventListener('click', () => close(null))
btnSkip.addEventListener('click', () => close('skip'))
backdrop.addEventListener('mousedown', (e) => {
  if (e.target === backdrop) close(null)
})
document.addEventListener('keydown', (e) => {
  if (!isOpen()) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close(null)
  }
})
