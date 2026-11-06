SET lock_timeout = '5s';

-- Older writers reserved the successor only in the Create effect. Bring those
-- reservations into the row before requiring row/effect generation equality.
UPDATE hosted_runtime AS runtime
SET enrollment_generation = pending.generation
FROM (
    SELECT computer_id, max((effect->>'generation')::BIGINT) AS generation
    FROM hosted_runtime_effect
    WHERE effect->>'effect' = 'create'
    GROUP BY computer_id
) AS pending
WHERE runtime.id = pending.computer_id
  AND runtime.enrollment_generation < pending.generation;
