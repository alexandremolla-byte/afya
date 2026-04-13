-- Add report_token to profiles (unique shareable link token)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS report_token uuid DEFAULT gen_random_uuid();

-- Backfill existing rows that may have NULL
UPDATE profiles SET report_token = gen_random_uuid() WHERE report_token IS NULL;

-- Unique index so we can look up profiles by token
CREATE UNIQUE INDEX IF NOT EXISTS profiles_report_token_idx ON profiles(report_token);

-- Allow public read of report_token on own profile (authenticated users)
-- Service role already bypasses RLS so the get-report function can read freely
