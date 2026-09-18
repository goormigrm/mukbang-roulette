// 상태 저장소 + 규칙 엔진 (도네이션 → 메뉴 추가, 리롤 상태 머신, 라운드 기록)

import { PRESET_CLIENT_ID, PRESET_PROXY_URL } from './config'

export interface MenuItem {
  id: number
  name: string
  weight: number // 칸 수
  donors: string[]
}

export interface Round {
  id: number
  endedAt: string // ISO
  winner: string
  /** 당첨 당시 그 메뉴의 확률(%) — 확률대로 뽑혔음을 나중에도 확인할 수 있게 남긴다 */
  chance?: number
  rerollCount: number
  menus: { name: string; weight: number; donors: string[] }[]
}

// collect(모집) → closing(마감 카운트다운, 도네는 계속 반영) → closed(모집 마감, 도네 반영 중단)
//   → spinning(회전, 스트리머가 [돌리기]를 눌러야 시작) → decision(당첨 발표, 스트리머 선택 대기)
//   → window(리롤 도네 접수, 타이머는 끝까지 흐르고 그동안 리롤권이 계속 쌓임) → 확정 시 collect로
export type Phase = 'collect' | 'closing' | 'closed' | 'spinning' | 'decision' | 'window'

export interface Settings {
  rerollCost: number
  rerollWindowSec: number
  /** [마감] 버튼 한 번에 주는 모집 마감 카운트다운 초 (다시 누르면 그만큼 연장) */
  closingSec: number
  minAmount: number
  wonPerSlot: number
  sound: boolean
  clientId: string
  clientSecret: string
  proxyUrl: string
}

export interface FeedEntry {
  time: string
  kind: 'add' | 'skip' | 'reroll' | 'info' | 'win'
  text: string
}

/** 메뉴로 반영된 도네 — 화면 토스트용 */
export interface AppliedDonation {
  nick: string
  amount: number
  name: string
  slots: number
}

export interface DonationInput {
  id: string // 디듀프용
  nick: string
  amount: number
  message: string
  isVideo: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  rerollCost: 20000,
  rerollWindowSec: 60,
  closingSec: 30,
  minAmount: 1000,
  wonPerSlot: 1000,
  sound: true,
  clientId: '',
  clientSecret: '',
  proxyUrl: '',
}

const LS_SETTINGS = 'mr:settings'
const LS_MENUS = 'mr:menus'
const LS_HISTORY = 'mr:history'
const LS_PAUSED = 'mr:paused'
const LS_FEED = 'mr:feed'
const LS_ROUND = 'mr:round'
export const MAX_HISTORY = 20

/** 새로고침해도 이어지도록 저장하는 진행 중 라운드 상태 */
interface RoundState {
  phase: Phase
  winner: MenuItem | null
  confirmedWinner: string | null
  rerollCredits: number
  rerollUsers: string[]
  rerollCount: number
  currentRerollCost: number | null
  windowOpened: boolean
  confirmedDonors?: string[]
  confirmedChance?: number
  winnerChance?: number
  countdownDeadline: number
  countdownDurationMs: number
}

type EventName = 'change' | 'tick' | 'winner' | 'armed' | 'donation' | 'confirmed'

export class Store {
  settings: Settings = { ...DEFAULT_SETTINGS }
  menus: MenuItem[] = []
  feed: FeedEntry[] = []
  history: Round[] = []
  phase: Phase = 'collect'
  paused = false // 도네이션 반영 일시정지
  winner: MenuItem | null = null
  confirmedWinner: string | null = null
  /** 확정된 당첨 메뉴를 추천한 사람들 (화면 표시용) */
  confirmedDonors: string[] = []
  /** 당첨 당시 그 메뉴의 확률(%) — 추첨이 칸 수 비율대로 이뤄졌음을 화면에서 보여준다 */
  winnerChance = 0
  confirmedChance = 0
  /** 사용 가능한 리롤권 수 (단일 도네 ≥ 리롤비용 1건당 1개 누적) */
  rerollCredits = 0
  rerollUsers: string[] = []
  rerollCount = 0
  countdownRemainMs = 0
  /** 이번 회차 리롤 비용 (접수 시작 시 입력, null이면 설정 기본값). 확정 시 초기화 */
  currentRerollCost: number | null = null
  /** 이번 당첨 결과에 대해 접수를 연 적이 있는지 — 마감 후 늦게 도착한 도네 인정용 */
  windowOpened = false

  private pendingWinner: MenuItem | null = null
  private seen = new Set<string>()
  private nextMenuId = 1
  private nextRoundId = 1
  private countdownTimer: ReturnType<typeof setInterval> | null = null
  /** 카운트다운 마감 시각 (epoch ms) — UI가 10ms 단위로 그릴 때 직접 읽는다 */
  countdownDeadline = 0
  /** 이번 카운트다운의 전체 길이(ms) — 도중에 설정을 바꿔도 진행바 비율이 틀어지지 않게 고정 */
  countdownDurationMs = 0
  private listeners = new Map<EventName, Set<(arg?: unknown) => void>>()

  constructor() {
    this.load()
  }

  // ---- 이벤트 ----
  on(ev: EventName, fn: (arg?: unknown) => void): void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set())
    this.listeners.get(ev)!.add(fn)
  }
  private emit(ev: EventName, arg?: unknown): void {
    this.listeners.get(ev)?.forEach((fn) => fn(arg))
  }
  /** 외부 모듈이 피드만 추가한 뒤 리렌더를 요청할 때 사용 */
  emitChange(): void {
    this.emit('change')
  }

  // ---- 영속화 ----
  private load(): void {
    // 항목별로 따로 감싸서, 하나가 손상돼도 나머지는 정상 복원되게 한다
    const read = <T>(key: string, ok: (v: unknown) => v is T): T | null => {
      try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const v: unknown = JSON.parse(raw)
        return ok(v) ? v : null
      } catch {
        return null
      }
    }
    const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

    const s = read<Record<string, unknown>>(LS_SETTINGS, isObj)
    if (s) this.settings = { ...DEFAULT_SETTINGS, ...(s as Partial<Settings>) }
    // 개발자가 미리 심어둔 값이 있으면, 사용자가 직접 입력하지 않은 빈 칸을 채운다
    if (!this.settings.clientId) this.settings.clientId = PRESET_CLIENT_ID
    if (!this.settings.proxyUrl) this.settings.proxyUrl = PRESET_PROXY_URL

    const isArr = (v: unknown): v is unknown[] => Array.isArray(v)

    const m = read<unknown[]>(LS_MENUS, isArr)
    if (m) {
      this.menus = m.filter(
        (x): x is MenuItem => isObj(x) && typeof x.name === 'string' && typeof x.weight === 'number',
      )
      this.nextMenuId = Math.max(0, ...this.menus.map((x) => x.id)) + 1
    }
    const h = read<unknown[]>(LS_HISTORY, isArr)
    if (h) {
      this.history = h.filter(
        (r): r is Round => isObj(r) && typeof r.winner === 'string' && Array.isArray(r.menus),
      )
      this.nextRoundId = Math.max(0, ...this.history.map((x) => x.id)) + 1
    }
    const f = read<unknown[]>(LS_FEED, isArr)
    if (f) this.feed = f.filter((e): e is FeedEntry => isObj(e) && typeof e.text === 'string').slice(0, 200)
    this.paused = localStorage.getItem(LS_PAUSED) === '1'

    const r = read<Record<string, unknown>>(LS_ROUND, isObj)
    if (r) this.restoreRound(r as unknown as RoundState)
  }

  /** 새로고침 전에 진행 중이던 라운드(당첨·리롤권·접수 상태)를 이어받는다 */
  private restoreRound(r: RoundState): void {
    this.confirmedDonors = Array.isArray(r.confirmedDonors) ? r.confirmedDonors.map(String) : []
    this.confirmedChance = Number(r.confirmedChance) || 0
    this.winnerChance = Number(r.winnerChance) || 0
    // 모집 중이었다면 직전 확정 결과만 이어받는다 (마감 카운트다운은 잇지 않고 모집 상태로)
    if (r.phase !== 'decision' && r.phase !== 'window') {
      this.confirmedWinner = r.confirmedWinner ?? null
      return
    }
    if (!r.winner) return
    this.winner = r.winner
    this.confirmedWinner = r.confirmedWinner ?? null
    this.rerollCredits = Math.max(0, Number(r.rerollCredits) || 0)
    this.rerollUsers = Array.isArray(r.rerollUsers) ? r.rerollUsers.map(String) : []
    this.rerollCount = Math.max(0, Number(r.rerollCount) || 0)
    this.currentRerollCost = typeof r.currentRerollCost === 'number' ? r.currentRerollCost : null
    this.windowOpened = Boolean(r.windowOpened)
    const deadline = Number(r.countdownDeadline) || 0
    const remain = deadline - Date.now()
    if (r.phase === 'window' && remain > 0) {
      this.phase = 'window'
      this.windowOpened = true
      this.startCountdown(deadline, Number(r.countdownDurationMs) || remain)
      this.addFeed('info', '↻ 새로고침 — 리롤 접수를 이어서 진행합니다')
    } else {
      this.phase = 'decision'
      if (r.phase === 'window') this.windowOpened = true // 접수 중에 새로고침했는데 이미 마감된 경우
      this.addFeed('info', '↻ 새로고침 — 당첨 결과와 리롤권을 이어받았습니다')
    }
  }

  private roundState(): RoundState {
    return {
      phase: this.phase,
      winner: this.winner,
      confirmedWinner: this.confirmedWinner,
      rerollCredits: this.rerollCredits,
      rerollUsers: this.rerollUsers,
      rerollCount: this.rerollCount,
      currentRerollCost: this.currentRerollCost,
      windowOpened: this.windowOpened,
      confirmedDonors: this.confirmedDonors,
      confirmedChance: this.confirmedChance,
      winnerChance: this.winnerChance,
      countdownDeadline: this.countdownDeadline,
      countdownDurationMs: this.countdownDurationMs,
    }
  }

  private save(): void {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(this.settings))
      localStorage.setItem(LS_MENUS, JSON.stringify(this.menus))
      localStorage.setItem(LS_HISTORY, JSON.stringify(this.history))
      localStorage.setItem(LS_FEED, JSON.stringify(this.feed))
      localStorage.setItem(LS_PAUSED, this.paused ? '1' : '0')
      localStorage.setItem(LS_ROUND, JSON.stringify(this.roundState()))
    } catch {
      // 저장 실패(용량 등)해도 앱 동작은 유지
    }
  }
  private changed(): void {
    this.save()
    this.emit('change')
  }

  // ---- 피드 ----
  addFeed(kind: FeedEntry['kind'], text: string): void {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    this.feed.unshift({ time: `${hh}:${mm}:${ss}`, kind, text })
    if (this.feed.length > 200) this.feed.length = 200
  }

  // ---- 설정 ----
  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch }
    this.changed()
  }

  togglePaused(): void {
    this.paused = !this.paused
    this.addFeed('info', this.paused ? '⏸ 도네이션 반영 일시정지' : '▶ 도네이션 반영 재개')
    this.changed()
  }

  // ---- 메뉴 조작 ----
  totalWeight(): number {
    return this.menus.reduce((a, m) => a + m.weight, 0)
  }

  addMenu(name: string, weight: number, donor?: string): void {
    // 40자 컷은 룰렛 라벨·목록 표시가 깨지지 않게 하는 최소한의 안전장치
    name = name.trim().slice(0, 40)
    if (!name || weight < 1) return
    const existing = this.menus.find((m) => m.name === name)
    if (existing) {
      existing.weight += weight
      if (donor && !existing.donors.includes(donor)) existing.donors.push(donor)
    } else {
      this.menus.push({ id: this.nextMenuId++, name, weight, donors: donor ? [donor] : [] })
    }
    this.changed()
  }

  removeMenu(id: number): void {
    this.menus = this.menus.filter((m) => m.id !== id)
    this.changed()
  }

  changeWeight(id: number, delta: number): void {
    const m = this.menus.find((x) => x.id === id)
    if (!m) return
    m.weight += delta
    if (m.weight <= 0) this.menus = this.menus.filter((x) => x.id !== id)
    this.changed()
  }

  /** 룰렛 전체 비우기 — 후보뿐 아니라 진행 중 라운드(당첨·리롤권·접수 타이머)도 모집 상태로 되돌린다 */
  clearMenus(): void {
    this.stopCountdown()
    this.menus = []
    this.phase = 'collect'
    this.winner = null
    this.pendingWinner = null
    this.confirmedWinner = null
    this.rerollCount = 0
    this.rerollCredits = 0
    this.rerollUsers = []
    this.currentRerollCost = null
    this.windowOpened = false
    this.addFeed('info', '🧹 룰렛 초기화 — 후보와 진행 중 라운드를 모두 비웠습니다')
    this.changed()
  }

  // ---- 도네이션 규칙 엔진 ----
  handleDonation(d: DonationInput): void {
    if (this.seen.has(d.id)) return
    this.seen.add(d.id)
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string)
    this.routeDonation(d)
    this.changed()
  }

  private routeDonation(d: DonationInput): void {
    const won = d.amount.toLocaleString('ko-KR')

    if (d.isVideo) {
      this.addFeed('skip', `🎬 [${d.nick}] ${won}원 영상 도네 — 규칙상 제외`)
      return
    }

    // 일시정지 중에는 메뉴 추가뿐 아니라 리롤권 적립도 하지 않는다
    if (this.paused) {
      this.addFeed('skip', `⏸ [${d.nick}] ${won}원 "${d.message}" — 일시정지 중, 반영 안 됨`)
      return
    }

    // ── 도네이션 라우팅 규칙 (2026-08-30 확정) ──
    // 메뉴 추가는 오직 모집 중(collect)에만 한다.
    // 스핀 중·당첨 발표 후에는, "리롤권 인정"에 해당하는 것만 받고 나머지는 전부 무시.

    // 리롤 판정: 단일 도네 금액 ≥ 이번 회차 리롤 비용 → 리롤권 1개 누적.
    // 타이머는 멈추지 않고 끝까지 흐른다 — 그동안 여러 명의 리롤권이 계속 쌓일 수 있다.
    // 접수 마감 뒤(decision + windowOpened)에도 확정 전까지 인정 (치지직 연동 지연 대비).
    const rerollEligible =
      this.phase === 'window' || (this.phase === 'decision' && this.windowOpened)
    if (rerollEligible && d.amount >= this.effectiveRerollCost()) {
      const late = this.phase === 'decision'
      this.rerollCredits++
      this.rerollUsers.push(d.nick)
      this.addFeed(
        'reroll',
        `🔄 [${d.nick}] ${won}원 — 리롤권 +1 (보유 ${this.rerollCredits}개)${late ? ' · 마감 후 도착분 인정' : ''}`,
      )
      this.emit('armed', d.nick)
      return
    }

    // 리롤 접수 중·마감 후 대기 중의 리롤 비용 미만 도네는 무시
    if (rerollEligible) {
      this.addFeed(
        'skip',
        `[${d.nick}] ${won}원 — 리롤 비용(${this.effectiveRerollCost().toLocaleString('ko-KR')}원) 미만이라 반영 안 됨`,
      )
      return
    }

    // 모집 마감 후 도네는 이번 판에 반영하지 않는다
    if (this.phase === 'closed') {
      this.addFeed('skip', `[${d.nick}] ${won}원 — 모집이 마감되어 이번 판에는 반영되지 않습니다`)
      return
    }

    // 스핀 중 도네는 전부 무시
    if (this.phase === 'spinning') {
      this.addFeed('skip', `[${d.nick}] ${won}원 — 스핀 중에는 반영하지 않습니다`)
      return
    }

    // 당첨 발표 후 접수를 열기 전 상태도 전부 무시 (확정 후 다음 판 모집부터 반영)
    if (this.phase === 'decision') {
      this.addFeed('skip', `[${d.nick}] ${won}원 — 당첨 발표 대기 중: 반영 안 됨 (다음 판은 확정 후부터)`)
      return
    }

    if (d.amount < this.settings.minAmount) {
      this.addFeed('skip', `[${d.nick}] ${won}원 — 최소 금액(${this.settings.minAmount.toLocaleString('ko-KR')}원) 미만`)
      return
    }

    this.applyDonation(d)
  }

  private applyDonation(d: DonationInput): void {
    const slots = Math.floor(d.amount / this.settings.wonPerSlot)
    if (slots < 1) return
    const name = d.message.trim() ? d.message.trim().slice(0, 40) : `${d.nick}의 추천`
    const existing = this.menus.find((m) => m.name === name)
    if (existing) {
      existing.weight += slots
      if (!existing.donors.includes(d.nick)) existing.donors.push(d.nick)
    } else {
      this.menus.push({ id: this.nextMenuId++, name, weight: slots, donors: [d.nick] })
    }
    this.addFeed('add', `🍜 [${d.nick}] ${d.amount.toLocaleString('ko-KR')}원 → "${name}" ×${slots}`)
    this.emit('donation', { nick: d.nick, amount: d.amount, name, slots } satisfies AppliedDonation)
  }

  // ---- 스핀 / 리롤 상태 머신 ----
  /** 스핀 시작(자유 회전). 정지 버튼을 누르기 전까지 당첨은 정해지지 않는다.
   *  useCredit=true 면 리롤권을 1개 소모하는 리롤, false 면 자유 (재)돌리기 —
   *  당첨 발표 후에도 리롤 도네 없이 그냥 다시 돌릴 수 있다 ("3번 돌려서 나온 걸로" 운영) */
  beginSpin(useCredit = false): boolean {
    if (this.menus.length < 1 || this.phase === 'spinning') return false

    if (useCredit) {
      if (this.rerollCredits < 1 || (this.phase !== 'decision' && this.phase !== 'window')) {
        return false
      }
      this.stopCountdown()
      this.rerollCredits--
      this.rerollCount++
      this.addFeed(
        'reroll',
        `🔄 리롤 사용! (남은 리롤권 ${this.rerollCredits}개) — 직전 당첨 메뉴 포함하여 다시 돌립니다`,
      )
    } else if (this.phase === 'closing' || this.phase === 'closed') {
      // 모집 마감(또는 카운트다운 중) 상태에서 시작 — 이번 판의 첫 스핀이므로 별도 안내 없이 돈다
      this.stopCountdown()
    } else if (this.phase !== 'collect') {
      // 당첨 발표/리롤 대기 상태에서의 자유 재돌리기 — 이전 결과는 기록하지 않고 무시
      this.stopCountdown()
      this.addFeed('info', '🔁 다시 돌리기 — 이전 결과를 무시하고 새로 돌립니다')
    }

    this.phase = 'spinning'
    this.pendingWinner = null
    this.winner = null
    this.changed()
    return true
  }

  /** [정지] 시점에 가중치 추첨으로 당첨 칸을 확정 */
  pickWinner(): { index: number } | null {
    if (this.phase !== 'spinning') return null
    const total = this.totalWeight()
    let r = Math.random() * total
    let index = 0
    for (let i = 0; i < this.menus.length; i++) {
      r -= this.menus[i].weight
      if (r < 0) {
        index = i
        break
      }
    }
    this.pendingWinner = this.menus[index]
    return { index }
  }

  /** 스핀 애니메이션 종료 → 당첨 발표.
   *  리롤 도네 접수는 자동으로 열리지 않고 스트리머가 [리롤 도네 받기]를 눌러야 시작된다.
   *  남은 리롤권이 있으면 즉시 리롤 가능 상태 유지 */
  finishSpin(): void {
    if (this.phase !== 'spinning' || !this.pendingWinner) return
    this.winner = this.pendingWinner
    this.pendingWinner = null
    const total = this.totalWeight()
    this.winnerChance = total > 0 ? (this.winner.weight / total) * 100 : 0
    this.addFeed('win', `🎉 당첨: "${this.winner.name}" (확률 ${this.winnerChance.toFixed(2)}%)`)
    this.emit('winner', this.winner)
    this.windowOpened = false // 새 결과 — 접수 이력 초기화 (리롤 비용·잔여 리롤권은 확정 전까지 유지)
    this.phase = 'decision'
    this.changed()
  }

  /** 이번 회차에 적용되는 리롤 비용 */
  effectiveRerollCost(): number {
    return this.currentRerollCost ?? this.settings.rerollCost
  }

  /** [리롤 도네 받기] — 스트리머가 원하는 타이밍에, 이번 회차 금액을 정해 접수를 시작.
   *  (예: 1차 2만원 → 2차 4만원 → 3차 10만원처럼 회차마다 올려 받는 운영) */
  startRerollWindow(cost?: number): void {
    if (this.phase !== 'decision') return
    const sec = this.settings.rerollWindowSec
    if (cost !== undefined && Number.isFinite(cost) && cost >= 1000) {
      this.currentRerollCost = Math.floor(cost)
    }
    this.phase = 'window'
    this.windowOpened = true
    this.addFeed(
      'reroll',
      `🔔 리롤 도네 접수 시작! ${this.settings.rerollWindowSec}초 안에 단일 도네 ${this.effectiveRerollCost().toLocaleString('ko-KR')}원 이상`,
    )
    this.startCountdown(Date.now() + sec * 1000, sec * 1000)
    this.changed()
  }

  /** 카운트다운 시작 (모집 마감 / 리롤 접수 공용). 인자를 주면 그 마감 시각을 그대로 이어받는다 */
  private startCountdown(deadline: number, durationMs: number): void {
    this.stopCountdown()
    this.countdownDeadline = deadline
    this.countdownDurationMs = durationMs
    this.countdownRemainMs = Math.max(0, deadline - Date.now())
    this.countdownTimer = setInterval(() => {
      this.countdownRemainMs = Math.max(0, this.countdownDeadline - Date.now())
      this.emit('tick', this.countdownRemainMs)
      if (this.countdownRemainMs > 0) return
      this.stopCountdown()
      if (this.phase === 'closing') {
        // 모집 마감 — 이 순간부터 도네는 메뉴에 반영되지 않는다. 스핀은 스트리머가 [돌리기]를 눌러야 시작.
        this.phase = 'closed'
        this.addFeed('info', '🔒 모집 마감! 이후 도네는 이번 판에 반영되지 않습니다 — [돌리기]를 누르세요')
      } else {
        // 리롤 접수는 마감돼도 자동 확정하지 않는다 — 연동 지연으로 늦게 도착하는 도네를
        // 확정 전까지 인정하고, 스트리머가 재접수/확정을 선택한다
        this.phase = 'decision'
        this.addFeed('info', '⏱ 리롤 접수 마감 — 늦게 도착한 리롤 도네도 확정 전까지 인정됩니다')
      }
      this.changed()
    }, 200)
  }

  private stopCountdown(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
  }

  /** [⏱ 마감] — 모집 마감까지 N초. 이미 카운트다운 중이면 그만큼 연장한다(횟수 제한 없음).
   *  카운트다운 동안에도 도네는 정상적으로 메뉴에 반영된다 — 마감되는 순간부터 반영이 멈춘다. */
  startClosing(sec = this.settings.closingSec): void {
    if (this.phase !== 'collect' && this.phase !== 'closing' && this.phase !== 'closed') return
    if (this.menus.length < 1) return
    const add = Math.max(1, Math.floor(sec))
    if (this.phase === 'closing') {
      this.startCountdown(this.countdownDeadline + add * 1000, this.countdownDurationMs + add * 1000)
      this.addFeed('info', `⏱ 모집 마감 ${add}초 연장! 아직 기회가 있습니다`)
    } else if (this.phase === 'closed') {
      // 마감했다가 마음이 바뀌어 다시 받는 경우
      this.phase = 'closing'
      this.startCountdown(Date.now() + add * 1000, add * 1000)
      this.addFeed('info', `⏱ 모집 재개! ${add}초 더 받습니다`)
    } else {
      this.phase = 'closing'
      this.startCountdown(Date.now() + add * 1000, add * 1000)
      this.addFeed('info', `⏱ ${add}초 뒤 모집 마감 — 지금이 마지막 기회!`)
    }
    this.changed()
  }

  /** 결과 확정 (확정 버튼) → 라운드 기록 저장 */
  confirmResult(): void {
    if (this.phase !== 'decision' && this.phase !== 'window') return
    this.stopCountdown()
    const winnerName = this.winner?.name ?? '?'
    this.confirmedWinner = winnerName
    this.confirmedDonors = [...(this.winner?.donors ?? [])]
    this.confirmedChance = this.winnerChance
    if (this.rerollCredits > 0) {
      this.addFeed('info', `남은 리롤권 ${this.rerollCredits}개는 확정과 함께 소멸됩니다`)
    }
    this.addFeed('win', `✅ 최종 확정: "${winnerName}"`)

    this.history.unshift({
      id: this.nextRoundId++,
      endedAt: new Date().toISOString(),
      winner: winnerName,
      chance: this.winnerChance,
      rerollCount: this.rerollCount,
      menus: this.menus.map((m) => ({ name: m.name, weight: m.weight, donors: [...m.donors] })),
    })
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY

    this.phase = 'collect'
    this.rerollCount = 0
    this.rerollCredits = 0
    this.rerollUsers = []
    this.currentRerollCost = null
    this.windowOpened = false
    this.countdownRemainMs = 0
    this.emit('confirmed', winnerName)
    this.changed()
  }

  // ---- 메뉴 목록 내보내기 / 불러오기 ----
  exportMenusJson(): string {
    return JSON.stringify(
      {
        app: 'mukbang-roulette',
        type: 'menus',
        exportedAt: new Date().toISOString(),
        menus: this.menus.map((m) => ({ name: m.name, weight: m.weight, donors: [...m.donors] })),
      },
      null,
      2,
    )
  }

  /** 메뉴 JSON을 불러와 현재 후보 목록을 통째로 교체. 불러온 메뉴 수를 반환 */
  importMenusJson(text: string): number {
    const data = JSON.parse(text) as
      | { menus?: { name?: string; weight?: number; donors?: string[] }[] }
      | { name?: string; weight?: number }[]
    const raw = Array.isArray(data) ? data : data.menus
    if (!Array.isArray(raw)) throw new Error('형식이 올바르지 않습니다 (menus 배열 필요)')
    const menus: MenuItem[] = []
    for (const m of raw) {
      const name = String(m?.name ?? '').trim().slice(0, 40)
      const weight = Math.max(1, Math.floor(Number((m as { weight?: number })?.weight) || 1))
      if (!name) continue
      const existing = menus.find((x) => x.name === name)
      if (existing) existing.weight += weight
      else
        menus.push({
          id: this.nextMenuId++,
          name,
          weight,
          donors: Array.isArray((m as { donors?: string[] }).donors)
            ? ((m as { donors?: string[] }).donors as string[]).map(String)
            : [],
        })
    }
    if (menus.length === 0) throw new Error('불러올 메뉴가 없습니다')
    this.menus = menus
    this.addFeed('info', `📂 메뉴 ${menus.length}종 불러오기 완료 (기존 목록 교체)`)
    this.changed()
    return menus.length
  }

  // ---- 기록 내보내기 / 불러오기 ----
  exportHistoryJson(): string {
    return JSON.stringify(
      { app: 'mukbang-roulette', exportedAt: new Date().toISOString(), rounds: this.history },
      null,
      2,
    )
  }

  importHistoryJson(text: string): number {
    const data = JSON.parse(text) as { rounds?: Round[] }
    if (!data || !Array.isArray(data.rounds)) throw new Error('형식이 올바르지 않습니다')
    const rounds = data.rounds
      .filter((r) => r && typeof r.winner === 'string' && Array.isArray(r.menus))
      .slice(0, MAX_HISTORY)
    this.history = rounds
    this.nextRoundId = Math.max(0, ...rounds.map((r) => r.id ?? 0)) + 1
    this.addFeed('info', `📂 기록 ${rounds.length}개 불러오기 완료`)
    this.changed()
    return rounds.length
  }
}

export const store = new Store()
