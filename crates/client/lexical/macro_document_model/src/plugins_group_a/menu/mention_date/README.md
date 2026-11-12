# Date mention insertion

`group-a.insert-date-mention` accepts a closed object:

```json
{"date":"2026-06-15T23:59:59.999Z","displayFormat":"Today"}
```

`date` and `displayFormat` are required strings, copied verbatim even when empty
or non-ISO. Optional `mentionUuid` distinguishes missing, null and empty strings.
Arrays, unknown keys, duplicate fields and other field types are unsupported
by this typed command. These decoder errors do not claim the error semantics
of malformed untyped Source calls. Stored-node parsing remains separate.

The host completes `group-a.search-remove` first, then constructs this body
inside the admitted insertion entry. It uses the current model selection and
captured generation, without restoring an earlier browser range or search span.
A later refusal does not roll back the separate removal. Source date parsing and
provider ordering remain in the shared host.

The Normal-priority producer checks generation before construction, creates the
existing Date node, calls shared `insert_nodes_at_selection`, wraps an actual
root/shadow parent in a paragraph and calls `select_next(0, 0)`. It adds no format,
collapsed-only, composition or UI-editability gate. Session authority remains
with the enclosing session.

Selection controls distinguish the Source virtual cell selector, its actual
command-entry text point and a raw Cell element point held in the active update.
The raw active Cell point is refused by Source shared insertion too; it must not
be silently retargeted in the Date handler. The complete native preset's existing
trailing paragraph is recorded independently from the minimal Source fixture.
