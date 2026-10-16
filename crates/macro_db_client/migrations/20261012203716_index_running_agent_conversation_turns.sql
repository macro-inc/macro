-- no-transaction
-- Every replica's recovery looks for turns left running by a replica that is
-- gone, oldest first, every ten seconds; without this index it reads every
-- turn ever answered.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_conversation_turns_running
    ON agent_conversation_turns (updated_at) WHERE state = 'running';
