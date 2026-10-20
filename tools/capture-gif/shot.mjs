// 공지글에 붙일 화면 사진 2장을 헤드리스 크롬으로 찍는다.
//  1) 리롤 접수 중 — 다음 리롤 금액이 상태바·리롤 버튼에 미리 떠 있는 화면
//  2) 당첨 발표 — 룰렛 이름 현판이 원판·당첨 도장을 가리지 않는 자리에 앉은 화면
//
// 배포본에는 디버그 훅(window.__store)이 없으므로 **개발 서버**를 띄워 두고 찍는다.
//   npm run dev   (다른 창에서)
//   node shot.mjs [http://localhost:5173/mukbang-roulette/]
import { chromium } from 'playwright'

const SITE = process.argv[2] ?? 'http://localhost:5173/mukbang-roulette/'
const OUT = '../../docs'
const VW = 1560
const VH = 1000

// 도네로 만들어진 것처럼 보이도록 추천자 닉네임까지 넣는다 (capture.mjs와 같은 목록)
const MENUS = [
  ['차돌짬뽕', 27, '짬뽕순대'],
  ['마라탕', 19, '마라중독자'],
  ['양꼬치에칭따오', 15, '칭따오한잔'],
  ['곱창전골', 14, '곱창러버'],
  ['후라이드치킨', 12, '치킨은살안쪄'],
  ['탕수육 부먹', 11, '부먹파영원히'],
  ['탕수육 찍먹', 11, '찍먹이정답'],
  ['대창덮밥', 9, '기름진게좋아'],
  ['마라샹궈', 8, '매운맛5단계'],
  ['삼겹살 2인분', 8, '고기굽는남자'],
  ['족발 大', 7, '야식요정'],
  ['간장게장', 7, '밥도둑잡아라'],
  ['멘보샤', 6, '새우토스트'],
  ['치즈돈까스', 5, '치즈늘어남'],
  ['부대찌개', 5, '사리요정'],
  ['모둠회 특대', 5, '회떠주세요'],
  ['로제떡볶이', 4, '떡볶이요정'],
  ['짜장면 곱빼기', 4, '면치기장인'],
  ['감자탕', 3, '뼈해장국'],
  ['닭발', 3, '불닭발'],
  ['초밥 20피스', 3, '연어사랑'],
  ['김밥 두줄', 1, '소액이라죄송'],
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: VW, height: VH } })
await page.addInitScript(() => {
  for (const k of ['mr:menus', 'mr:round', 'mr:feed', 'mr:history', 'mr:paused']) localStorage.removeItem(k)
  localStorage.setItem('mr:settings', JSON.stringify({ sound: false }))
})
await page.goto(SITE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 10000 })
await page.evaluate(() => document.fonts.ready)

/** 애니메이션을 끝 상태로 보내고(도장이 커진 채로 찍히지 않게) 한 프레임 쉰다.
 *  깜빡임처럼 끝이 없는 것은 finish()가 안 되므로 멈춰만 둔다 */
const settle = async () => {
  await page.evaluate(() =>
    document.getAnimations().forEach((a) => {
      try {
        a.finish()
      } catch {
        a.pause()
      }
    }),
  )
  await page.waitForTimeout(250)
}

const shoot = async (name) => {
  await settle()
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(name)
}

// ---- 공통: 후보를 채우고 **실제로 한 판 돌린다** ----
// 추첨만 끼워 넣으면 포인터가 가리키는 칸과 당첨 메뉴가 어긋나 찍힌다 — 공지 사진으로는
// 조작처럼 보이므로, 버튼을 눌러 감속까지 끝낸 진짜 결과를 찍는다.
await page.evaluate(
  ({ menus, title }) => {
    const s = window.__store
    s.setTitle(title)
    for (const [n, w, donor] of menus) s.addMenu(n, w, donor)
  },
  { menus: MENUS, title: '오늘의 메인 메뉴' },
)
const clickSpin = () => page.evaluate(() => document.querySelector('#btn-spin').click())
await clickSpin()
await page.waitForTimeout(1300) // 최소 회전 시간(1초) 경과 후 정지
await clickSpin()
await page.waitForFunction(() => window.__store.phase === 'decision', null, { timeout: 20000 })
await page.waitForTimeout(4000) // 폭죽·색종이가 걷힐 때까지 (허공에 멈춘 채로 찍히지 않게)

// ---- 1) 당첨 발표 — 룰렛 이름 현판 + 당첨 도장 ----
await shoot('patch-2026-10-17-round-title')

// ---- 2) [🔔 리롤 도네 받기] 창 — 이번 금액과 **다음 금액**을 같이 정하는 화면 ----
await page.evaluate(() => document.querySelector('#btn-open-window').click())
await page.waitForSelector('#modal-backdrop:not([hidden])')
await page.waitForTimeout(300) // 첫 칸에 포커스가 가는 것(rAF)까지 기다린다
// 첫 칸이 전체 선택된 채로 찍히면 파란 블록이 눈에 거슬린다 — 포커스는 두고 선택만 푼다
await page.evaluate(() => {
  const i = document.querySelector('#modal-input-0')
  i?.setSelectionRange(i.value.length, i.value.length)
})
await shoot('patch-2026-10-17-reroll-next')

await browser.close()
