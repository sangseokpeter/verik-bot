-- Add start_date column to students table (if not exists)
-- Each student's Day is calculated as: today - start_date + 1

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'students' AND column_name = 'start_date'
  ) THEN
    ALTER TABLE students ADD COLUMN start_date DATE DEFAULT CURRENT_DATE;
  END IF;
END $$;

-- Backfill existing students: set start_date so that current_day stays consistent
-- Formula: start_date = today - (current_day - 1)
UPDATE students
SET start_date = CURRENT_DATE - (current_day - 1)::int
WHERE start_date IS NULL OR start_date = CURRENT_DATE;
