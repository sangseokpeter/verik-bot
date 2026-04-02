-- Add video_url column to words table (motion card MP4)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'words' AND column_name = 'video_url'
  ) THEN
    ALTER TABLE words ADD COLUMN video_url TEXT;
  END IF;
END $$;
