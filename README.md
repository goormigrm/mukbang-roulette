# 철면수심 먹방 룰렛 🌶️

치지직 스트리머 **철면수심** 전용 도네이션 연동 먹방 메뉴 룰렛.
시청자가 도네이션으로 메뉴를 추천하면 **1,000원당 1칸**씩 룰렛에 쌓이고, 스핀으로 오늘의 먹방 메뉴를 뽑는다.

**접속**: https://goormigrm.github.io/mukbang-roulette/

## 규칙

| 항목 | 규칙 |
|---|---|
| 메뉴 추가 | 도네 메시지가 메뉴 이름, 1,000원당 1칸 (예: 3,000원 "차돌짬뽕" → ×3) |
| 최소 금액 | 1,000원 미만 무시 · 상한 없음 · 영상 도네 제외 |
| 리롤 | 당첨 후 60초 안에 **단일 도네 20,000원 이상** 1건당 리롤권 1개 누적 |
| 리롤 결과 | 직전 당첨 메뉴도 포함해 다시 스핀, **마지막 리롤 결과가 최종** |
| 기록 | 결과 확정 시 자동 저장(최근 20개), 기록 탭에서 확인 + JSON 내보내기/불러오기 |

리롤 비용·제한시간·칸당 금액 등은 ⚙ 설정에서 자유롭게 변경할 수 있다.
운영 편의: 도네 반영 일시정지 토글(⏸), 칸 조절 클릭 ±1 / Ctrl+클릭 ±10 / Alt+클릭 ±100, 테스트 도네이션.

## 치지직 연동 설정 (최초 1회)

브라우저 보안(CORS) 때문에 작은 무료 프록시가 하나 필요하다.

1. **프록시 배포** — [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create Worker → [`proxy/worker.js`](proxy/worker.js) 내용 붙여넣고 Deploy → `https://<이름>.<계정>.workers.dev` 주소 확보
2. **앱 등록** — [치지직 개발자센터](https://developers.chzzk.naver.com)에서 애플리케이션 등록
   - 로그인 리디렉션 URI: `https://goormigrm.github.io/mukbang-roulette/`
   - 발급된 **Client ID / Client Secret** 확보 (후원 조회 권한 필요)
3. **룰렛 설정** — 사이트 ⚙ 설정 → 치지직 연동에 Client ID·Secret·프록시 URL 입력 → **1) 치지직 로그인**(스트리머 계정) → **2) 연결**
4. 상단 배지가 **🟢 치지직 수신 중**이면 완료. 이후엔 접속만 하면 자동 연결된다.

Client ID/Secret과 토큰은 이 브라우저의 localStorage에만 저장된다 (서버 전송 없음, 프록시는 통과만).

## 개발

```bash
npm install
npm run dev     # http://localhost:5173/mukbang-roulette/
npm run build   # 타입체크 + dist/ 빌드
```

`main` 브랜치에 push하면 GitHub Actions가 자동으로 GitHub Pages에 배포한다.
설계 문서: [DESIGN.md](DESIGN.md)
