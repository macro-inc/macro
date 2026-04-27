CREATE TABLE IF NOT EXISTS resolved_message_content (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "messageId" TEXT NOT NULL UNIQUE REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_resolved_message_content_message_id"
    ON resolved_message_content ("messageId");
