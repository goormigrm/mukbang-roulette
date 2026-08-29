# HANDOVER — 철면수심 먹방 룰렛

> 다음 세션(사람/AI 누구든)이 이 문서만 읽고 이어서 작업할 수 있도록 남기는 인수인계 문서.
> 마지막 업데이트: **2026-08-30** · 상태: **개발 완료, 배포·실연동 성공, 방송 실전 투입 전**

## 1. 한눈에 보기

| 항목 | 값 |
|---|---|
| 라이브 | https://goormigrm.github.io/mukbang-roulette/ |
| 저장소 | https://github.com/goormigrm/mukbang-roulette (main push → Actions 자동 배포) |
| 프록시 워커 | https://mukbang-proxy.1117tkdrms.workers.dev (Cloudflare, 계정 1117tkdrms) |
| 치지직 앱 | 개발자센터 "먹방룰렛" · Client ID `95337781-0490-4c9b-ac9a-9577a9ef4db0` · 스코프: 유저 조회, 후원 조회 |
| 스택 | Vite + Vanilla TS + Canvas 2D, socket.io-client **v2.5.0 고정**(치지직 세션이 Socket.IO 2.0.3까지만 지원) |
| 상세 설계 | [DESIGN.md](DESIGN.md) — 모든 규칙 결정 사항과 변경 이력 포함 |

**연동 검증 상태**: 개발자 본인 계정으로 OAuth 로그인 → 🟢 치지직 수신 중 배지까지 확인됨.
**아직 안 한 것**: 실제 도네이션 수신 테스트(방송 켜고 소액 도네), 철면수심 계정 로그인, OBS 캡처 리허설.

## 2. 확정된 운영 규칙 (전부 구현·테스트 완료)

- 도네 1,000원 = 1칸, 메시지가 메뉴명(비면 "닉네임의 추천"), 같은 이름은 칸 합산. 최소 1,000원, 상한 없음, 영상도네 제외.
- 스핀: [돌리기] → 계속 회전 → [🛑 정지!] 누르는 순간 가중치 추첨 확정 → 5.5~8초 감속(두구두구 드럼롤) → 당첨 도장 연출.
- 당첨 후(decision): [🔔 리롤 도네 받기(금액 입력)] / [🔁 다시 돌리기(공짜, 기록 안 남음)] / [✅ 결과 확정] 중 스트리머가 선택. 자동 진행 없음.
- 리롤 접수: 버튼 클릭 시 **이번 회차 금액 입력**(기본 직전 금액, 확정 시 설정값 2만원 복귀 — 2만→4만→10만 에스컬레이션용). 제한시간 기본 60초.
- 리롤권: 접수 중 **단일 도네 ≥ 회차 금액** 1건당 1개 누적(합산 불인정). 마감돼도 자동 확정 안 되고, **확정 전 지각 도착분도 인정**(연동 지연 대비). 마지막 리롤이 최종. 확정 시 잔여 리롤권 소멸. 당첨 메뉴는 룰렛에 유지.
- 기록: [✅ 확정] 시에만 라운드 저장(최근 20개, localStorage), 기록 탭 + JSON 내보내기/불러오기.
- 운영: 도네 반영 ⏸ 일시정지 토글(리롤 판정은 계속 동작), 칸 조절 클릭±1/Ctrl±10/Alt±100, 총 칸수 비노출(매출 노출 방지), 전체 비우기는 설정 탭 위험구역, 메뉴 JSON 내보내기/불러오기(예시 50종: `public/sample-menus.json`).
- 효과음: 틱(감속 시 음정 상승)·드럼롤·팡파레·리롤 차임·카운트다운 째깍(마지막 10초 0.5초 간격 긴박 모드)·마감 공소리. 설정 탭에서 on/off.
- PC(1920×1080) 전용. 새로고침/재부팅해도 진행 중 룰렛·설정·기록 유지(localStorage).

## 3. 아키텍처 요약

```
[GitHub Pages 정적 SPA] ──REST──> [Cloudflare Worker 프록시] ──> openapi.chzzk.naver.com
        └──────────웹소켓(Socket.IO, 도네 실시간)──직접──> 치지직 세션 서버
```

- openapi.chzzk.naver.com은 **브라우저 CORS 차단**(실측) → REST(토큰/세션/구독)만 워커 경유. 웹소켓은 직접.
- Client Secret은 **워커 Secret 환경변수**(`CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`)에만 존재. 프론트/저장소에 없음.
- 프론트 프리셋: [src/config.ts](src/config.ts) (Client ID, 워커 URL). 스트리머는 아무 키도 입력 안 함 — [로그인]→공식 치지직에서 동의→[연결] 클릭 3번.
- 소스 구조: `src/state.ts`(상태 저장소+규칙 엔진+영속화 — 핵심), `roulette.ts`(Canvas 휠+스핀), `chzzk.ts`(OAuth/세션/구독/재연결), `sound.ts`(WebAudio 합성), `main.ts`(UI 와이어링), `config.ts`(프리셋), `proxy/worker.js`(+`wrangler.toml`).

## 4. 체인지로그 (2026-08-29, 커밋 순)

1. `b756527` docs: 설계 문서 (치지직 API 조사, 연동 3안 비교, 디자인 시스템)
2. `31149f6` feat: 룰렛 코어 + 규칙 엔진 + 리롤 + 기록/일시정지 + 철면수심 디자인(실제 로고/배경 에셋)
3. `0bb9417` feat: 치지직 연동 모듈 + CORS 프록시 + 리롤권 누적제 + Ctrl/Alt 칸 조절 + 파스텔 칸 색
4. `a47b377` ci: Pages 자동 배포 + README / `16d65f5` feat: 정지 버튼식 스핀 + 총 칸수 비노출
5. `aa55814` feat: 스트리머 무입력 연동(Secret→워커, config.ts 프리셋) / `d192f65`·`b093200` chore: Client ID·워커 URL 등록
6. `d7f923e` feat: 리롤 접수 수동 시작 + 설정 탭 노출(개발자 항목 UI 삭제) + 효과음 강화 + 푸터
7. `1cc9358` feat: 메뉴 JSON 입출력 + 예시 50종
8. `dc95dae` feat: 당첨 후 자유 [다시 돌리기]
9. `906a0b1` feat: 회차별 리롤 금액 입력 + 마감 후 지각 도네 인정
10. `7d779c2` feat: 카운트다운 째깍 사운드(마지막 10초 긴박 모드 + 공소리)

버그 픽스 이력: `[hidden]` CSS 무시 버그, 백그라운드 탭 rAF 정지(워치독 추가), **워커 Secret 개행 버그**(PowerShell 파이프가 `\n`을 붙여 INVALID_CLIENT 발생 → bash `printf '%s'`로 재등록해 해결).

### 2026-08-30 추가분

11. `06cae82` 룰렛 UI를 확장앱과 실측 비교 후 재구현(원색 12색 평면 원판, 허브 제거, 외부 상단 포인터 + **포인터 위 현재 항목 실시간 표시**, 라벨 이름만) + **리롤 타이머가 끝까지 흐르며 리롤권 누적**(armed 단계 제거) + **일시정지 중 리롤권 적립도 차단** + 스핀 틱 사운드 강화
12. `bc96c65`·이후 docs: `docs/공지글-모음.md` (게시판용 공지 상자, KMD26 형식)
13. `ced116f` 후보 목록에 **점유율 % (소수점 2자리)** 표시 + 헤더를 [치지직 로그인]/[치지직 로그아웃] 버튼으로 교체(설정 탭 연동 카드 삭제, 로그인 버튼은 토큰 있으면 재연결) + 효과음 마스터 게인 1.6배
14. `b9ff9d2` 리롤 대기 중 **룰렛 중앙 대형 카운트다운(10ms 단위)** — 마지막 10초 빨간 반전 + 요동 연출

## 5. 다음 할 일 (우선순위순)

1. **실도네 E2E**: 본인 방송 켜고 소액 도네 → 룰렛 반영 확인. (로그인한 계정의 채널 도네가 수신됨)
2. **철면수심 온보딩**: 형 컴퓨터 브라우저에서 사이트 접속 → 설정 탭 → 로그인/동의/연결. OBS 브라우저 캡처 리허설(효과음은 창 캡처 오디오 or 데스크톱 오디오).
3. (권장) Secret이 대화에 노출됐었음 → 개발자센터에서 **재발급** 후 `cd proxy && printf '%s' '<새Secret>' | npx wrangler secret put CHZZK_CLIENT_SECRET` (개행 금지 주의!)
4. (선택) `proxy/worker.js`의 `ALLOWED_ORIGINS`에 `https://goormigrm.github.io` 넣어 프록시 잠그기 → `npx wrangler deploy`
5. (미검증 리스크) 치지직 세션 웹소켓의 Origin 정책 — 실도네 테스트에서 함께 검증됨. 문제 시 chzzk.ts의 소켓 연결 부분 확인.

## 6. 개발 환경 메모 (이 PC 기준)

- Node 24.19.0을 winget으로 설치함. 기존 셸에는 PATH 미반영 → `$env:Path = "C:\Program Files\nodejs;$env:Path"` 선행 필요.
- 빌드/검사: `npm run build` (tsc --noEmit + vite build). 로컬 실행: `npm run dev` → http://localhost:5173/mukbang-roulette/
- wrangler는 이미 이 PC에서 Cloudflare 계정(1117tkdrms) 로그인됨. 워커 재배포: `cd proxy; npx wrangler deploy`
- git 커밋 메시지에 한글+특수문자 쓸 때 PowerShell here-string이 깨질 수 있음 → 메시지 파일 + `git commit -F` 사용.
- 브라우저 자동 테스트 팁: `window.__store`로 스토어 직접 접근 가능(디버그용). 파일을 수정하면 vite가 리로드해 메모리 상태(피드 등)가 초기화되므로 테스트는 수정 없이 한 번에. 개발용 브라우저 패널은 workers.dev fetch를 차단하니 프록시 테스트는 curl로.
