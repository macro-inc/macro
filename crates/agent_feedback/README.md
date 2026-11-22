# agent_feedback

Thumbs up or down, with an optional note, on agent responses, for internal
evals. People behind the `enable-agent-response-feedback` PostHog flag rate:

- an agent session's reply in one turn (`agent_session_turn`),
- an agent's message in a channel, DM, thread or discussion (`message`),
- one run of a routine (`routine_run`).

Each rating, change and retraction is one row of `agent_response_feedback`.
A person's current feedback on a response is their newest row for it; a row
with no rating is a retraction. The agent, harness and model are read on the
server when the row is written.

## Reading the ratings

### SQL, on the read replica

Current feedback per person and response in the last 30 days, with what
produced the response:

```sql
SET statement_timeout = '60s';
WITH latest AS (
  SELECT DISTINCT ON (user_id, subject_kind, subject_id, turn) *
  FROM agent_response_feedback
  WHERE created_at >= now() - interval '30 days'
  ORDER BY user_id, subject_kind, subject_id, turn, created_at DESC, id DESC
)
SELECT l.created_at AS rated_at, l.user_id, l.subject_kind, l.surface, l.rating, l.note,
       l.agent_session_id, l.turn, l.subject_id, l.container_id, l.message_parent_type,
       l.agent_kind, l.agent_bot_id, b.name AS agent_name, l.agent_user_id, l.harness, l.model,
       src.routine_id, l.trace_id,
       (SELECT array_agg(DISTINCT u.model) FROM ai_usage u
         WHERE u.agent_session_id = l.agent_session_id) AS models_billed
FROM latest l
LEFT JOIN bots b ON b.id = l.agent_bot_id
LEFT JOIN agent_session s ON s.id = l.agent_session_id
LEFT JOIN agent_session_source src ON src.id = s.source_id
WHERE l.rating IS NOT NULL;
```

- Only responses whose newest row is in the window are listed; drop the
  window for every current rating. Filtering before `DISTINCT ON` gives the
  same answer as filtering its result, and sorts only the window.
- `model` is the session's model when the rating was written; the session may
  have switched models between turns. `models_billed` lists every model the
  session was billed for (`ai_usage`, through its `agent_session_id` index).
- One person's history of one response:
  `SELECT * FROM agent_response_feedback WHERE user_id = $1 AND subject_id = $2 ORDER BY created_at, id;`

### The export endpoint

`GET /internal/agent-feedback/events` on the agent harness, with the internal
API key (`x-internal-auth-key`), returns every row (ratings, changes and
retractions) in `(createdAt, id)` order:

```sh
curl -H "x-internal-auth-key: $INTERNAL_API_KEY" \
  "$AGENT_HARNESS/internal/agent-feedback/events?limit=1000"
# then, while the page has a `next`:
curl -H "x-internal-auth-key: $INTERNAL_API_KEY" \
  "$AGENT_HARNESS/internal/agent-feedback/events?limit=1000&afterCreatedAt=<next.afterCreatedAt>&afterId=<next.afterId>"
```

`limit` is 1 to 1000 (500 by default). `next` is absent on the last page.
Fold rows to the current state the way the SQL above does: newest row per
`(userId, subjectKind, subjectId, turn)`.

### The rated content

Nothing here copies the response itself; read it live:

- Turns: `GET /agent-sessions/{agentSessionId}/log/folded` (internal key) and
  take the agent message with `turn`, or `just session-log`.
- Messages: `comms_messages.id = subject_id`.
- Runs: `action_execution_record.id = subject_id`.
- Traces: search Tempo or Datadog for `agent.session.id = <agentSessionId>`
  around the reply; the session's `invoke_agent` spans carry it. `trace_id` is
  the trace of the rating request itself.

A deleted session, message or run keeps its ratings; the lookups above then
find nothing.
