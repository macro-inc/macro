-- store the user's email signature content (HTML) per link
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS signature TEXT;
