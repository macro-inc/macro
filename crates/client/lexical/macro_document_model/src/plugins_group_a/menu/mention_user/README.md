# User mention insertion

`group-a.insert-user-mention` takes `{userId, email, displayName?, mentionUuid?}`
through the application envelope and uses the current selection. `displayName`
accepts string or null; a missing, null or empty name falls back to the email
local part, then the full email. Missing, null and empty UUIDs stay distinct
through `Maybe`.

The Normal-priority handler creates the node, inserts it, wraps a root/shadow-root
parent in the configured paragraph when needed, and calls `select_next(0, 0)`,
matching `DecoratorNode.selectEnd`. It adds no collapsed, code-format, composing,
editability or old-range gate.

The web workflow removes the search text first, then runs notification and
tracking I/O, then inserts with the then-current selection and generation.
Never combine removal and insertion atomically, restore an earlier caret, or
reuse strict `menu-select` admission.

Selection-control fixtures differ from the native preset by a trailing paragraph
after a root-level table; tests compare the native before/after pair, not full
documents.
