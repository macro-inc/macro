# Agent effort capabilities

Effort belongs to a selected model in a particular harness. Native API support,
Claude Code support, and Cursor variants are different contracts. The UI reads
ACP `configOptions`, selecting category `thought_level` (legacy id fallback:
`reasoning_effort`). External ids and values are opaque; `ultra`, for example,
is not a native Macro effort level.

## Cursor

The authenticated Cursor catalog supplies concrete model variants. Discovery
uses the selected model's default variant; an active session uses its effective
variant. Only effort values with identical remaining parameters are shown.
Changing effort preserves those parameters and selects an actual catalog variant.
Automatic selection, missing reasoning parameters, or fewer than two compatible
values produce no effort control. No static provider effort list is used.

## In-memory

The engine's model catalog controls model availability. Native effort profiles
are defined in `crates/agent/src/model/reasoning_effort.rs`; adding a model to the
catalog does not guess its effort support from its name. Update the profile and
provider serialization tests when adding support.

| Routed model | Explicit effort values |
| --- | --- |
| anthropic/claude-sonnet-5, anthropic/claude-opus-5 | low, medium, high, xhigh, max |
| openai/gpt-5.5 | none, low, medium, high, xhigh |
| openai/gpt-5-mini | minimal, low, medium, high |
| Haiku and unknown models | No effort control |

Every supported profile also offers **Default**, meaning no session override.
It preserves Macro's existing adapter defaults (including low for GPT-5 mini).
It is distinct from OpenAI's explicit `none` and is never sent as a provider
value. Anthropic receives `output_config.effort`; OpenAI Responses receives
`reasoning.effort`. A compatible Chat Completions endpoint does not inherit
native OpenAI capabilities merely because its model name resembles GPT.
Thinking token budgets are not exposed as effort levels.

Sources checked September 21, 2026:
[Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort),
[GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5), and
[OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning).

## Session lifecycle

- POST /agent-capabilities/discover accepts a selected model for Cursor and
  in-memory. The existing /agent-models/load API remains available.
- External ACP runtimes do not advertise model-specific preflight capabilities.
- New/resumed sessions and setting changes return the complete configuration.
  Clients replace their previous options, including removing unsupported controls.
- In-memory rejects unsupported models and effort values. A model change resets
  an incompatible effort to Default. Replay restores confirmed snapshots only;
  failed or unanswered requests do not become session settings.

## Probe evidence and limits

Prompt-free local ACP probes initialized a session, switched advertised models,
set advertised effort values, and tried an invalid value. No inference request
was sent. Observed capabilities are version- and account-specific:

| Harness tested | Observations |
| --- | --- |
| Claude Code 2.1.278, claude-agent-acp 0.73.0 | Sonnet/Opus: default, low, medium, high, xhigh, max; switching to Haiku removes effort. Invalid value rejected. |
| Codex CLI 0.154, codex-acp 1.8.0 | GPT-5.5: low/medium/high/xhigh; GPT-5.6 Sol adds max/ultra. Initial Astra session omitted effort. Invalid value rejected. |
| OpenCode 1.18.23 | Tested Haiku 4.5 and Sonnet 4.5 advertised high/max; Opus 4.5 advertised low/medium/high. Initial model omitted effort. Subsequent probe startups failed. |
| Hermes 0.20.4 | Legacy model/mode metadata, no configOptions observed. |

Sixteen advertised effort changes were accepted with complete configuration
responses. These observations verify ACP advertisement and acceptance, not the
provider request made during inference. OpenClaw was unavailable. Cursor and
in-memory are covered by repository ACP adapter tests and provider serialization
tests; these are deterministic tests, not claims of live provider execution.

To reproduce the protocol check with an authenticated harness, launch its ACP
stdio command in an empty temporary directory; send `initialize`, `session/new`,
and `session/set_config_option` using the returned session id and advertised
config ids/values. Re-read the full `configOptions` after every model change.
Record harness and adapter versions. Never infer a native provider profile from
an external harness result.
