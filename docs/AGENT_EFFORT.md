# Agent effort capabilities

Effort belongs to a selected model in a particular harness. Native API support,
Claude Code support, and Cursor variants are different contracts. The UI reads
ACP `configOptions`, selecting category `thought_level` (legacy id fallback:
`reasoning_effort`). External ids and values are opaque; `ultra`, for example,
is not a native Macro effort level.

## Configuration contract

Session metadata preserves the agent's complete advertised ACP configuration.
An omitted configOptions field leaves the prior snapshot intact; an explicit
empty list removes it. Select values and configuration ids remain opaque.

The generic setConfigOption action records a correlated control outcome. HTTP
queue acceptance does not mean the runtime accepted the setting. Clients must
wait for the runtime outcome before presenting a change as confirmed.

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
