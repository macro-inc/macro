-- Whether the session's name was generated rather than chosen by a person.
-- Only generated names are retitled as a conversation develops; a name a
-- person typed is never replaced. A constant default adds the column without
-- rewriting the table, and code deployed before this change keeps working.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_session
    ADD COLUMN name_is_generated BOOLEAN NOT NULL DEFAULT false;
