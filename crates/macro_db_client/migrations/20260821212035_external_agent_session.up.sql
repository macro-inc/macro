-- A session served by an external provider (today: Cursor cloud agents).
--
-- One row per externally-backed session, keyed by the session itself: a
-- session has at most one external backing, so the foreign key is the key.
-- This table is the only durable record of which provider-side agent a
-- session runs on — Cursor has no labels, so the mapping cannot be
-- reconstructed from their API after a restart.
CREATE TABLE external_agent_session (
    agent_session_id UUID PRIMARY KEY REFERENCES agent_session (id) ON DELETE CASCADE,
    provider         TEXT        NOT NULL,
    external_id      TEXT        NOT NULL,
    external_name    TEXT,
    external_url     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT external_agent_session_provider_not_empty CHECK (provider <> ''),
    CONSTRAINT external_agent_session_external_id_not_empty CHECK (external_id <> ''),
    -- Two sessions must never claim the same provider-side agent.
    CONSTRAINT external_agent_session_provider_external_unique UNIQUE (provider, external_id)
);

-- Seed the "Cursor" system bot (bot_id::CURSOR_BOT_ID). Mentioning it opens
-- an agent session served by a Cursor cloud agent instead of a Macro-managed
-- sandbox.
INSERT INTO bots (id, kind, name, handle, has_agent)
VALUES ('00000000-0000-0000-0000-00000000c5c5', 'system', 'Cursor', 'cursor', true)
ON CONFLICT (id) DO NOTHING;
