-- ============================================
-- R2 Migration · Step 1: Backup current Storage URLs
-- ============================================
-- Run this FIRST in the Supabase SQL editor, before 02-rewrite-urls.sql.
-- Creates two snapshot tables we can restore from if anything goes wrong.
-- Safe to re-run only after dropping the existing backup tables.

CREATE TABLE words_backup_r2_migration AS
SELECT id, image_url, audio_url, video_url
FROM words;

CREATE TABLE listening_questions_backup_r2_migration AS
SELECT id, audio_url
FROM listening_questions;

-- Sanity check: row counts should match the live tables.
SELECT 'words' AS table_name, COUNT(*) AS rows FROM words_backup_r2_migration
UNION ALL
SELECT 'listening_questions', COUNT(*) FROM listening_questions_backup_r2_migration;
