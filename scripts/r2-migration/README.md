# R2 Migration Runbook

Direct cutover from Supabase Storage (`word-cards` bucket) to Cloudflare R2.
Three safety nets: dry-run rclone, SQL backup tables, code-level rollback via
`git revert` of the merge commit.

## Prerequisites

- R2 bucket created in the Cloudflare dashboard (e.g. `verik-media`).
- R2 API token issued (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`).
- R2 public base URL chosen — either a custom domain (`https://media.verik.app`)
  or the default `https://pub-<hash>.r2.dev` URL. **No trailing slash.**
- Supabase Storage S3 access key issued (Supabase dashboard → Storage → S3
  access keys). Used only for the rclone copy.
- `rclone` installed locally (`brew install rclone` / `choco install rclone`).

## Migration order

### 1. Configure rclone

Copy `rclone.conf.example` to your rclone config location and fill in:

- `[supabase]` access key, secret, and region.
- `[r2]` account id (in `endpoint`), access key, and secret.

### 2. Dry-run the bulk copy

```sh
rclone sync supabase:word-cards r2:verik-media --progress --dry-run
```

Confirm the file count and total bytes look sane (cards/, audio/,
listening-audio/ subtrees). Replace `verik-media` with your actual `R2_BUCKET`
name everywhere it appears.

### 3. Real copy

```sh
rclone sync supabase:word-cards r2:verik-media --progress
```

### 4. Verify file counts match

```sh
rclone size supabase:word-cards
rclone size r2:verik-media
```

Object counts and bytes should match. If they don't, re-run `rclone sync` —
it's idempotent.

### 5. Back up URL columns

In the Supabase SQL editor, run:

```
scripts/r2-migration/01-backup-urls.sql
```

Confirm both `_backup_r2_migration` tables now exist and have the same row
counts as the live tables.

### 6. Prepare the rewrite script

In `scripts/r2-migration/02-rewrite-urls.sql`, find-replace **every**
occurrence of `R2_PUBLIC_BASE_URL_PLACEHOLDER` with your actual public base
URL (no trailing slash). Examples:

- `https://media.verik.app`
- `https://pub-abcdef0123456789.r2.dev`

### 7. Rewrite URLs

Run the prepared `02-rewrite-urls.sql` in the Supabase SQL editor.

The script ends with two verification blocks:

- "remaining" rows pointing at Supabase Storage → must be **0**.
- "on R2" rows pointing at the new base URL → should match the prior totals.

If anything looks off, run `ROLLBACK;` before the implicit `COMMIT;` lands.

### 8. Sample-check the live tables

```sql
SELECT id, image_url, audio_url FROM words
 WHERE image_url IS NOT NULL OR audio_url IS NOT NULL
 ORDER BY id LIMIT 5;

SELECT id, audio_url FROM listening_questions
 WHERE audio_url IS NOT NULL
 ORDER BY id LIMIT 5;
```

Open one of the URLs in a browser to confirm the asset loads from R2.

### 9. Set Railway env vars and deploy

Add to Railway → Variables (Production):

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL`

Then push the branch and merge the PR. Railway auto-deploys on merge to `main`.

### 10. Smoke-test in Telegram

As an admin, run:

- `/test_card 1` — should fetch a Day 1 word card image from R2.
- `/test_listening 1` — should play a listening question audio from R2.
- `/generate_tts 1` (only on a day with no TTS) — verifies the new R2 upload
  path actually writes to R2.

### 11. Rollback (only if needed)

If URL rewrites broke playback or R2 is unhealthy, run:

```
scripts/r2-migration/03-rollback-urls.sql
```

Then revert the merge commit on `main` (`git revert -m 1 <merge-sha>`) so the
bot uploads new content back to Supabase Storage.

## Notes

- `PutObject` is upsert by default, so existing key collisions are overwritten
  exactly as the old `.upload({ upsert: true })` calls did.
- Telegram caches photos and audio by URL. The host change (Supabase → R2)
  forces a fresh fetch the first time each card is sent — expected and
  desired. Existing image URLs already carry a `?t=<timestamp>` cache-buster.
- Don't drop the `_backup_r2_migration` tables until at least one full week
  of healthy traffic on R2.
