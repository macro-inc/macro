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
