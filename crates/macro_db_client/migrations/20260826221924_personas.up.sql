-- Personas: user-configured agent identities, shown to users as "agents".
--
-- A persona is the configurable half of an agent: a name, handle, avatar,
-- description, and system prompt. The other half - the harness that runs
-- its sessions - is the in-memory agent for every persona in this iteration,
-- so no harness or model column exists yet; they arrive with the harness
-- selector.
--
-- Personas are NOT bots rows: `bots` holds owned API principals only
-- (see 20260826152838_system_bots_leave_the_bots_table), and first-party
-- agents are compile-time registry constants. Persona ids are still minted
-- in the BotId space, because everything a persona does downstream -
-- mentions (`bot|{id}`), `agent_session.bot_id`, trigger events - speaks
-- BotId, and `agent_session.bot_id` has carried no foreign key since the
-- system bots left the table.
CREATE TABLE personas (
    id            uuid PRIMARY KEY,
    -- The user who owns and edits the persona. Private to them this
    -- iteration; team sharing is a later column, not a later table.
    owner_user_id text NOT NULL REFERENCES "User" ("id") ON DELETE CASCADE,
    name          text NOT NULL,
    -- Typed after `@` to mention the persona. Derived from the name as
    -- lower kebab-case by clients; format and reserved-handle rules are
    -- enforced in the domain service, uniqueness per owner here.
    handle        text NOT NULL,
    description   text,
    avatar_url    text,
    -- Markdown instructions prepended to the persona's sessions. NULL means
    -- the persona adds nothing beyond the base agent prompt.
    system_prompt text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- Soft delete, matching `bots`: session rows keep referencing the id,
    -- so the identity must stay resolvable after deletion.
    deleted_at    timestamptz,

    CONSTRAINT personas_name_not_empty CHECK (name <> ''),
    CONSTRAINT personas_handle_not_empty CHECK (handle <> '')
);

-- A user's live personas are mentioned by handle, so the handle must be
-- unambiguous among them. Scoped to the owner: personas are private, and
-- two users choosing the same handle never collide in one mention menu.
-- Deleted personas free their handle.
CREATE UNIQUE INDEX personas_owner_handle_unique
    ON personas (owner_user_id, handle)
    WHERE deleted_at IS NULL;

-- The settings page lists "my agents"; sessions resolve personas by id.
CREATE INDEX personas_owner_idx ON personas (owner_user_id) WHERE deleted_at IS NULL;
