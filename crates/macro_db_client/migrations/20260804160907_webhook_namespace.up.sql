-- Add a caller-chosen namespace to webhooks, unique per owning workspace.
-- Existing rows receive a random UUID so the column can be NOT NULL.
ALTER TABLE webhook ADD COLUMN namespace TEXT;

UPDATE webhook SET namespace = gen_random_uuid()::text;

ALTER TABLE webhook ALTER COLUMN namespace SET NOT NULL;

-- Partial unique index: soft-deleted webhooks release their namespace for reuse.
CREATE UNIQUE INDEX webhook_workspace_namespace_uq
    ON webhook (workspace_id, namespace)
    WHERE deleted_at IS NULL;
