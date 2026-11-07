# Macro document model

The portable node layer registers all 57 supported classes (41 Macro nodes and
16 upstream nodes). Payloads preserve JavaScript field order and distinguish
missing properties from explicit null with `Maybe<T>`. Framework fields remain
in `lexical_model`; real subtype projections retain code, list and mark behavior.
`ImportPolicy` is the single mechanism for reproducing each node's NodeState and
base-field import rules.

Use `export_registry` for gate/export callers and `headless_editor` for authored
headless content. Export has no replacements. Headless creation replaces code
and list nodes; importing stored `list` JSON preserves its exact type, matching
Lexical's static-config importer. Presets match the source node exclusions.
Unknown types remain errors; collaborative sessions can explicitly enable opaque
imports on the corresponding builder.

Host-dependent constructors use `NodeClock`, `NodeRandom` and `NodeHost` extension
state. Install clock/random callbacks through `export_builder`,
`headless_builder` or `preset_builder` before loading documents that need missing
timestamps or IDs generated. No model code reads wall time, randomness or a
browser hostname itself.

`bun packages/lexical-conformance/corpus/synthetic.ts` regenerates JSON oracles
from the actual TypeScript classes. The fixed corpus covers both registry
configurations, all Macro own fields, missing/null inputs, Unicode and long
strings, state filtering, nested contexts and the upstream node classes.
The `transformers` module ports the ordered internal, external, combined and
custom lists over `lexical_markdown`. Pass an explicit hostname through
`MacroMarkdownOptions` for external document links. The source metadata catalog
preserves the two RegExp-subclass matchers and each distinct list-image callback.
Route adapters remain separate.

Block decorators keep alignment in memory and omit it from JSON. Their first
write clones through the source constructor defaults. `MediaNode` exposes the
shared dimension calculation; authored constructors and imported fields retain
their distinct nullish/falsy defaults. `TASK_LIST_VIEW` retains arbitrary object
keys, and explicit watermark cleanup bypasses its ordinary removal guard.

The synthetic JSON route includes legacy custom-code versions and chart null
settings. Intrinsic hook tests cover comment continuation and session-card
placement. `bun packages/lexical-conformance/corpus/macro-markdown.ts --check`
verifies the supplemental conversion oracle across both profiles and all three
lists. The full recorded lexical-core source corpus remains the acceptance gate.

Two explicit S3 section 4.1b open-item defaults remain outside exact parity:
`divergence-magic-chip-status` rejects unknown status enum values, and
`divergence-reply-target-parent-keys` drops unknown keys inside reply parents.
Both have named regression tests; the valid-node oracle has no normalization.
