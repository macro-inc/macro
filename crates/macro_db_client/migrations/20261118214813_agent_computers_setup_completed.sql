-- An agent teammate's computer counts as set up once its agent is first
-- online; from now on hosted_runtimes records that when the agent reports.
-- Agents online before that never report a first online again, so their
-- computers take it here. hosted_runtime has one row per Macro computer and
-- team_agents one per agent teammate, so this touches few rows.

SET LOCAL lock_timeout = '5s';

UPDATE public.hosted_runtime computer
SET setup_completed_at = agent.first_online_at
FROM public.team_agents agent
WHERE computer.agent_user_id = agent.user_id
  AND computer.setup_completed_at IS NULL
  AND agent.first_online_at IS NOT NULL;
