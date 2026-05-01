-- ============================================
-- R2 Migration · Step 3 (Emergency): Rollback URL rewrite
-- ============================================
-- Restores `words` and `listening_questions` URL columns from the backup
-- tables created in 01-backup-urls.sql. Run this if 02-rewrite-urls.sql
-- corrupted live URLs or if R2 turned out to be unhealthy after cutover.
--
-- Prerequisites: words_backup_r2_migration and
-- listening_questions_backup_r2_migration must still exist.

BEGIN;

-- ── words ──
UPDATE words w
SET
  image_url = b.image_url,
  audio_url = b.audio_url,
  video_url = b.video_url
FROM words_backup_r2_migration b
WHERE w.id = b.id;

-- ── listening_questions ──
UPDATE listening_questions q
SET audio_url = b.audio_url
FROM listening_questions_backup_r2_migration b
WHERE q.id = b.id;

-- ── Verification: zero rows should still reference R2 if rollback worked. ──
SELECT 'words rows still on Supabase'        AS check, COUNT(*) AS rows FROM words              WHERE image_url LIKE '%rtaltczlzccupsuzemcj.supabase.co/storage%' OR audio_url LIKE '%rtaltczlzccupsuzemcj.supabase.co/storage%' OR video_url LIKE '%rtaltczlzccupsuzemcj.supabase.co/storage%'
UNION ALL
SELECT 'listening_questions rows still on Supabase', COUNT(*)        FROM listening_questions WHERE audio_url LIKE '%rtaltczlzccupsuzemcj.supabase.co/storage%';

COMMIT;

-- After confirming the bot is healthy on the rolled-back URLs, you may drop
-- the backup tables manually:
--   DROP TABLE words_backup_r2_migration;
--   DROP TABLE listening_questions_backup_r2_migration;
