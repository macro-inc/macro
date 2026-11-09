-- Ideas: each person's feed of proactive suggestions, written and managed by
-- hidden generation sessions through tools. An idea is one of three kinds,
-- fixed for its life: a prompt to run, a note about specific items, or a
-- pointer to a routine suggestion. The base row holds what the feed sorts,
-- filters and shows; each kind keeps its own data in a child table.

-- A run of hidden suggestion sessions for one person: at onboarding, or
-- nightly. Shared by ideas and routine suggestions.
CREATE TABLE suggestion_generation (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    trigger text NOT NULL CHECK (trigger IN ('onboarding', 'nightly')),
    status text NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
    started_at timestamptz NOT NULL,
    finished_at timestamptz
);

CREATE INDEX suggestion_generation_user_idx ON suggestion_generation (user_id, started_at DESC);

-- A person has one onboarding generation, and at most one running.
CREATE UNIQUE INDEX suggestion_generation_onboarding_idx ON suggestion_generation (user_id)
    WHERE trigger = 'onboarding';
CREATE UNIQUE INDEX suggestion_generation_running_idx ON suggestion_generation (user_id)
    WHERE status = 'generating';

-- A hidden session of a generation, writing ideas or routine suggestions.
-- Only a session with an open row may call that kind's tools; the row is
-- closed when the session is stopped, and the sweep deletes the sessions of
-- rows left open by a process that stopped.
CREATE TABLE suggestion_generation_session (
    session_id uuid PRIMARY KEY,
    generation_id uuid NOT NULL REFERENCES suggestion_generation (id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    agent_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('ideas', 'routines')),
    -- The surfaces a routines session suggests for; empty for ideas.
    surfaces text[] NOT NULL DEFAULT '{}',
    opened_at timestamptz NOT NULL,
    closed_at timestamptz
);

CREATE INDEX suggestion_generation_session_generation_idx
    ON suggestion_generation_session (generation_id);
CREATE INDEX suggestion_generation_session_open_idx ON suggestion_generation_session (opened_at)
    WHERE closed_at IS NULL;

-- One idea. `dedup_key` names it across nights: a session proposing the same
-- key again updates this row. `state` is the person's lifecycle; `retired`
-- is set by a session when the idea no longer matters, and a retired idea
-- proposed again comes back.
CREATE TABLE idea (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('prompt', 'entity', 'routine')),
    dedup_key text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    importance smallint NOT NULL CHECK (importance BETWEEN 0 AND 100),
    categories text[] NOT NULL DEFAULT '{}'
        CHECK (categories <@ ARRAY['important', 'revisit', 'save_money', 'make_money']),
    state text NOT NULL DEFAULT 'proposed'
        CHECK (state IN ('proposed', 'accepted', 'done', 'dismissed', 'resolved', 'retired')),
    -- Why it was resolved: replied, deleted or access_lost.
    state_reason text CHECK ((state = 'resolved') = (state_reason IS NOT NULL)),
    -- The generation session that proposed or last changed it.
    session_id uuid NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    state_changed_at timestamptz NOT NULL,
    UNIQUE (id, kind),
    UNIQUE (user_id, dedup_key)
);

CREATE INDEX idea_feed_idx ON idea (user_id, state, importance DESC);

-- One child per kind. The (idea_id, kind) key lets a child attach only to a
-- base row of its own kind.
CREATE TABLE idea_prompt (
    idea_id uuid PRIMARY KEY,
    kind text NOT NULL DEFAULT 'prompt' CHECK (kind = 'prompt'),
    prompt text NOT NULL,
    run_mode text NOT NULL CHECK (run_mode IN ('composer', 'background')),
    FOREIGN KEY (idea_id, kind) REFERENCES idea (id, kind) ON DELETE CASCADE
);

CREATE TABLE idea_entity (
    idea_id uuid PRIMARY KEY,
    kind text NOT NULL DEFAULT 'entity' CHECK (kind = 'entity'),
    action text NOT NULL CHECK (action IN ('reply', 'review', 'follow_up')),
    FOREIGN KEY (idea_id, kind) REFERENCES idea (id, kind) ON DELETE CASCADE
);

-- Deleting the suggestion deletes its idea.
CREATE TABLE idea_routine (
    idea_id uuid PRIMARY KEY,
    kind text NOT NULL DEFAULT 'routine' CHECK (kind = 'routine'),
    routine_suggestion_id uuid NOT NULL UNIQUE REFERENCES routine_suggestion (id) ON DELETE CASCADE,
    FOREIGN KEY (idea_id, kind) REFERENCES idea (id, kind) ON DELETE CASCADE
);

-- The items an idea is about, what a run of it produced, and the draft it
-- made. Indexed by item, so an event about one finds its ideas.
CREATE TABLE idea_target (
    idea_id uuid NOT NULL REFERENCES idea (id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('about', 'produced', 'draft')),
    position smallint NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    -- A part of the item, such as one message in a thread.
    part_id text,
    PRIMARY KEY (idea_id, role, position)
);

CREATE INDEX idea_target_entity_idx ON idea_target (entity_type, entity_id);

-- Every change a generation session made to an idea or a routine suggestion,
-- for us, never shown to the person: what, how, the values before and after,
-- and the session's reason.
CREATE TABLE suggestion_change (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    generation_id uuid NOT NULL REFERENCES suggestion_generation (id) ON DELETE CASCADE,
    session_id uuid NOT NULL,
    subject text NOT NULL CHECK (subject IN ('idea', 'routine_suggestion')),
    subject_id uuid NOT NULL,
    action text NOT NULL CHECK (action IN ('created', 'rewritten', 'retired', 'restored')),
    old_value jsonb,
    new_value jsonb,
    reason text,
    created_at timestamptz NOT NULL
);

CREATE INDEX suggestion_change_generation_idx ON suggestion_change (generation_id, action);
CREATE INDEX suggestion_change_subject_idx ON suggestion_change (subject_id, created_at);
