-- GIN expression index over the GitHub PR participant id array so the
-- foreign-entity includes_me filter (`metadata -> 'participantGithubUserIds' ? $id`)
-- is indexable. Expression form (not whole-column GIN) because metadata embeds
-- full comment bodies and check runs; default jsonb_ops because the `?` operator
-- is not supported by jsonb_path_ops.
CREATE INDEX IF NOT EXISTS idx_foreign_entity_metadata_participant_github_user_ids
    ON foreign_entity
    USING GIN ((metadata -> 'participantGithubUserIds'));
