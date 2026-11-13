# Wake telemetry: the format

Every muppet system that opts in records each agent invocation (a "wake") as
the same record, defined in `record.ts`. A sink writes it somewhere:
`jsonlSink` as it is (one JSON object a line), `macroTelemetry` as OpenTelemetry,
`macroSink` to the agent account's wakes in Macro, with the wake's trace.
The record is the source of truth; everything else is a copy of it.

A wake is recorded up to three times, each time with all that is known so
far: `start` when it begins, `session` when its model session is first known,
`end` when it is over. The last record read for a wake id is the whole wake.

## The record

```jsonc
{
	"v": 1,
	"phase": "end", // start | session | end
	"system": "pr-factory",
	"wake": "9f1a…", // unique within the system
	"trace": { "traceId": "…32 hex", "spanId": "…16 hex", "parentSpanId": "…" },
	"parent": { "wake": "…", "system": "tod" }, // what started it, if anything
	"trigger": {
		"kind": "event", // schedule | message | event | job | manual
		"source": "ciFailures", // the event source, as the behavior names it
		"name": "nightly", // what within the source, when it has a name
		"ids": { "pr": "macro-inc/macro#10357" }, // pr, report, board_item, macro_message, schedule, …
		"summary": "CI failed on #10357"
	},
	"startedAt": "2026-11-11T09:00:00.000Z",
	"session": {
		"id": "8e9d…",
		"agent": "claude",
		"provider": "anthropic",
		"model": "claude-haiku-5-5"
	},
	"terminal": "t1h7", // Herdr terminal address or name
	// from here on, only on "end"
	"endedAt": "2026-11-11T09:01:30.500Z",
	"durationMs": 90500,
	"status": "ok", // ok | failed | timeout | cancelled
	"error": { "type": "timeout", "message": "timed out after 600000ms" },
	"outcome": {
		"name": "rerun_flake", // a declared outcome, or "unclassified"
		"source": "reported", // reported | observed | none
		"check": "confirmed", // confirmed | unverifiable | contradicted | not_reported
		"reported": "rerun_flake",
		"observed": "rerun_flake",
		"summary": "reran the flaky job"
	},
	"effects": [{ "kind": "ci_rerun", "id": "991", "url": "https://…" }],
	"usage": {
		"inputTokens": 1200,
		"outputTokens": 300,
		"costUsd": 0.25,
		"turns": 7
	}
}
```

## What came of it: the rule

No model classifies a wake. A system declares a closed set of outcomes, in
order of precedence; an outcome may name its evidence, the kinds of effect
any one of which shows it happened. The agent reports one outcome through its
typed `reportOutcome` function before it finishes (a script naming an outcome
outside the set doesn't type-check, and `telemetry.report` refuses it at run
time); the system records the effects it sees for itself (a PR opened, an
issue filed, a label added, a job's exit code). When the wake ends:

1. The agent reported an outcome whose evidence was seen: that outcome, check
   `confirmed`.
2. Otherwise, the effects are evidence of some outcome (the first declared,
   if several): that outcome, source `observed`; check `not_reported` if the
   agent said nothing, `contradicted` if it reported another. Effects are
   facts and a report is a claim.
3. Otherwise, the agent reported an outcome that declares no evidence: that
   outcome, check `unverifiable`.
4. Otherwise `unclassified`: nothing was reported (`not_reported`), or what
   was reported needs evidence that never appeared (`contradicted`).

`status` is how the wake ended and never changes the outcome. `reported`
always keeps what the agent said.

## As OpenTelemetry, through Macro's telemetry framework

muppet has no exporter of its own. `macroTelemetry` (`macro.ts`) records
wakes through `Telemetry` of `@macro-inc/observability`
(`packages/observability` in the Macro repository), which the agent sets up
once at its entrypoint, with `createNodeTracingProvider` from its `./node`
entry, and hands in. The framework does the encoding, batching and sending
(OTLP/HTTP), and nothing here waits on a collector or throws.

- A wake is one span, `invoke_agent {system}` (`invoke_workflow {system}`
  for work without a model), opened when the wake begins. The record takes
  its trace and span ids from that span, and `wake.env()` hands them on, so
  what a wake starts is a child of it. When the wake ends the span gets every
  attribute below, an error if the wake was not ok, and the record's end time.
- Every record is one log, written inside the span so that it carries its
  trace: info, or error for a failed or timed-out wake (warn if cancelled).
  Its body is one line a person reads, its attributes the ones below.
- Resource: `service.name` is the framework's `serviceName`, which must be
  the system; pass `resourceAttributes: { "service.namespace": "muppet" }`.
  The framework adds `deployment.environment`. The instrumentation scope is
  the framework's, `@macro-inc/observability`.

GenAI semantic conventions (open-telemetry/semantic-conventions-genai as of
2026-11-06, all in Development; this is their "invoke agent internal" span):

| Attribute                                                 | From                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `gen_ai.operation.name`                                   | always `invoke_agent`                                                  |
| `gen_ai.agent.name`                                       | `system`                                                               |
| `gen_ai.conversation.id`, `session.id`                    | `session.id` (the second is the name Claude Code's own telemetry uses) |
| `gen_ai.provider.name`                                    | `session.provider` (no longer asked for on this span, kept)            |
| `gen_ai.request.model`                                    | `session.model`                                                        |
| `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | `usage`                                                                |
| `error.type`, `error.message`                             | `error`                                                                |

Ours, for what the conventions have no name for:

| Attribute                                                                                         | From                     |
| ------------------------------------------------------------------------------------------------- | ------------------------ |
| `muppet.schema`                                                                                   | `v`                      |
| `muppet.system`, `muppet.wake.id`, `muppet.wake.phase`                                            |                          |
| `muppet.wake.parent.id`, `muppet.wake.parent.system`                                              | `parent`                 |
| `muppet.wake.started_at`, `muppet.wake.ended_at`, `muppet.wake.duration_ms`, `muppet.wake.status` |                          |
| `muppet.trigger.kind`, `.source`, `.name`, `.summary`                                             | `trigger`                |
| `muppet.trigger.id.<name>`                                                                        | each of `trigger.ids`    |
| `muppet.herdr.terminal`                                                                           | `terminal`               |
| `muppet.agent.kind`                                                                               | `session.agent`          |
| `muppet.outcome.name`, `.source`, `.check`, `.reported`, `.observed`, `.summary`                  | `outcome`                |
| `muppet.effects`                                                                                  | each effect as `kind:id` |
| `muppet.usage.cost_usd`, `muppet.usage.turns`                                                     | `usage`                  |

## To Macro, with the wake's trace

`macroSink` (`wakes.ts`) sends every record, unchanged, to the agent account
muppet runs as (`agent`, that account's Macro user id), and the wake's model
session as a trace. The library makes no requests: the agent hands in a
`WakeClient`: with `@macro-inc/sdk` once muppet's pinned version has
`User.recordWake` (a handle per wake is only handed out by recording it, and a
wake's trace always follows its first record):

```ts
const me = await macro.users.me();
const wakes = new Map<string, AgentWake>();
const client: WakeClient = {
	recordWake: async (record) => {
		wakes.set(record.wake, await me.recordWake(record));
	},
	uploadTrace: async (wake, trace) => {
		await wakes.get(wake)?.uploadTrace(trace);
	},
};
```

or, until then, a fetch with the agent's API key in `x-macro-user-api-key`
(see `wakes.ts`; `starter-agent`'s `behavior/agent/telemetry.ts` is a whole
one). A client that throws `WakesUnavailable` (a 404 for a record: wakes are
off for this account) stops the sink for the rest of the run.

- `POST /agents/{agent}/wakes`: the record, as above, at each phase.
- `PUT /agents/{agent}/wakes/{wake}/trace`: the trace, at most 10 MiB of
  JSON; each replaces the last. Sent from the `session` record on, every
  `intervalMs` (60 seconds) while it changed, and once more at `end`, with
  `live: false`; nothing after that.

No call is waited on longer than `timeoutMs` (10 seconds): past it, the
signal the client was handed aborts. A live upload still running at `end` is
waited on (again at most `timeoutMs`) before the final one, so it can't land
after it. Failures are dropped: a slow or down Macro costs records and traces,
never the wake or the other sinks. A trace is redacted with every credential's
value (`secrets`); if one can't be read, that upload is skipped.

### The trace

Built by `utilities/traces` from the session's transcript, which the agent
reads (`transcript(session)`, parsed JSON Lines) and the library only parses:
Claude Code's transcript or Codex's rollout, told apart by their lines.

```jsonc
{
	"v": 1,
	"source": "claude", // claude | codex
	"sessionId": "8e9d…",
	"startedAt": "2026-11-11T09:00:00.000Z", // the first transcript line's time
	"endedAt": "2026-11-11T09:01:30.000Z", // the last line's time
	"live": false, // still being written
	"model": "claude-opus-5-5",
	"title": "Fix failing test", // Claude Code's title for the session
	"costUsd": 0.42,
	"spans": [
		// what was said to the session: the prompt, a person typing, a hook's context
		{ "kind": "user", "at": "…", "text": "…" },
		// one model response
		{
			"kind": "turn",
			"index": 0,
			"at": "…",
			"end": "…",
			"model": "…",
			"text": "…",
			"thinking": "…",
			"tokens": {
				"input": 100,
				"output": 20,
				"cacheRead": 5000,
				"cacheWrite": 300
			}
		},
		// a tool call; `end` and `result` are absent while it runs
		{
			"kind": "tool",
			"id": "toolu_1",
			"turn": 0,
			"at": "…",
			"end": "…",
			"name": "Bash",
			"input": {},
			"result": "…",
			"error": false
		}
	]
}
```

- Redacted before it leaves: the agent's credential values exactly (8
  characters or more, longest first), then anything shaped like a credential
  (private keys; GitHub, Anthropic, OpenAI, Google, Slack and AWS tokens; JWTs;
  `Bearer`/`Basic` values; `password=`; env-style `STRIPE_KEY=…` assignments,
  `export` lines and `.env` dumps included; passwords and tokens in URL
  userinfo; secret URL parameters; one-time codes in prose; secret-looking
  JSON keys, in tool inputs and in text, except numeric token counts such as
  `max_tokens`). If a credential can't be read, the trace isn't sent.
- Each text is cut at 200,000 characters. A trace whose JSON is still over
  10 MiB loses tool results and thinking past 20,000, then 2,000 characters,
  then every text and tool input past 2,000, then its oldest spans (the
  prompt stays), replaced by a `user` span saying how many went. A cut says
  so in its text.

## Parents

`wake.env()` gives `MUPPET_WAKE_ID`, `MUPPET_SYSTEM` and a W3C `TRACEPARENT`
to start a job or another agent with; `parentFromEnv(process.env)` reads them
back in the system that job runs, so its wakes are children in the same
trace.
