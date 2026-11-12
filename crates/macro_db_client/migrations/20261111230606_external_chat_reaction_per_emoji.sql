-- no-transaction
-- Some providers let a person add several emoji to one message; the key
-- gains the emoji. Built CONCURRENTLY, then swapped in as the primary key.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS external_chat_reaction_emoji_key ON external_chat_reaction(message_id, person_id, emoji);
