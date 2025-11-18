-- table for storing user settings for email
CREATE TABLE "email_settings"
(
    link_id      UUID NOT NULL PRIMARY KEY REFERENCES email_links (id) ON DELETE CASCADE,
    signature_on_replies_forwards BOOLEAN NOT NULL DEFAULT FALSE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

