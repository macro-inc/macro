# Date mention insertion

`group-a.insert-date-mention` accepts a closed object:

```json
{"date":"2026-06-15T23:59:59.999Z","displayFormat":"Today"}
```

`date` and `displayFormat` are required strings, copied verbatim even when empty
or non-ISO. Optional `mentionUuid` distinguishes missing, null and empty strings.
Arrays, unknown keys, duplicate fields and other field types are rejected.
Stored-node parsing is separate.

The host runs `group-a.search-remove` first, then sends this command. It uses the
current model selection and generation, never an earlier browser range or search
span; a later refusal does not roll back the removal. Date parsing and provider
ordering stay in the host.

The Normal-priority handler checks generation, creates the Date node, calls
`insert_nodes_at_selection`, wraps a root/shadow-root parent in a paragraph and
calls `select_next(0, 0)`. It adds no format, collapsed-only, composition or
editability gate.

A raw Cell element point in the active update is refused by shared insertion,
as in the web editor; never retarget it in this handler.
