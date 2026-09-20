// 새 버전이 배포되면 이미 열어둔 화면도 스스로 따라가게 한다.
// GitHub Pages는 정적이라 서버가 알려줄 수 없으므로, index.html을 주기적으로 받아
// 빌드마다 이름이 바뀌는 스크립트 파일(assets/index-XXXX.js)이 달라졌는지 본다.

const CHECK_MS = 90_000

/** 지금 이 화면이 불러온 앱 스크립트 주소 */
function currentScript(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src]')
  return el?.getAttribute('src') ?? null
}

/** 서버에 올라가 있는 최신 index.html이 가리키는 앱 스크립트 주소 */
async function latestScript(): Promise<string | null> {
  const res = await fetch(`${location.pathname}?_=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return null
  const html = await res.text()
  return html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1] ?? null
}

/**
 * 새 버전이 올라왔는지 주기적으로 확인한다.
 * 찾으면 onFound를 한 번만 부른다 (새로고침 시점은 호출한 쪽이 정한다).
 */
export function watchForUpdates(onFound: () => void): void {
  const mine = currentScript()
  if (!mine) return
  let notified = false
  const check = async () => {
    if (notified) return
    try {
      const latest = await latestScript()
      if (latest && latest !== mine) {
        notified = true
        onFound()
      }
    } catch {
      // 네트워크가 잠깐 끊긴 경우 — 다음 주기에 다시 본다
    }
  }
  setInterval(check, CHECK_MS)
  // 화면을 다시 볼 때도 한 번 확인 (한참 방치했다가 돌아온 경우)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
}
