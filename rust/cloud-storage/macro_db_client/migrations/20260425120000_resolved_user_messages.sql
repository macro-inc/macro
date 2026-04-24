CREATE TABLE "ResolvedUserMessage" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "messageId" TEXT NOT NULL UNIQUE REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_resolved_user_message_message_id"
    ON "ResolvedUserMessage" ("messageId");
