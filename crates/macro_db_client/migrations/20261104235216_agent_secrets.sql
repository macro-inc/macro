-- Secrets a team agent keeps for itself (third-party tokens and the like),
-- each KMS-encrypted under an encryption context binding the agent and the
-- secret's name. Deleting the agent's account deletes its secrets.
CREATE TABLE agent_secrets (
    agent_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    ciphertext BYTEA NOT NULL,
    encryption_version SMALLINT NOT NULL,
    kms_key_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_user_id, name)
);
