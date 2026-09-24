ALTER TABLE agent_configs
    ADD COLUMN is_coding BOOLEAN NULL;

COMMENT ON COLUMN agent_configs.is_coding IS
    'Whether the agent works in a repository, which decides how a channel mention is answered: a coding agent posts a magic chip into the live session, a chat agent replies in the thread. NULL defers to the harness: in-memory chats, every other runtime codes.';
