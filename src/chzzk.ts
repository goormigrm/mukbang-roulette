// 치지직 Open API 연동: OAuth 로그인 → 세션 생성(Socket.IO) → 후원(donation) 이벤트 구독
// 주의: openapi.chzzk.naver.com 은 브라우저 CORS를 허용하지 않으므로
// REST 호출은 프록시(proxy/worker.js, Cloudflare Worker)를 거쳐야 한다.

import io from 'socket.io-client'
import type { ChzzkSocket } from 'socket.io-client'
import { store } from './state'

const DIRECT_API = 'https://openapi.chzzk.naver.com'
const LS_TOKEN = 'mr:chzzk-token'
const LS_STATE = 'mr:oauth-state'

export type ChzzkStatus = 'off' | 'connecting' | 'on' | 'error'

interface TokenSet {
  accessToken: string
  refreshToken: string
}

let socket: ChzzkSocket | null = null
let statusCb: (s: ChzzkStatus, detail?: string) => void = () => {}
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 5000
let manualOff = true
/** connect()가 겹쳐 호출됐을 때 먼저 시작한 쪽이 뒤늦게 소켓을 여는 것을 막는 세대 번호 */
let connectGen = 0
/** 같은 사람·금액·메시지 이벤트가 이 시간 안에 다시 오면 네트워크 중복 전달로 보고 무시 */
const DEDUPE_MS = 1000
const recentDonations = new Map<string, number>()

/** 리프레시 토큰까지 만료돼 다시 로그인해야 하는 상황 */
class AuthExpiredError extends Error {
  constructor() {
    super('로그인이 만료되었습니다 — [치지직 로그인]을 다시 눌러주세요')
    this.name = 'AuthExpiredError'
  }
}

export function onStatus(cb: (s: ChzzkStatus, detail?: string) => void): void {
  statusCb = cb
}

function apiBase(): string {
  const p = store.settings.proxyUrl.trim().replace(/\/+$/, '')
  return p || DIRECT_API
}

function tokens(): TokenSet | null {
  try {
    return JSON.parse(localStorage.getItem(LS_TOKEN) ?? 'null') as TokenSet | null
  } catch {
    return null
  }
}

function saveTokens(t: TokenSet | null): void {
  if (t) localStorage.setItem(LS_TOKEN, JSON.stringify(t))
  else localStorage.removeItem(LS_TOKEN)
}

export function hasToken(): boolean {
  return tokens() !== null
}

export function logout(): void {
  disconnect()
  saveTokens(null)
  store.addFeed('info', '🔓 치지직 로그아웃 (토큰 삭제)')
}

/** 개발자센터에 등록해야 하는 로그인 리디렉션 URI */
export function redirectUri(): string {
  return location.origin + location.pathname
}

/** 치지직 계정 연동(OAuth) 페이지로 이동 */
export function startLogin(): void {
  if (!store.settings.clientId) {
    alert('치지직 앱 정보(Client ID)가 사이트에 설정되지 않았습니다. 개발자에게 문의하세요 (src/config.ts).')
    return
  }
  const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  localStorage.setItem(LS_STATE, state)
  const u = new URL('https://chzzk.naver.com/account-interlock')
  u.searchParams.set('clientId', store.settings.clientId)
  u.searchParams.set('redirectUri', redirectUri())
  u.searchParams.set('state', state)
  location.href = u.toString()
}

/** 로그인 후 돌아온 code를 토큰으로 교환. 교환에 성공하면 true */
export async function handleOAuthRedirect(): Promise<boolean> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const st = params.get('state')
  if (!code) return false
  history.replaceState(null, '', location.pathname)
  if (!st || st !== localStorage.getItem(LS_STATE)) {
    statusCb('error', 'OAuth state 값이 일치하지 않습니다. 다시 로그인해주세요.')
    return false
  }
  localStorage.removeItem(LS_STATE)
  try {
    saveTokens(await tokenRequest({ grantType: 'authorization_code', code, state: st }))
    store.addFeed('info', '🔑 치지직 로그인 성공')
    return true
  } catch (e) {
    statusCb('error', `토큰 교환 실패: ${msg(e)}`)
    return false
  }
}

async function tokenRequest(extra: Record<string, string>): Promise<TokenSet> {
  const { clientId, clientSecret } = store.settings
  if (!clientId) throw new Error('Client ID가 설정되지 않았습니다')
  // Client Secret은 프록시 워커의 환경 변수(CHZZK_CLIENT_SECRET)에 저장해 두는 것을 권장.
  // 설정에 입력된 경우에만 함께 보내고, 비어 있으면 워커가 채워 넣는다.
  const body: Record<string, string> = { clientId, ...extra }
  if (clientSecret) body.clientSecret = clientSecret
  const res = await fetch(`${apiBase()}/auth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as {
    content?: { accessToken?: string; refreshToken?: string }
    message?: string
  } | null
  if (!res.ok || !json?.content?.accessToken) {
    throw new Error(json?.message ?? `HTTP ${res.status}`)
  }
  return { accessToken: json.content.accessToken, refreshToken: json.content.refreshToken ?? '' }
}

async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const t = tokens()
  if (!t) throw new Error('로그인이 필요합니다')
  const res = await fetch(apiBase() + path, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${t.accessToken}`,
      'Content-Type': 'application/json',
    },
  })
  if (res.status === 401) {
    if (retry && t.refreshToken) {
      try {
        saveTokens(await tokenRequest({ grantType: 'refresh_token', refreshToken: t.refreshToken }))
      } catch {
        // 리프레시마저 거절 → 토큰을 지워 재로그인 경로를 열어주고, 재연결 루프는 멈춘다
        saveTokens(null)
        throw new AuthExpiredError()
      }
      return api<T>(path, init, false)
    }
    saveTokens(null)
    throw new AuthExpiredError()
  }
  const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null
  if (!res.ok) throw new Error(json?.message ?? `HTTP ${res.status}`)
  return json as T
}

function msg(e: unknown): string {
  if (e instanceof TypeError) return '네트워크/CORS 차단 — 설정의 프록시 URL을 확인하세요'
  return e instanceof Error ? e.message : String(e)
}

/** 연결 과정의 실패 처리 — 로그인 만료면 멈추고(재로그인 필요), 그 외에는 백오프 재연결 */
function handleFailure(e: unknown): void {
  if (e instanceof AuthExpiredError) {
    manualOff = true
    disconnectSocket()
    statusCb('error', e.message)
    return
  }
  statusCb('error', msg(e))
  scheduleReconnect()
}

/** 세션 연결 + 후원 이벤트 구독 */
export async function connect(): Promise<void> {
  if (!hasToken()) {
    // 토큰이 없는데 재연결을 돌리면 끝없이 실패하므로 여기서 멈추고 로그인을 요구한다
    manualOff = true
    statusCb('error', '로그인이 필요합니다 — [치지직 로그인]을 눌러주세요')
    return
  }
  const gen = ++connectGen
  manualOff = false
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  disconnectSocket()
  statusCb('connecting', '세션 URL 요청 중...')
  try {
    const auth = await api<{ content?: { url?: string } }>('/open/v1/sessions/auth')
    if (gen !== connectGen) return // 그 사이 다른 connect()가 시작됨 — 이쪽은 조용히 포기
    const url = auth.content?.url
    if (!url) throw new Error('세션 URL을 받지 못했습니다')
    openSocket(url)
  } catch (e) {
    if (gen !== connectGen) return
    handleFailure(e)
  }
}

function openSocket(url: string): void {
  statusCb('connecting', '웹소켓 연결 중...')
  const s = io(url, {
    reconnection: false,
    transports: ['websocket'],
    timeout: 8000,
    forceNew: true,
  })
  socket = s

  s.on('SYSTEM', (raw) => {
    const ev = parseEvent(raw) as { type?: string; data?: { sessionKey?: string; eventType?: string } } | null
    if (!ev) return
    if (ev.type === 'connected' && ev.data?.sessionKey) {
      void subscribeDonation(ev.data.sessionKey)
    } else if (ev.type === 'subscribed') {
      reconnectDelay = 5000
      statusCb('on', '후원 이벤트 수신 중')
      store.addFeed('info', '🟢 치지직 연결 완료 — 후원 이벤트 수신 시작')
    } else if (ev.type === 'revoked') {
      statusCb('error', '이벤트 구독이 해제되었습니다(revoked)')
    }
  })

  s.on('DONATION', (raw) => {
    const d = parseEvent(raw) as {
      donationType?: string
      donatorNickname?: string
      payAmount?: string | number
      donationText?: string
    } | null
    if (!d) return
    const amount = Number(d.payAmount) || 0
    const nick = d.donatorNickname || '익명'
    const text = d.donationText ?? ''
    const now = Date.now()
    // 치지직 이벤트에는 고유 ID가 없다. 네트워크 중복 전달만 거르도록
    // "같은 사람·금액·메시지가 1초 안에 두 번"인 경우만 중복으로 본다 — 시청자의 진짜 연타는 살린다
    const key = `${nick}|${amount}|${text}`
    const last = recentDonations.get(key)
    if (last !== undefined && now - last < DEDUPE_MS) {
      store.addFeed('skip', `[${nick}] ${amount.toLocaleString('ko-KR')}원 — 1초 내 동일 이벤트 중복 수신, 무시`)
      store.emitChange()
      return
    }
    recentDonations.set(key, now)
    if (recentDonations.size > 500) recentDonations.clear()
    store.handleDonation({
      id: `chzzk|${key}|${now}`,
      nick,
      amount,
      message: text,
      isVideo: (d.donationType ?? '').toUpperCase().includes('VIDEO'),
    })
  })

  s.on('disconnect', () => {
    if (!manualOff) {
      statusCb('error', '연결이 끊어졌습니다 — 재연결 시도')
      scheduleReconnect()
    }
  })
  s.on('connect_error', () => {
    statusCb('error', '웹소켓 연결 실패')
    scheduleReconnect()
  })
  s.on('connect_timeout', () => {
    statusCb('error', '웹소켓 연결 시간 초과')
    scheduleReconnect()
  })
}

async function subscribeDonation(sessionKey: string): Promise<void> {
  try {
    await api(`/open/v1/sessions/events/subscribe/donation?sessionKey=${encodeURIComponent(sessionKey)}`, {
      method: 'POST',
    })
  } catch (e) {
    // 소켓만 열리고 구독이 안 된 채 방치되지 않도록 — 재연결(또는 로그인 만료 안내)로 넘긴다
    handleFailure(e instanceof AuthExpiredError ? e : new Error(`후원 구독 실패: ${msg(e)}`))
  }
}

function parseEvent(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return raw
}

function scheduleReconnect(): void {
  if (manualOff || reconnectTimer !== null) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (!manualOff) void connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, 15000) // 방송 중이므로 최대 대기를 15초로 짧게
}

function disconnectSocket(): void {
  if (socket) {
    try {
      socket.disconnect()
    } catch {
      // 이미 끊긴 소켓은 무시
    }
    socket = null
  }
}

/** 수동 연결 해제 */
export function disconnect(): void {
  manualOff = true
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  disconnectSocket()
  statusCb('off')
}
