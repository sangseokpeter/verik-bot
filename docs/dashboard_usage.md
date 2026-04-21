# VERI-K Staff Dashboard — 운영 매뉴얼

Socheata 같은 직원이 폰에서 학생 학습 현황을 한눈에 보고, 학생에게 즉시 메시지를 보낼 수 있는 모바일 웹 대시보드.

## 1. URL 형식

```
https://<Railway 도메인>/dashboard/<STAFF_DASHBOARD_TOKEN>
```

예: `https://verik-bot-production.up.railway.app/dashboard/abc123xyz789`

- 토큰이 일치하지 않으면 `404 Not Found` — 라우트의 존재 자체가 드러나지 않음.
- 다른 모든 API 호출은 같은 토큰이 path에 포함돼 있어야 하며, 페이지의 JS가 자동으로 채움.

## 2. 토큰 생성

### 2.1 16자 랜덤 영숫자 생성

```bash
node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"
```

예: `N8mQr3bYxPd2vKsT`

### 2.2 Railway 환경변수 추가

Railway 대시보드 → 서비스 → **Variables** 탭 → **New Variable**

| Key | Value | 용도 |
|---|---|---|
| `STAFF_DASHBOARD_TOKEN` | 위에서 생성한 16자 | 대시보드 접근 토큰 |
| `ADMIN_LOG_CHAT_ID` | 예: `-1002383763959` | 대시보드발 메시지 로그 수신 채널 (옵션, 미설정 시 `ADMIN_IDS` + `ADMIN_GROUP_CHAT_ID` 전체에 fallback) |

저장하면 Railway가 자동 재배포.

## 3. 토큰 회전 (노출 시 즉시 무효화)

1. Railway Variables에서 `STAFF_DASHBOARD_TOKEN` 값을 새 랜덤 문자열로 변경 → 저장.
2. 자동 재배포 후 기존 URL은 즉시 404.
3. 새 URL을 Socheata에게 재전달.

**코드 수정·커밋 불필요** — 환경변수 1줄만 바꾸면 됨.

## 4. 직원에게 URL 전달 (Socheata)

1. 텔레그램 DM으로 대시보드 URL 1회 전송.
2. 폰에서 URL 접속 → 브라우저 메뉴 → **홈 화면에 추가** (iOS: 공유 → 홈 화면에 추가 / Android: 점 3개 → 홈 화면에 추가).
3. 홈 화면 아이콘 → 네이티브 앱처럼 실행.

## 5. 대시보드 기능

### 상단 KPI
- **오늘 활동** — 오늘 활동한 학생 수 / 전체
- **주간 평균 점수** — 최근 10개 퀴즈 세션 평균
- **관심 필요** — 1일 이상 미활동 학생 수
- **평균 진도** — 전체 평균 D-?/35

### 필터
- **전체 / 관심 / 저점수 / 우수**

상태 판정 기준:
- `active` — 오늘 활동
- `warning` — 1~2일 미활동
- `risk` — 3일 이상 미활동

태그 판정 기준:
- `top` — 최근 평균 80% 이상
- `low` — 최근 평균 60% 미만
- `attention` — `warning` 또는 `risk`

### 학생 카드
- 상태점(초록/주황/빨강) + 이름
- 진도 / 마지막 활동 / 연속 학습일(🔥)
- 최근 퀴즈 평균 점수
- 메시지 버튼:
  - 텔레그램 username 있음 → 파란 비행기 → `t.me/<username>` 새 탭 열기 (텔레그램 앱 딥링크)
  - username 없음 → 회색 말풍선 → 모달 입력 → 봇 API 로 직접 DM
- 카드 본문 탭 → 상세 모달 (최근 7일 퀴즈 / 자주 틀린 단어 Top 10)

### 하단 액션
- **미참여자 일괄 알림** — 2일 이상 미활동 학생 전원에게 동일 메시지
- **주간 리포트** — admin 텔레그램으로 요약 발송

## 6. 보안·안전장치

- 토큰 mismatch → 404 (시간 상수 비교로 타이밍 공격 차단)
- Railway 기본 HTTPS 강제
- `send_message` / `broadcast_inactive`는 분당 10회 rate limit
- 모든 `send_message` / `broadcast_inactive` / `weekly_report` 호출은 `ADMIN_LOG_CHAT_ID` (또는 fallback) 로그 채널에 `[Dashboard]` 접두사로 기록

## 7. 운영 체크리스트 (최초 배포 시)

- [ ] `STAFF_DASHBOARD_TOKEN` Railway Variables에 등록
- [ ] `ADMIN_LOG_CHAT_ID` 등록 (옵션, 전용 로그 채널 원할 때)
- [ ] Railway 재배포 완료 확인 (`🔐 Staff dashboard enabled` 로그)
- [ ] 본인 폰으로 URL 접속 → 학생 카드 표시 확인
- [ ] 본인 chat_id 대상으로 테스트 메시지 전송 → 수신 확인
- [ ] admin 로그 채널에 `[Dashboard] ... 에게 발송:` 메시지 기록 확인
- [ ] 토큰 한 글자 바꿔 접속 → 404 확인
- [ ] Socheata에게 URL 전달
