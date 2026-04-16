CREATE TABLE IF NOT EXISTS mobile_welcome_email
(
    email      TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mobile_welcome_email_pkey PRIMARY KEY (email)
);
