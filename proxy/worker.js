// 치지직 Open API CORS 프록시 (Cloudflare Workers)
//
// openapi.chzzk.naver.com 은 브라우저에서 직접 호출할 수 없으므로(CORS 차단)
// 이 워커가 요청을 그대로 전달하고 CORS 헤더만 붙여준다.
//
// ★ 배포 방법 — 개발자가 최초 1회 (5분, 무료):
//   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
//   2. 이 파일 내용을 통째로 붙여넣고 Deploy
//   3. Worker 설정 → Variables and Secrets 에 아래 두 개를 추가 (type: Secret 권장)
//        CHZZK_CLIENT_ID     = 치지직 개발자센터에서 발급받은 Client ID
//        CHZZK_CLIENT_SECRET = 치지직 개발자센터에서 발급받은 Client Secret
//   4. 발급된 https://<이름>.<계정>.workers.dev 주소를
//      프론트 src/config.ts 의 PRESET_PROXY_URL 에 넣고 재배포
//
// Secret을 워커에 저장해 두면 사이트(스트리머)는 Client Secret을 알 필요가 없다.
// 토큰 교환 요청(/auth/v1/token)에 clientId/clientSecret이 비어 있으면 워커가 채워 넣는다.
//
// (선택) 아래 ALLOWED_ORIGINS 에 GitHub Pages 주소를 넣으면
// 다른 사이트에서 이 프록시를 못 쓰게 잠글 수 있다. 빈 배열이면 모두 허용.

const UPSTREAM = 'https://openapi.chzzk.naver.com'
const ALLOWED_ORIGINS = [] // 예: ['https://goormigrm.github.io']
const ALLOWED_PATHS = /^\/(auth\/v1\/|open\/v1\/)/

function corsHeaders(origin) {
  const allow =
    ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? origin || '*' : 'null'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (!ALLOWED_PATHS.test(url.pathname)) {
      return new Response('Forbidden path', { status: 403, headers: corsHeaders(origin) })
    }

    let body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text()

    // 토큰 교환: 워커에 저장된 Client ID/Secret을 채워 넣는다 (프론트에 Secret 노출 방지)
    if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
      let parsed = {}
      try {
        parsed = JSON.parse(body || '{}')
      } catch {
        parsed = {}
      }
      if (env && env.CHZZK_CLIENT_ID && !parsed.clientId) parsed.clientId = env.CHZZK_CLIENT_ID
      if (env && env.CHZZK_CLIENT_SECRET) parsed.clientSecret = env.CHZZK_CLIENT_SECRET
      body = JSON.stringify(parsed)
    }

    const upstreamReq = new Request(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers: {
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
        Authorization: request.headers.get('Authorization') || '',
      },
      body,
    })

    const upstream = await fetch(upstreamReq)
    const res = new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        ...corsHeaders(origin),
      },
    })
    return res
  },
}
