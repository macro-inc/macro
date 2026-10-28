-- Team-shared channel labels: named groups of chat channels that every member
-- of the team sees and can manage. A channel belongs to at most one label.

CREATE TABLE channel_label
(
    id         uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    uuid                     NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    name       text                     NOT NULL,
    sort_order double precision         NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT channel_label_name_not_blank CHECK (length(btrim(name)) > 0)
);

-- One label per name within a team, case-insensitively.
CREATE UNIQUE INDEX channel_label_team_name_key ON channel_label (team_id, lower(name));
CREATE INDEX channel_label_team_id_sort_idx ON channel_label (team_id, sort_order);

ALTER TABLE comms_channels
    ADD COLUMN label_id uuid REFERENCES channel_label (id) ON DELETE SET NULL;

CREATE INDEX idx_comms_channels_label_id ON comms_channels (label_id)
    WHERE label_id IS NOT NULL;
