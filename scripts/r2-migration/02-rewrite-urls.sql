-- ============================================
-- R2 Migration · Step 2: Rewrite Supabase Storage URLs → R2 URLs
-- ============================================
-- BEFORE RUNNING:
--   1. Confirm 01-backup-urls.sql has been executed (backup tables exist).
--   2. Find-replace EVERY occurrence of `R2_PUBLIC_BASE_URL_PLACEHOLDER` below
--      with your actual R2 public base URL (no trailing slash), e.g.
--         https://media.verik.app
--      or
--         https://pub-abcdef0123456789.r2.dev
--   3. Run inside the Supabase SQL editor.
--
-- The transaction will only commit if every UPDATE succeeds. Inspect the
-- "rows changed" output before deciding whether to keep the COMMIT.

BEGIN;

-- ── words.image_url ──
UPDATE words
SET image_url = REPLACE(
  image_url,
  'https://rtaltczlzccupsuzemcj.supabase.co/storage/v1/object/public/word-cards/',
  'R2_PUBLIC_BASE_URL_PLACEHOLDER/'
)
WHERE image_url LIKE 'https://rtaltczlzccupsuzemcj.supabase.co/storage/v1/object/public/word-cards/%';

-- ── words.audio_url ──
UPDATE words
SET audio_url = REPLACE(
  audio_url,
  'https://rtaltczlzccupsuzemcj.supabase.co/storage/v1/object/public/word-cards/',
  'R2_PUBLIC_BASE_URL_PLACEHOLDER/'
)
WHERE audio_url LIKE 'https://rtaltczlzccupsuzemcj.supabase.co/storage/v1/object/public/word-cards/%';

-- ── words.video_url ──
UPDATE words
SET video_url = REPLACE(
  video_url,
  'https://rtaltczlzccupsuzemcj.supabase.co/storage/v1/object/public/word-cards/',
  'R2_PUBLIC_BASE_URL_PLACEHOLDER/'
)
WHERE video_url LIKE 'https://rtaltczlzccupsuzemcj.supabase.co/storage/v1/object/public/word-cards/%';

-- ── listening_questions.audio_url ──
UPDATE listening_questions
SET audio_url = REPLACE(
  audio_url,
  'https://rtaltczlzccupsuzemcj.supabase.co/storage/v1/object/public/word-cards/',
  'R2_PUBLIC_BASE_URL_PLACEHOLDER/'
)
WHERE audio_url LIKE 'https://rtaltczlzccupsuzemcj.supabase.co/storage/v1/object/public/word-cards/%';

-- ── Verification: how many rows still point at Supabase Storage? Should be 0. ──
SELECT 'words.image_url remaining'         AS check, COUNT(*) AS rows FROM words              WHERE image_url LIKE '%rtaltczlzccupsuzemcj.supabase.co/storage%'
UNION ALL
SELECT 'words.audio_url remaining',                  COUNT(*)        FROM words              WHERE audio_url LIKE '%rtaltczlzccupsuzemcj.supabase.co/storage%'
UNION ALL
SELECT 'words.video_url remaining',                  COUNT(*)        FROM words              WHERE video_url LIKE '%rtaltczlzccupsuzemcj.supabase.co/storage%'
UNION ALL
SELECT 'listening_questions.audio_url remaining',    COUNT(*)        FROM listening_questions WHERE audio_url LIKE '%rtaltczlzccupsuzemcj.supabase.co/storage%';

-- ── Verification: how many rows now point at R2? ──
SELECT 'words.image_url on R2'         AS check, COUNT(*) AS rows FROM words              WHERE image_url LIKE 'R2_PUBLIC_BASE_URL_PLACEHOLDER/%'
UNION ALL
SELECT 'words.audio_url on R2',                  COUNT(*)        FROM words              WHERE audio_url LIKE 'R2_PUBLIC_BASE_URL_PLACEHOLDER/%'
UNION ALL
SELECT 'words.video_url on R2',                  COUNT(*)        FROM words              WHERE video_url LIKE 'R2_PUBLIC_BASE_URL_PLACEHOLDER/%'
UNION ALL
SELECT 'listening_questions.audio_url on R2',    COUNT(*)        FROM listening_questions WHERE audio_url LIKE 'R2_PUBLIC_BASE_URL_PLACEHOLDER/%';

COMMIT;
-- If any verification row above looks wrong, run `ROLLBACK;` instead of letting COMMIT execute.
