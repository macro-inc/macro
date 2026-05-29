ALTER TABLE "in_progress_user_link"
    ADD COLUMN IF NOT EXISTS "linked_email" TEXT;
