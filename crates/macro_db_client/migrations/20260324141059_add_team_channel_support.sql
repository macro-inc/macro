-- Add team_id column with foreign key and cascade delete
ALTER TABLE comms_channels
    ADD COLUMN team_id uuid REFERENCES team(id) ON DELETE CASCADE;

-- Add constraint team_id required for 'team' channels, null otherwise
ALTER TABLE comms_channels
    ADD CONSTRAINT valid_team_channel CHECK (
        (channel_type = 'team' AND team_id IS NOT NULL)
        OR (channel_type <> 'team' AND team_id IS NULL)
    );

-- Update valid_channel_name to include 'team' channels requiring a name
ALTER TABLE comms_channels
    DROP CONSTRAINT valid_channel_name,
    ADD CONSTRAINT valid_channel_name CHECK (
        (channel_type = 'direct_message' AND name IS NULL)
        OR (channel_type = ANY (ARRAY [
            'public'::comms_channel_type,
            'organization'::comms_channel_type,
            'team'::comms_channel_type
        ]) AND name IS NOT NULL)
        OR (channel_type = 'private')
    );

-- Partial index: only indexes rows where team_id is not null
CREATE INDEX idx_comms_channels_team_id ON comms_channels(team_id)
    WHERE team_id IS NOT NULL;
