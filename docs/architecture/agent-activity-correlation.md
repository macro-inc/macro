# Agent activity correlation

Each managed agent code-mode invocation creates a UUIDv7 `agent_correlation_id`.
`agent_correlations` maps it to the originating session. The credential issuer
checks the session's bound agent before inserting the mapping and signs the ID
into the short-lived SDK JWT. HTTP retries inside one invocation reuse that JWT
and ID. Separate invocations get separate IDs.

Managed MCP credentials carry signed `agent_session_id` provenance so code mode
can create the same mapping for macrod sessions. The MCP credential cache includes
the session. External MCP callers and ordinary SDK credentials omit correlation.
Neither claim grants access: the JWT's existing user and agent authorization is
unchanged.

Activity-producing HTTP services run the optional correlation extractor before
their handlers. A signed correlation requires a signed agent, an existing mapping,
and a session bound to that agent. Failures return descriptive 400, 404 or 403
responses; storage failures return 503. Session state is deliberately not checked.
Uncorrelated traffic does not query the mapping table. Unsigned correlation headers
are not accepted. Public read-only and asset services retain their existing auth;
they do not produce activity-history events.

The accepted ID lives in request-local async context, independent of trace
sampling. Event constructors copy it into the Kafka envelope. Spawned mutation
work explicitly captures context. Consumers restore it before producing activity.
Email scheduling and mailbox projection payloads persist attribution for delayed
work. Signed document grants carry it through Sync, whose editor batches retain
separate attribution per invocation. Editing-session debounce keys include it.

Activity materialization stores the nullable ID on the existing `activity_events`
row. This is attribution for the existing activity vocabulary, not a log of every
SDK read, failed request or network attempt. Existing rows are not backfilled.
Activity remains in entity histories; session deletion removes correlation
mappings but does not change those histories' retention.

`GET /agent-sessions/{session_id}/activity` checks session view permission and
returns the original recorded rows across its invocations. It does not apply
additional permissions for the affected entities. The optional
`agentCorrelationId` filter is always constrained to that session. `limit` is
1–100 (default 50); `beforeAt` and `beforeId` must be supplied together. Results
sort by event time and ID descending; `nextCursor` resumes even if a corrupt row
was skipped. Indexed correlation scans support this feed.

The SDK exposes `session.activity()` and
`session.invocations.byId(id).activity()` as lazy iterators. There is no UI in this
change. Correlation IDs also appear in backend tracing for log investigation;
durable history does not depend on observability retention or sampling.
