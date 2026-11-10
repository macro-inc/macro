DROP TABLE password_account_lifecycle;
DROP INDEX password_write_intents_owner;
DROP INDEX password_item_entities_grants;
DROP INDEX password_item_entities_owner;
CREATE INDEX password_item_entities_owner ON password_item_entities(user_id,team_id) WHERE deleted_at IS NULL;
