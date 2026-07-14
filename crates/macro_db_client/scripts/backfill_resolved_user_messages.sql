-- Backfill ResolvedUserMessage for existing user messages.
--
-- For each user message that does not yet have a resolved counterpart,
-- insert a single text part containing the message content.
--
-- Usage:
--   psql $DATABASE_URL -f backfill_resolved_user_messages.sql

INSERT INTO "ResolvedUserMessage" ("messageId", "content")
SELECT
    cm."id",
    CASE
        -- ChatMessageContent::Text is stored as a JSON string directly
        WHEN jsonb_typeof(cm."content") = 'string' THEN
            jsonb_build_array(jsonb_build_object(
                'type', 'text',
                'content', cm."content" #>> '{}'
            ))
        -- ChatMessageContent::Text is stored as {"Text": "..."}  (tagged enum)
        WHEN cm."content" ? 'Text' THEN
            jsonb_build_array(jsonb_build_object(
                'type', 'text',
                'content', cm."content" ->> 'Text'
            ))
        -- Fallback: stringify whatever is there
        ELSE
            jsonb_build_array(jsonb_build_object(
                'type', 'text',
                'content', cm."content"::text
            ))
    END
FROM "ChatMessage" cm
WHERE cm."role" = 'user'
  AND NOT EXISTS (
      SELECT 1 FROM "ResolvedUserMessage" rum WHERE rum."messageId" = cm."id"
  );
