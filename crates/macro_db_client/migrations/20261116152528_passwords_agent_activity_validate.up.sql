-- Separate from the column/constraint change so validation takes only a
-- SHARE UPDATE EXCLUSIVE lock and does not block concurrent activity writes.
ALTER TABLE password_activity VALIDATE CONSTRAINT password_activity_action_check;
ALTER TABLE password_write_intents VALIDATE CONSTRAINT password_write_intents_agent_action_check;
ALTER TABLE password_write_intents VALIDATE CONSTRAINT password_write_intents_agent_identity_check;
