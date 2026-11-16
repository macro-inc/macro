# Checklist settings intent

`group-b.checklist-settings-intent` accepts `key`, `observedSequence` and
`settings`; generation comes from the application envelope. The sequence is a
canonical positive decimal u64 string; settings are a JSON object or null.
Unknown fields, scalar/array settings, keyboard commands, non-`KeepModel`
selection and nested batches are refused.

The session validates readiness, producer configuration, generation and a
direct-root checklist target before any Core transaction. Edit access reuses the
checklist Settings command; Read and Comment update only the session's
presentation producer, so stored `serializedState` never changes. The sequence
grants no access or ownership.

Any access change drops local choices; equal access refreshes keep them. See
`checklist_updates/README.md` for delivery and reader overrides.
