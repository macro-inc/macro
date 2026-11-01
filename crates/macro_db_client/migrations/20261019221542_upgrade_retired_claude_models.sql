-- Move routines and in-memory agents pinned to a retired Claude model onto the
-- current model of the same tier. Their model is frozen at creation and nothing
-- else rewrites it, so they keep calling the old model forever.
--
-- Only ids in Macro's own catalog space are touched: routines that run on the
-- Macro runtime, and agent configs whose harness is the in-memory one. Cursor,
-- Codex, Claude Cloud and macrod agents keep their provider's model ids.
-- Agent sessions keep the model they actually ran on.

CREATE FUNCTION pg_temp.current_claude_model(model TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE substring(model FROM '^(?:anthropic/)?claude-(?:[0-9.-]+-)?(opus|sonnet|haiku)\M')
        WHEN 'opus' THEN 'anthropic/claude-opus-5-5'
        WHEN 'sonnet' THEN 'anthropic/claude-sonnet-5-5'
        WHEN 'haiku' THEN 'anthropic/claude-haiku-4-5'
    END
$$;

UPDATE scheduled_action AS routine
SET task = jsonb_set(routine.task, '{model}', to_jsonb(pg_temp.current_claude_model(routine.task->>'model'))),
    -- An editor holding the old revision then conflicts instead of saving the
    -- retired model back.
    configuration_revision = routine.configuration_revision + 1,
    updated_at = now()
WHERE pg_temp.current_claude_model(routine.task->>'model') IS DISTINCT FROM routine.task->>'model'
  AND pg_temp.current_claude_model(routine.task->>'model') IS NOT NULL
  AND (
      routine.task->'agent'->>'bot_id' IS NULL
      OR routine.task->'agent'->>'bot_id' = '00000000-0000-0000-0000-00000000a2a2'
      OR EXISTS (
          SELECT 1 FROM agent_configs AS config
          WHERE config.bot_id::TEXT = routine.task->'agent'->>'bot_id'
            AND config.harness IN ('in-memory', 'macro-inmem')
      )
  );

UPDATE agent_configs
SET default_model = pg_temp.current_claude_model(default_model),
    updated_at = now()
WHERE harness IN ('in-memory', 'macro-inmem')
  AND pg_temp.current_claude_model(default_model) IS NOT NULL
  AND pg_temp.current_claude_model(default_model) IS DISTINCT FROM default_model;

DROP FUNCTION pg_temp.current_claude_model(TEXT);
