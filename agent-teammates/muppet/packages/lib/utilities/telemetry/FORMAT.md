# Wake telemetry: the format

Every muppet system that opts in records each agent invocation (a "wake") as
the same record, defined in `record.ts`. A sink writes it somewhere:
`jsonlSink` as it is (one JSON object a line), `otlpSink` as OpenTelemetry.
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

## As OpenTelemetry

`otlpSink` hands each record to OpenTelemetry's own SDK
(`@opentelemetry/sdk-logs`, `@opentelemetry/sdk-trace`), which batches them
and sends them with its OTLP/HTTP exporters: every record as a log record
(`/v1/logs`), and each ended wake as one span (`/v1/traces`) carrying the
trace and span ids the record already has. The sink never throws and is
never waited on; for a collector that is down the SDK keeps up to 500
records while it retries, then drops them.

Resource: `service.name` = the system, `service.namespace` = `muppet`. Scope:
`muppet.telemetry`. Log records: event name `muppet.wake.start|session|end`,
severity INFO, or ERROR for a failed or timed-out wake (WARN if cancelled),
the trace and span ids of the wake. Span: `invoke_agent {system}`, kind
INTERNAL, from `startedAt` to `endedAt`, status ERROR unless the wake was ok,
under `parentSpanId` when the wake has a parent.

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

## Parents

`wake.env()` gives `MUPPET_WAKE_ID`, `MUPPET_SYSTEM` and a W3C `TRACEPARENT`
to start a job or another agent with; `parentFromEnv(process.env)` reads them
back in the system that job runs, so its wakes are children in the same
trace.
