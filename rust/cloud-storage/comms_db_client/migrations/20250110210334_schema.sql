-- stupid but necessary to make the migration work
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_type') THEN
        CREATE TYPE channel_type AS ENUM ('public', 'organization', 'private', 'direct_message');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'participant_role') THEN
        CREATE TYPE participant_role AS ENUM ('owner', 'admin', 'member');
    END IF;
END
$$;

-- Channels table
CREATE TABLE IF NOT EXISTS channels (
    id UUID PRIMARY KEY NOT NULL,
    name VARCHAR(255),
    channel_type channel_type NOT NULL,
    org_id BIGINT, -- Only used for organization type
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    owner_id TEXT NOT NULL,
    CONSTRAINT valid_org_channel CHECK (
        (channel_type = 'organization' AND org_id IS NOT NULL) OR
        (channel_type != 'organization' AND org_id IS NULL)
    )
);

-- Channel participants table
CREATE TABLE IF NOT EXISTS channel_participants (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role participant_role NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    left_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (channel_id, user_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY NOT NULL,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    thread_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMP DEFAULT NULL,
    deleted_at TIMESTAMP DEFAULT NULL
);

-- Attachments table
CREATE TABLE IF NOT EXISTS attachments (
    id UUID PRIMARY KEY NOT NULL,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Message mentions table
CREATE TABLE IF NOT EXISTS message_mentions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);

-- Reactions table (updated schema)
CREATE TABLE IF NOT EXISTS reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    emoji VARCHAR(32) NOT NULL,
    user_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, emoji, user_id)
);

-- Activity table
CREATE TABLE IF NOT EXISTS activity (
    id UUID PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    channel_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    viewed_at TIMESTAMP,
    interacted_at TIMESTAMP,
    CONSTRAINT unique_user_channel UNIQUE (user_id, channel_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_channels_org_id ON channels(org_id) WHERE channel_type = 'organization';
CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel_timeline ON messages(channel_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_activity_user_times ON activity(user_id, updated_at ASC, created_at ASC);
