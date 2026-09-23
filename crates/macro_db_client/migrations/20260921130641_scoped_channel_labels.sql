-- Labels are either team-shared or account-private. Keep the legacy channel
-- column while replacing its global assignment with one assignment per scope.
ALTER TABLE channel_label
    ALTER COLUMN team_id DROP NOT NULL,
    ADD COLUMN user_id text REFERENCES "User" (id) ON DELETE CASCADE,
    ADD CONSTRAINT channel_label_scope_check CHECK ((team_id IS NULL) <> (user_id IS NULL)),
    ADD COLUMN scope_key text GENERATED ALWAYS AS (
        CASE WHEN team_id IS NOT NULL THEN 'team:' || team_id::text ELSE 'user:' || user_id END
    ) STORED,
    ADD CONSTRAINT channel_label_scope_id_key UNIQUE (scope_key, id);

CREATE UNIQUE INDEX channel_label_user_name_key ON channel_label (user_id, lower(name));
CREATE INDEX channel_label_scope_sort_idx ON channel_label (scope_key, sort_order);

CREATE TABLE channel_label_channel (
    scope_key text NOT NULL,
    channel_id uuid NOT NULL REFERENCES comms_channels (id) ON DELETE CASCADE,
    label_id uuid NOT NULL,
    PRIMARY KEY (scope_key, channel_id),
    FOREIGN KEY (scope_key, label_id) REFERENCES channel_label (scope_key, id) ON DELETE CASCADE
);
CREATE INDEX channel_label_channel_label_idx ON channel_label_channel (label_id);

INSERT INTO channel_label_channel (scope_key, channel_id, label_id)
SELECT l.scope_key, c.id, l.id
FROM comms_channels c JOIN channel_label l ON l.id = c.label_id
ON CONFLICT DO NOTHING;
