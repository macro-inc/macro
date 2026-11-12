# Checklist settings intent

`group-b.checklist-settings-intent` accepts `key`, `observedSequence` and
`settings`, with generation supplied by the existing application envelope.
The sequence is a canonical positive decimal u64 string; settings retain the
exact JSON object or null. Unknown envelope fields, scalar/array settings,
keyboard commands, non-KeepModel selection and nested batches are refused.

The private static command key identifies this metadata intent. The queued
session independently validates readiness, actual producer configuration,
current generation and direct-root checklist target. Stale presentation is
processed before any Core transaction. Read and Comment update only the
session's producer; Edit reuses the existing checklist Settings command.
The sequence grants no access, model ownership, publication or transfer ACK.

Any actual access change invalidates local choices before another settings
branch. A forced real delivery advances the sequence even when the plan looks
identical. No-facts, allocation failure and exhaustion remain closed, preserving
pending receipt debt. Equal access refreshes are not invalidation.

This is presentation-only reader coverage. Canonical serializedState remains
stored, while Source changes its local reader NodeState. Surviving overrides
persist through remote application errors until a later accepted reset/replacement/disposal; this
is an explicit unqualified Source difference. Success-only remote reset and
control remount behavior do not establish Source error-path or replacement-
editor-version parity. See the derived-delivery README for staging and exposure.
