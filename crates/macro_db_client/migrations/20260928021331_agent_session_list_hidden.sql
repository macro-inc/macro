-- Inline @macro sessions (a channel or document mention) stay out of the
-- agents list and search. Sessions created anywhere else stay listed, and
-- rows written before this column existed default to visible.
ALTER TABLE agent_session
    ADD COLUMN IF NOT EXISTS list_hidden BOOLEAN NOT NULL DEFAULT false;
