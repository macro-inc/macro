-- make the name column nullable
ALTER TABLE channels ALTER COLUMN name DROP NOT NULL;

-- add a check to ensure that:
-- 1. direct message channels do not have a name
-- 2. public channels have a name
ALTER TABLE channels ADD CONSTRAINT valid_channel_name CHECK (
    (channel_type = 'direct_message' AND name IS NULL) OR -- direct message channels do not have a name
    (channel_type IN ('public', 'organization') AND name is NOT NULL) OR -- public and organization channels have a name
    (channel_type = 'private') -- private channels have no restrictions
);

