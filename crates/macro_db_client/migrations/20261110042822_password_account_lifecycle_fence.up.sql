-- Account deletion closes every vault admission before it discovers private
-- erasures or removes memberships. Keep the identity fence on retries.
CREATE TABLE password_account_lifecycle (
    account_id UUID PRIMARY KEY,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Account erasure must find acknowledged item fences as well as live records.
DROP INDEX password_item_entities_owner;
CREATE INDEX password_item_entities_owner ON password_item_entities(user_id,team_id);
CREATE INDEX password_write_intents_owner ON password_write_intents((record->>'user_id'),team_id);
CREATE INDEX password_item_entities_grants ON password_item_entities USING gin(grants) WHERE deleted_at IS NULL;
