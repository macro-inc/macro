-- Multiple invitations remain valid independently until their expiration.
CREATE TABLE channel_invite_links (
    code UUID PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX channel_invite_links_channel_id_idx ON channel_invite_links(channel_id);
