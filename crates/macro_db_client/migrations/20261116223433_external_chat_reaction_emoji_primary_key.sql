-- The reaction key gains the emoji (index built in the previous migration).
SET lock_timeout = '5s';
ALTER TABLE external_chat_reaction
    DROP CONSTRAINT external_chat_reaction_pkey,
    ADD CONSTRAINT external_chat_reaction_pkey PRIMARY KEY USING INDEX external_chat_reaction_emoji_key;
