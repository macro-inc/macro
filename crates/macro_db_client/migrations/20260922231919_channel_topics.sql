-- Team topics, channel membership, and per-user topic preferences.
CREATE TABLE comms_channel_topics (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    sort_order DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, name)
);

CREATE TABLE comms_channel_topic_channels (
    topic_id UUID NOT NULL REFERENCES comms_channel_topics(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    added_by TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (topic_id, channel_id)
);

CREATE INDEX comms_channel_topic_channels_channel_id_idx
    ON comms_channel_topic_channels (channel_id);

CREATE TABLE comms_user_channel_topic_prefs (
    user_id TEXT NOT NULL,
    topic_id UUID NOT NULL REFERENCES comms_channel_topics(id) ON DELETE CASCADE,
    notif_level TEXT NOT NULL DEFAULT 'all'
        CHECK (notif_level IN ('all', 'mentions', 'none')),
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    subscribed BOOLEAN NOT NULL DEFAULT TRUE,
    sort_position DOUBLE PRECISION,
    collapsed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, topic_id)
);
