# User mention insertion

`group-a.insert-user-mention` uses the existing application envelope and the
current actual selection. Its payload is `{userId, email, displayName?,
mentionUuid?}`. `displayName` accepts string or null; a missing, null or empty name
uses the Source email-local-part/full-email fallback. UUID missing, null and empty
remain distinct through the existing `Maybe` representation. Other non-string
name shapes are unsupported typed input, not a claim about Source runtime errors.

The Normal-priority handler creates the actual node, inserts it, wraps an actual
root/shadow parent in the configured paragraph when needed, and selects the next text at UTF-16 zero or the parent end, matching Source
DecoratorNode.selectEnd → selectNext(0, 0).
It adds no collapsed, code-format, composing, UI-editability or old-range gate.
Generation and current Session admission remain authoritative.

The web workflow removes search first, then invokes actual notification/tracking
I/O, and inserts afterward using the then-current selection, generation and
access. It must not combine removal and insertion atomically, restore an earlier
caret, or reuse strict `menu-select` as proof of this contract. Menu UI close is
separate from Session/installation disposal.

The isolated Source selection controls install the actual mention plugin without
production table structure transforms. The native production preset already has
a trailing paragraph after the shadow-root table before insertion; the raw native
before/after pair retains that paragraph. This fixture difference is recorded,
not removed from either JSON or counted as full-document equality.
