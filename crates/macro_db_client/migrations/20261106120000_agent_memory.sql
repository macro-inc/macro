-- What a persona remembers across its sessions: one markdown document per agent,
-- shared by every session it runs, written by the agent when asked to remember
-- something and by whoever manages it in settings. `revision` guards each write
-- so concurrent sessions and editors never overwrite each other unseen.
CREATE TABLE agent_memory (
    bot_id uuid PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
    content text NOT NULL CHECK (octet_length(content) <= 16000),
    revision bigint NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
