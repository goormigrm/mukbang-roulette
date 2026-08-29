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
  rerollCount: number
  menus: { name: string; weight: number; donors: string[] }[]
}

// collect(모집) → spinning(회전) → decision(당첨 발표, 스트리머 선택 대기)
//   → window(리롤 도네 접수, 타이머) → armed(리롤권 보유) → 확정 시 collect로
export type Phase = 'collect' | 'spinning' | 'decision' | 'window' | 'armed'

export interface Settings {
  rerollCost: number
  rerollWindowSec: number
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
export const MAX_HISTORY = 20

type EventName = 'change' | 'tick' | 'winner' | 'armed' | 'donation'

export class Store {
  settings: Settings = { ...DEFAULT_SETTINGS }
  menus: MenuItem[] = []
  feed: FeedEntry[] = []
  history: Round[] = []
  phase: Phase = 'collect'
  paused = false // 도네이션 반영 일시정지
  winner: MenuItem | null = null
  confirmedWinner: string | null = null
  /** 사용 가능한 리롤권 수 (단일 도네 ≥ 리롤비용 1건당 1개 누적) */
  rerollCredits = 0
  rerollUsers: string[] = []
  rerollCount = 0
  windowRemainMs = 0

  private pendingWinner: MenuItem | null = null
  private pendingDonations: DonationInput[] = []
  private seen = new Set<string>()
  private nextMenuId = 1
  private nextRoundId = 1
  private windowTimer: ReturnType<typeof setInterval> | null = null
  private windowDeadline = 0
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
    try {
      const s = localStorage.getItem(LS_SETTINGS)
      if (s) this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) }
      // 개발자가 미리 심어둔 값이 있으면, 사용자가 직접 입력하지 않은 빈 칸을 채운다
      if (!this.settings.clientId) this.settings.clientId = PRESET_CLIENT_ID
      if (!this.settings.proxyUrl) this.settings.proxyUrl = PRESET_PROXY_URL
      const m = localStorage.getItem(LS_MENUS)
      if (m) {
        this.menus = JSON.parse(m)
        this.nextMenuId = Math.max(0, ...this.menus.map((x) => x.id)) + 1
      }
      const h = localStorage.getItem(LS_HISTORY)
      if (h) {
        this.history = JSON.parse(h)
        this.nextRoundId = Math.max(0, ...this.history.map((x) => x.id)) + 1
      }
      this.paused = localStorage.getItem(LS_PAUSED) === '1'
    } catch {
      // 손상된 저장값은 무시하고 기본값으로 시작
    }
  }
  private save(): void {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(this.settings))
      localStorage.setItem(LS_MENUS, JSON.stringify(this.menus))
      localStorage.setItem(LS_HISTORY, JSON.stringify(this.history))
      localStorage.setItem(LS_PAUSED, this.paused ? '1' : '0')
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
    name = name.trim().slice(0, 20)
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

  clearMenus(): void {
    this.menus = []
    this.winner = null
    this.confirmedWinner = null
    this.rerollCount = 0
    this.addFeed('info', '🧹 룰렛 초기화')
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

    // 리롤 판정: 리롤 대기/리롤 가능 중 + 단일 도네 금액 ≥ 리롤 비용 → 리롤권 1개 누적
    // (일시정지와 무관하게 동작)
    if ((this.phase === 'window' || this.phase === 'armed') && d.amount >= this.settings.rerollCost) {
      this.rerollCredits++
      this.rerollUsers.push(d.nick)
      if (this.phase === 'window') {
        this.stopWindowTimer()
        this.phase = 'armed'
      }
      this.addFeed('reroll', `🔄 [${d.nick}] ${won}원 — 리롤권 +1 (보유 ${this.rerollCredits}개)`)
      this.emit('armed', d.nick)
      return
    }

    if (this.paused) {
      this.addFeed('skip', `⏸ [${d.nick}] ${won}원 "${d.message}" — 일시정지 중, 반영 안 됨`)
      return
    }

    if (d.amount < this.settings.minAmount) {
      this.addFeed('skip', `[${d.nick}] ${won}원 — 최소 금액(${this.settings.minAmount.toLocaleString('ko-KR')}원) 미만`)
      return
    }

    if (this.phase === 'spinning') {
      this.pendingDonations.push(d)
      this.addFeed('info', `⏳ [${d.nick}] ${won}원 — 스핀 종료 후 반영 예정`)
      return
    }

    this.applyDonation(d)
  }

  private applyDonation(d: DonationInput): void {
    const slots = Math.floor(d.amount / this.settings.wonPerSlot)
    if (slots < 1) return
    const name = d.message.trim() ? d.message.trim().slice(0, 20) : `${d.nick}의 추천`
    const existing = this.menus.find((m) => m.name === name)
    if (existing) {
      existing.weight += slots
      if (!existing.donors.includes(d.nick)) existing.donors.push(d.nick)
    } else {
      this.menus.push({ id: this.nextMenuId++, name, weight: slots, donors: [d.nick] })
    }
    this.addFeed('add', `🍜 [${d.nick}] ${d.amount.toLocaleString('ko-KR')}원 → "${name}" ×${slots}`)
    this.emit('donation', d)
  }

  // ---- 스핀 / 리롤 상태 머신 ----
  /** 스핀 시작(자유 회전). 정지 버튼을 누르기 전까지 당첨은 정해지지 않는다 */
  beginSpin(): boolean {
    if (this.menus.length < 2) return false
    if (this.phase !== 'collect' && this.phase !== 'armed') return false

    if (this.phase === 'armed') {
      this.rerollCredits--
      this.rerollCount++
      this.addFeed(
        'reroll',
        `🔄 리롤 사용! (남은 리롤권 ${this.rerollCredits}개) — 직전 당첨 메뉴 포함하여 다시 돌립니다`,
      )
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
    this.addFeed('win', `🎉 당첨: "${this.winner.name}"`)
    this.emit('winner', this.winner)
    this.phase = this.rerollCredits > 0 ? 'armed' : 'decision'

    // 스핀 중 대기열 반영 (규칙 엔진을 다시 통과시켜 리롤권 판정도 받게 한다)
    const queued = this.pendingDonations
    this.pendingDonations = []
    for (const d of queued) this.routeDonation(d)
    this.changed()
  }

  /** [리롤 도네 받기] — 스트리머가 원하는 타이밍에 리롤 도네 접수를 시작 */
  startRerollWindow(): void {
    if (this.phase !== 'decision') return
    this.phase = 'window'
    this.addFeed(
      'reroll',
      `🔔 리롤 도네 접수 시작! ${this.settings.rerollWindowSec}초 안에 단일 도네 ${this.settings.rerollCost.toLocaleString('ko-KR')}원 이상`,
    )
    this.startWindowTimer()
    this.changed()
  }

  private startWindowTimer(): void {
    this.stopWindowTimer()
    this.windowDeadline = Date.now() + this.settings.rerollWindowSec * 1000
    this.windowRemainMs = this.settings.rerollWindowSec * 1000
    this.windowTimer = setInterval(() => {
      this.windowRemainMs = Math.max(0, this.windowDeadline - Date.now())
      this.emit('tick', this.windowRemainMs)
      if (this.windowRemainMs <= 0) {
        this.addFeed('info', '⏱ 리롤 시간 종료 — 결과 확정')
        this.confirmResult()
      }
    }, 200)
  }

  private stopWindowTimer(): void {
    if (this.windowTimer !== null) {
      clearInterval(this.windowTimer)
      this.windowTimer = null
    }
  }

  /** 결과 확정 (확정 버튼 또는 시간 만료) → 라운드 기록 저장 */
  confirmResult(): void {
    if (this.phase !== 'decision' && this.phase !== 'window' && this.phase !== 'armed') return
    this.stopWindowTimer()
    const winnerName = this.winner?.name ?? '?'
    this.confirmedWinner = winnerName
    if (this.rerollCredits > 0) {
      this.addFeed('info', `남은 리롤권 ${this.rerollCredits}개는 확정과 함께 소멸됩니다`)
    }
    this.addFeed('win', `✅ 최종 확정: "${winnerName}"`)

    this.history.unshift({
      id: this.nextRoundId++,
      endedAt: new Date().toISOString(),
      winner: winnerName,
      rerollCount: this.rerollCount,
      menus: this.menus.map((m) => ({ name: m.name, weight: m.weight, donors: [...m.donors] })),
    })
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY

    this.phase = 'collect'
    this.rerollCount = 0
    this.rerollCredits = 0
    this.rerollUsers = []
    this.changed()
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
