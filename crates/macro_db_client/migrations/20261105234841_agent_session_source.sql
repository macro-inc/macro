-- What opened an agent session, one row per session. Holds only references to users and
-- entities, none of them foreign keys: the record must outlive the message, routine or
-- session it names. A session's delete removes its source in the same transaction.
SET LOCAL lock_timeout = '5s';

CREATE TABLE agent_session_source (
    id                   UUID PRIMARY KEY,
    kind                 TEXT NOT NULL,
    -- Who acted: a person, or an agent acting for a person.
    actor_user_id        TEXT,
    actor_bot_id         UUID,
    on_behalf_of_user_id TEXT,
    -- The session the acting agent ran in, and the first non-agent cause of its work.
    acting_session_id    UUID,
    root_user_id         TEXT,
    root_routine_id      UUID,
    -- What it is about.
    message_id           UUID,
    task_id              TEXT,
    project_id           UUID,
    routine_id           UUID,
    routine_firing       TEXT,
    event_id             UUID,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT agent_session_source_kind_fields CHECK (
        CASE kind
            WHEN 'mentioned' THEN message_id IS NOT NULL
            WHEN 'conversation' THEN actor_user_id IS NOT NULL AND message_id IS NOT NULL
            WHEN 'task_assigned' THEN task_id IS NOT NULL
            WHEN 'project_inherited' THEN task_id IS NOT NULL AND project_id IS NOT NULL
            WHEN 'requested' THEN actor_user_id IS NOT NULL
            WHEN 'dispatched' THEN on_behalf_of_user_id IS NOT NULL
            WHEN 'routine' THEN routine_id IS NOT NULL AND routine_firing IS NOT NULL
            ELSE false
        END
    ),
    -- Mentions and assignments come from a person or from an agent acting for one.
    CONSTRAINT agent_session_source_actor CHECK (
        kind NOT IN ('mentioned', 'task_assigned', 'project_inherited')
        OR (actor_user_id IS NOT NULL AND actor_bot_id IS NULL AND on_behalf_of_user_id IS NULL)
        OR (actor_user_id IS NULL AND actor_bot_id IS NOT NULL AND on_behalf_of_user_id IS NOT NULL)
    ),
    -- A routine fires on its own; no one acted.
    CONSTRAINT agent_session_source_routine_has_no_actor CHECK (
        kind <> 'routine'
        OR (actor_user_id IS NULL AND actor_bot_id IS NULL AND on_behalf_of_user_id IS NULL)
    ),
    CONSTRAINT agent_session_source_routine_firing CHECK (
        routine_firing IS NULL OR routine_firing IN ('scheduled', 'manual', 'event')
    ),
    CONSTRAINT agent_session_source_event_only_when_fired_by_one CHECK (
        CASE routine_firing
            WHEN 'event' THEN event_id IS NOT NULL
            ELSE event_id IS NULL
        END
    ),
    -- A known acting session has exactly one root; an unknown one has none.
    CONSTRAINT agent_session_source_lineage CHECK (
        (acting_session_id IS NULL AND root_user_id IS NULL AND root_routine_id IS NULL)
        OR (
            acting_session_id IS NOT NULL
            AND actor_bot_id IS NOT NULL
            AND (root_user_id IS NULL) <> (root_routine_id IS NULL)
        )
    )
);

-- Null for sessions that predate this, unclaimed warm sessions, and sessions opened by a
-- runtime too old to report what opened them.
ALTER TABLE agent_session
    ADD COLUMN source_id UUID,
    ADD CONSTRAINT agent_session_source_id_fkey
    FOREIGN KEY (source_id) REFERENCES agent_session_source (id) NOT VALID;
