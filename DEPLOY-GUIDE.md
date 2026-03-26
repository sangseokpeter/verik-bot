# VERI-K Bot 배포 가이드

Peter가 해야 할 작업 목록입니다. 순서대로 따라하세요.

---

## 이미 완료된 것 ✅
- Supabase 프로젝트 생성 (verik-bot, Southeast Asia)
- Railway 계정 + GitHub 레포 연결
- GitHub 레포 생성 (sangseokpeter/verik-bot)

---

## Step 1: Supabase DB 테이블 생성 (5분)

1. Supabase 대시보드 열기: https://supabase.com/dashboard
2. 왼쪽 메뉴에서 **SQL Editor** 클릭
3. **New query** 클릭
4. `supabase-schema.sql` 파일 내용을 전부 복사 → 붙여넣기
5. **Run** 클릭
6. 같은 방법으로 `supabase-functions.sql` 실행
7. 같은 방법으로 `seed-words.sql` 실행 (단어 1,758개 삽입)
8. 같은 방법으로 `seed-videos.sql` 실행 (동영상 124개 삽입)

확인: 왼쪽 **Table Editor** → students, words, videos 테이블이 보이면 성공!

---

## Step 2: Telegram Bot Token 발급 (3분)

1. Telegram에서 @BotFather 검색 → 대화 시작
2. `/newbot` 입력
3. 봇 이름: `VERI-K Learning Bot`
4. 봇 username: `verik_learning_bot` (이미 사용 중이면 다른 이름)
5. BotFather가 주는 **Token**을 복사해두세요
   - 형태: `7123456789:AAHx...`

---

## Step 3: Peter의 Telegram Chat ID 확인 (1분)

1. Telegram에서 @userinfobot 검색 → 대화 시작
2. `/start` 입력
3. 표시되는 **Id** 숫자를 복사 (예: `123456789`)

---

## Step 4: GitHub 레포에 코드 업로드 (5분)

### 방법 A: GitHub 웹에서 직접 업로드
1. https://github.com/sangseokpeter/verik-bot 열기
2. **Add file** → **Upload files** 클릭
3. 다운로드 받은 verik-bot 폴더의 모든 파일을 드래그&드롭
   - 폴더 구조:
     ```
     package.json
     railway.toml
     .gitignore
     .env.example
     src/
       index.js
       config/supabase.js
       handlers/commands.js
       handlers/quiz.js
       handlers/wordcard.js
       handlers/admin.js
       services/scheduler.js
       services/monitoring.js
       services/review.js
     ```
4. **Commit changes** 클릭

### 방법 B: Git CLI (터미널 사용 가능한 경우)
```bash
cd verik-bot
git init
git remote add origin https://github.com/sangseokpeter/verik-bot.git
git add .
git commit -m "Initial VERI-K bot code"
git push -u origin main
```

---

## Step 5: Railway 환경변수 설정 (3분)

1. https://railway.app 대시보드 열기
2. verik-bot 프로젝트 클릭
3. **Variables** 탭 클릭
4. 아래 환경변수를 하나씩 추가:

| Variable | Value |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Step 2에서 받은 토큰 |
| `SUPABASE_URL` | `https://rtaltczlzccupsuzemcj.supabase.co` |
| `SUPABASE_SECRET_KEY` | Supabase API Keys에서 복사한 secret key |
| `ADMIN_IDS` | Step 3에서 확인한 Peter Chat ID |
| `OPENAI_API_KEY` | OpenAI API 키 (나중에 TTS 추가 시) |
| `ANTHROPIC_API_KEY` | Anthropic API 키 (나중에 자동 생성 시) |

5. 변수 추가 후 Railway가 자동 재배포합니다

---

## Step 6: 동작 확인 (2분)

1. Railway 대시보드에서 **Deployments** 탭 확인 → ✅ Success
2. Telegram에서 봇 검색 → `/start` 전송
3. 환영 메시지가 오면 성공!
4. `/quiz` 로 퀴즈 테스트
5. `/progress` 로 진도 확인

---

## Step 7: 관리자 설정 업데이트 (1분)

Supabase SQL Editor에서:
```sql
UPDATE admin_config SET value = 'Peter의_Chat_ID' WHERE key = 'admin_chat_id';
```

---

## 문제 해결

| 문제 | 해결 |
|------|------|
| Railway 배포 실패 | Deployments 탭에서 로그 확인 |
| 봇이 응답 안 함 | TELEGRAM_BOT_TOKEN 확인 |
| 단어가 안 나옴 | seed-words.sql 실행 여부 확인 |
| 퀴즈 오류 | SUPABASE_SECRET_KEY 확인 |

---

## 비용 요약

| 항목 | 월 비용 |
|------|---------|
| Railway | ~$5 |
| Supabase | $0 |
| Telegram | $0 |
| GitHub | $0 |
| Claude API (나중에) | ~$3 |
| OpenAI TTS (나중에) | ~$3 |
| **합계** | **~$11/월** |
