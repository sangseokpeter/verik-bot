-- ============================================
-- Migration: Listening Questions Schema Update
-- Run this in Supabase Dashboard SQL Editor if needed
-- ============================================

-- Option A: If you want the NEW schema (book, unit, question_number, etc.)
-- Uncomment and run the DROP + CREATE below.
-- NOTE: This will lose any existing data in the table.

/*
DROP TABLE IF EXISTS listening_answers CASCADE;
DROP TABLE IF EXISTS listening_questions CASCADE;

CREATE TABLE listening_questions (
  id SERIAL PRIMARY KEY,
  book TEXT NOT NULL,                    -- 'sejong_1_practice', 'sejong_2_practice'
  unit INT NOT NULL,                     -- 1-12 (book1), 1-14 (book2)
  question_number INT NOT NULL,          -- sequential within unit
  audio_filename TEXT NOT NULL,          -- original filename
  audio_url TEXT,                        -- Supabase Storage public URL
  question_text TEXT NOT NULL,           -- question in Korean
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
  day_assignment INT NOT NULL CHECK (day_assignment BETWEEN 1 AND 33),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_listening_day ON listening_questions(day_assignment);
CREATE INDEX idx_listening_book_unit ON listening_questions(book, unit);

CREATE TABLE listening_answers (
  id SERIAL PRIMARY KEY,
  student_id BIGINT REFERENCES students(id),
  question_id INT REFERENCES listening_questions(id),
  student_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ DEFAULT NOW()
);
*/

-- ============================================
-- Option B: Current approach (uses existing schema)
-- The code maps to existing columns:
--   day_number      → day_assignment
--   question_type   → book name
--   transcript_kr   → JSON metadata {unit, question_number, audio_filename}
--   audio_url       → Supabase Storage URL
--   question_text   → question text
--   option_a/b/c/d  → 4 choices
--   correct_answer  → A/B/C/D
--   is_approved     → true (all approved)
-- ============================================

-- No changes needed for Option B.
-- The existing listening_questions table schema works as-is.
