-- ============================================
-- VERI-K Telegram Bot - Supabase DB Schema
-- 60일 한국어 학습 커리큘럼
-- ============================================

-- 1. 학생 테이블
CREATE TABLE students (
  id BIGINT PRIMARY KEY,              -- Telegram user ID
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  phone TEXT,
  current_day INT DEFAULT 1,          -- 현재 학습 일차 (1~58)
  start_date DATE DEFAULT CURRENT_DATE,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 단어 테이블 (58일분 전체 단어)
CREATE TABLE words (
  id SERIAL PRIMARY KEY,
  day_id TEXT NOT NULL,               -- 'D-01' ~ 'D-58'
  day_number INT NOT NULL,            -- 1 ~ 58
  lesson TEXT,                        -- '예비편(한글)', '1권-1과', etc.
  topic TEXT,                         -- '기본 모음/자음', etc.
  category TEXT,                      -- '명사', '동사', etc.
  korean TEXT NOT NULL,               -- 한국어 단어
  pronunciation TEXT,                 -- '[아이]'
  meaning_khmer TEXT NOT NULL,        -- 크메르어 뜻
  example_kr TEXT,                    -- 한국어 예문
  example_khmer TEXT,                 -- 크메르어 예문
  audio_url TEXT,                     -- TTS 음성 URL (Supabase Storage)
  image_url TEXT,                     -- 단어카드 이미지 URL
  sort_order INT DEFAULT 0           -- 같은 날 내 정렬 순서
);

CREATE INDEX idx_words_day ON words(day_number);

-- 3. 동영상 강의 테이블
CREATE TABLE videos (
  id SERIAL PRIMARY KEY,
  day_number INT NOT NULL,
  course TEXT NOT NULL,
  unit TEXT NOT NULL,
  sub_unit TEXT,
  youtube_url TEXT NOT NULL,
  sort_order INT DEFAULT 0
);

CREATE INDEX idx_videos_day ON videos(day_number);

-- 4. 퀴즈 세션 테이블
CREATE TABLE quiz_sessions (
  id SERIAL PRIMARY KEY,
  student_id BIGINT REFERENCES students(id),
  day_number INT NOT NULL,
  quiz_type TEXT NOT NULL,            -- 'daily', 'weekly', 'review'
  total_questions INT NOT NULL,
  correct_answers INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  is_completed BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_quiz_student ON quiz_sessions(student_id, day_number);

-- 5. 퀴즈 답변 상세 테이블
CREATE TABLE quiz_answers (
  id SERIAL PRIMARY KEY,
  session_id INT REFERENCES quiz_sessions(id),
  word_id INT REFERENCES words(id),
  student_answer TEXT,
  correct_answer TEXT,
  is_correct BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 틀린 단어 추적 (Spaced Repetition)
CREATE TABLE wrong_word_tracker (
  id SERIAL PRIMARY KEY,
  student_id BIGINT REFERENCES students(id),
  word_id INT REFERENCES words(id),
  wrong_count INT DEFAULT 1,
  consecutive_correct INT DEFAULT 0,
  last_wrong_at TIMESTAMPTZ DEFAULT NOW(),
  last_reviewed_at TIMESTAMPTZ,
  is_mastered BOOLEAN DEFAULT FALSE,  -- 3번 연속 맞히면 TRUE
  UNIQUE(student_id, word_id)
);

CREATE INDEX idx_wrong_student ON wrong_word_tracker(student_id, is_mastered);

-- 7. 듣기 문제 테이블
CREATE TABLE listening_questions (
  id SERIAL PRIMARY KEY,
  day_number INT NOT NULL,
  question_type TEXT NOT NULL,        -- 'daily', 'weekly'
  audio_url TEXT NOT NULL,
  transcript_kr TEXT NOT NULL,
  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_answer TEXT NOT NULL,       -- 'A', 'B', 'C', 'D'
  is_approved BOOLEAN DEFAULT FALSE,  -- Peter 검증 완료
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_listening_day ON listening_questions(day_number, is_approved);

-- 8. 듣기 답변 테이블
CREATE TABLE listening_answers (
  id SERIAL PRIMARY KEY,
  student_id BIGINT REFERENCES students(id),
  question_id INT REFERENCES listening_questions(id),
  student_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. 관리자 설정 테이블
CREATE TABLE admin_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO admin_config (key, value) VALUES
  ('admin_chat_id', ''),
  ('admin_group_id', ''),
  ('motivation_video_url', ''),
  ('timezone', 'Asia/Phnom_Penh'),
  ('bot_active', 'true');

-- 10. 공지사항 로그
CREATE TABLE announcements (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  sent_by BIGINT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  recipients_count INT DEFAULT 0
);

-- 11. 일일 활동 로그
CREATE TABLE daily_activity (
  id SERIAL PRIMARY KEY,
  student_id BIGINT REFERENCES students(id),
  activity_date DATE NOT NULL,
  words_received BOOLEAN DEFAULT FALSE,
  quiz_completed BOOLEAN DEFAULT FALSE,
  listening_completed BOOLEAN DEFAULT FALSE,
  UNIQUE(student_id, activity_date)
);

CREATE INDEX idx_activity_date ON daily_activity(student_id, activity_date);
