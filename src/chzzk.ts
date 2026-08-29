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
    alert('설정에서 Client ID를 먼저 입력해주세요.')
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
  if (res.status === 401 && retry && t.refreshToken) {
    saveTokens(await tokenRequest({ grantType: 'refresh_token', refreshToken: t.refreshToken }))
    return api<T>(path, init, false)
  }
  const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null
  if (!res.ok) throw new Error(json?.message ?? `HTTP ${res.status}`)
  return json as T
}

function msg(e: unknown): string {
  if (e instanceof TypeError) return '네트워크/CORS 차단 — 설정의 프록시 URL을 확인하세요'
  return e instanceof Error ? e.message : String(e)
}

/** 세션 연결 + 후원 이벤트 구독 */
export async function connect(): Promise<void> {
  manualOff = false
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  disconnectSocket()
  statusCb('connecting', '세션 URL 요청 중...')
  try {
    const auth = await api<{ content?: { url?: string } }>('/open/v1/sessions/auth')
    const url = auth.content?.url
    if (!url) throw new Error('세션 URL을 받지 못했습니다')
    openSocket(url)
  } catch (e) {
    statusCb('error', msg(e))
    scheduleReconnect()
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
    store.handleDonation({
      // 동일인이 3초 안에 같은 금액·메시지를 중복 수신하는 경우만 걸러낸다
      id: `chzzk|${nick}|${amount}|${text}|${Math.floor(Date.now() / 3000)}`,
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
    statusCb('error', `후원 구독 실패: ${msg(e)}`)
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
  reconnectDelay = Math.min(reconnectDelay * 2, 60000)
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
