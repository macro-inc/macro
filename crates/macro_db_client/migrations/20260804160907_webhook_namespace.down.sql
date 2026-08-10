DROP INDEX webhook_workspace_namespace_uq;

ALTER TABLE webhook DROP COLUMN namespace;
