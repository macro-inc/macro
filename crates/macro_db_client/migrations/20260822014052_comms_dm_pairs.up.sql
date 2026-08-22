CREATE TABLE comms_dm_pairs (
    user_lo    text NOT NULL,
    user_hi    text NOT NULL,
    channel_id uuid NOT NULL REFERENCES comms_channels (id) ON DELETE RESTRICT,
    PRIMARY KEY (user_lo, user_hi),
    UNIQUE (channel_id),
    CONSTRAINT comms_dm_pairs_ordered CHECK (user_lo < user_hi COLLATE "C")
);

INSERT INTO comms_dm_pairs (user_lo, user_hi, channel_id)
SELECT DISTINCT ON (least_id, greatest_id)
    least_id, greatest_id, channel_id
FROM (
    SELECT
        LEAST(a.user_id COLLATE "C", b.user_id COLLATE "C") AS least_id,
        GREATEST(a.user_id COLLATE "C", b.user_id COLLATE "C") AS greatest_id,
        c.id AS channel_id,
        c.created_at
    FROM comms_channels c
    JOIN comms_channel_participants a ON a.channel_id = c.id
    JOIN comms_channel_participants b ON b.channel_id = c.id AND a.user_id < b.user_id COLLATE "C"
    WHERE c.channel_type = 'direct_message'
      AND (SELECT COUNT(*) FROM comms_channel_participants p WHERE p.channel_id = c.id) = 2
) existing
ORDER BY least_id, greatest_id, created_at ASC, channel_id ASC
ON CONFLICT (user_lo, user_hi) DO NOTHING;
