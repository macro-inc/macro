-- Normalize Macro-bot mention ids to the canonical `bot|<uuid>` principal form.
--
-- Historically the frontend surfaced the Macro AI bot through the user-mention
-- typeahead with a bare UUID id (`00000000-0000-0000-0000-00000000a1a1`), so:
--   * persisted message content contains
--     `<m-user-mention>{"userId":"<bare uuid>", ...}</m-user-mention>`, and
--   * `comms_entity_mentions` rows tagged `bot` carry a bare UUID `entity_id`.
--
-- The strict mention parser rejects bare UUIDs, which made these messages fail
-- search indexing (see PR #4410). The producer now always emits `bot|<uuid>`;
-- this migration backfills the historical rows to match.
--
-- NOTE: after this migration is deployed, previously DLQ'd / unindexed channel
-- messages still need a reindex via
-- `POST /internal/backfill/channels` on search_processing_service.

-- 1. Rewrite bare-UUID Macro mention ids inside persisted message content.
--    Only the Macro AI bot was ever produced with a bare UUID (channel bots
--    already used `bot|<uuid>` participant ids), so the rewrite is scoped to
--    its constant id. Whitespace around the JSON colon is tolerated and the
--    match is case-insensitive; already-normalized `bot|<uuid>` ids do not
--    match the pattern, so the statement is idempotent.
UPDATE comms_messages
SET content = regexp_replace(
    content,
    '"userId"[[:space:]]*:[[:space:]]*"(00000000-0000-0000-0000-00000000a1a1)"',
    '"userId":"bot|\1"',
    'gi'
)
WHERE content ILIKE '%"userId"%00000000-0000-0000-0000-00000000a1a1%';

-- 2. Normalize `bot`-tagged mention rows that carry a bare UUID entity id.
--    These rows are read back (e.g. for search indexing) and must use the
--    same canonical form as newly produced mentions.
UPDATE comms_entity_mentions
SET entity_id = 'bot|' || entity_id
WHERE entity_type = 'bot'
  AND entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 3. Retag legacy `user`-tagged Macro mention rows (from clients that predate
--    the bot re-tagging at send time). A bare Macro UUID is never a real user
--    id, so these rows can only be Macro bot mentions.
UPDATE comms_entity_mentions
SET entity_type = 'bot',
    entity_id   = 'bot|' || entity_id
WHERE entity_type = 'user'
  AND lower(entity_id) = '00000000-0000-0000-0000-00000000a1a1';
