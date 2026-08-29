// ─────────────────────────────────────────────────────────────
// 개발자가 배포 전에 채워두는 값.
// 여기를 채워서 배포하면 스트리머는 설정에서 아무것도 입력할 필요 없이
// [치지직 로그인] → 공식 치지직 페이지에서 [동의] 클릭만 하면 된다.
// ─────────────────────────────────────────────────────────────

/** 치지직 개발자센터에서 발급받은 Client ID (공개되어도 되는 값) */
export const PRESET_CLIENT_ID = '95337781-0490-4c9b-ac9a-9577a9ef4db0'

/** 배포한 Cloudflare Worker 주소 (예: 'https://mukbang-proxy.xxx.workers.dev')
 *  Client Secret은 여기 코드가 아니라 워커의 환경 변수(CHZZK_CLIENT_SECRET)에 저장한다 */
export const PRESET_PROXY_URL = ''
