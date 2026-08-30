# 철면수심 먹방 룰렛 🌶️

치지직 스트리머 **철면수심** 전용 도네이션 연동 먹방 메뉴 룰렛.
시청자가 도네이션으로 메뉴를 추천하면 **1,000원당 1칸**씩 룰렛에 쌓이고, 스핀으로 오늘의 먹방 메뉴를 뽑는다.

**접속**: https://goormigrm.github.io/mukbang-roulette/

## 규칙

| 항목 | 규칙 |
|---|---|
| 메뉴 추가 | 도네 메시지가 메뉴 이름, 1,000원당 1칸 (예: 3,000원 "차돌짬뽕" → ×3) |
| 최소 금액 | 1,000원 미만 무시 · 상한 없음 · 영상 도네 제외 |
| 리롤 | 당첨 후 [리롤 도네 받기]로 접수를 열고 회차 금액 입력(기본 20,000원·60초) — **단일 도네가 그 금액 이상**이면 리롤권 1개씩 누적, 시간은 끝까지 흐름 |
| 리롤 결과 | 직전 당첨 메뉴도 포함해 다시 스핀, **마지막 리롤 결과가 최종** |
| 그 외 도네 | 메뉴 추천은 **모집 중에만** 반영 — 스핀 중·당첨 발표 후·접수 중 미달 금액은 무시(피드에 기록) |
| 기록 | 결과 확정 시 자동 저장(최근 20개), 기록 탭에서 확인 + JSON 내보내기/불러오기 |

리롤 비용·제한시간·칸당 금액 등은 ⚙ 설정에서 자유롭게 변경할 수 있다.
운영 편의: 도네 반영 일시정지 토글(⏸ — 정지 중엔 리롤 적립도 안 됨), 리롤 도네 없이 [🔁 다시 돌리기],
칸 조절 클릭 ±1 / Ctrl+클릭 ±10 / Alt+클릭 ±100, 메뉴 JSON 내보내기·불러오기(예시 50종 `public/sample-menus.json`), 테스트 도네이션.

## 치지직 연동 설정

역할이 둘로 나뉜다. **스트리머는 키·비밀번호를 어디에도 입력하지 않는다.**

### 개발자가 할 일 (최초 1회)

1. **앱 등록** — [치지직 개발자센터](https://developers.chzzk.naver.com)에서 애플리케이션 등록
   - 로그인 리디렉션 URI: `https://goormigrm.github.io/mukbang-roulette/`
   - 후원(도네이션) 조회 권한 포함으로 신청 → **Client ID / Client Secret** 발급
2. **프록시 배포** — [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create Worker
   → [`proxy/worker.js`](proxy/worker.js) 내용 붙여넣고 Deploy
   → Worker의 **Settings → Variables and Secrets**에 `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET` 등록 (Secret 타입)
3. **기본값 심기** — [`src/config.ts`](src/config.ts)의 `PRESET_CLIENT_ID`(발급받은 Client ID)와
   `PRESET_PROXY_URL`(워커 주소)을 채우고 `git push` → 자동 재배포

### 스트리머(철면수심)가 할 일 (최초 1회, 클릭 2번)

1. 평소 쓰는 브라우저(치지직에 이미 로그인된)로 https://goormigrm.github.io/mukbang-roulette/ 접속
2. 오른쪽 위 **[치지직 로그인]** 클릭 → **공식 치지직 페이지**에서 [동의] 클릭 (비밀번호 입력 없음, 이 사이트는 계정 정보를 볼 수 없음) → 자동 복귀 후 상단 배지가 **🟢 치지직 수신 중**이면 완료

이후에는 사이트에 접속만 하면 자동으로 다시 연결된다. 토큰은 스트리머 본인 브라우저(localStorage)에만 저장된다.

⚠ 도네이션은 **룰렛 탭이 켜져 있는 동안만** 수신된다 — 탭을 닫아둔 사이의 도네는 나중에 소급 반영되지 않으니 방송 중에는 켜 둘 것. (서버가 따로 없어 꺼진 동안 소모되는 자원도 없다)

## 개발

```bash
npm install
npm run dev     # http://localhost:5173/mukbang-roulette/
npm run build   # 타입체크 + dist/ 빌드
```

`main` 브랜치에 push하면 GitHub Actions가 자동으로 GitHub Pages에 배포한다.
설계 문서: [DESIGN.md](DESIGN.md)
