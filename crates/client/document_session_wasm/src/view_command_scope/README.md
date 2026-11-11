# Ordinary Enter callback port

The ordinary artifact exposes native Enter registrations at every existing
priority (0 Editor, 1 Low, 2 Normal, 3 High, 4 Critical), always After existing
entries. The model owns per-priority snapshots and callback identity; the JS view
owns DOM event lifetime, synchronous executor admission and function leases.
This port does not enable or borrow compatibility/foreign-node scopes.

`installViewCommandHost(dispatch, lookupFailure)` installs a module-wide router.
Its dispatch arguments are `(owner, callbackId, invocation, scope, generation,
access, programmatic)`. The final boolean comes from the actual model command's
optional event: true means explicit null, false requires the matching admitted
KeyboardEvent. Keep the event in JS. Catch/store/rethrow original callback values
by the issued scope, including null and undefined; lookup uses exactly
`(owner, invocation, scope)` and must reject a missing record.

Session methods are `viewCommandOwner`, `registerViewEnter`,
`unregisterViewEnter`, `viewCommandEnter(now, wall)`, and
`takeViewCommandFailure`. Cleanup handles remain stable after a real core
replacement; registration presence, not a model version, governs rebind.

Free scoped operations query actual pending selection/text/own JSON, set a view
selection, register/remove Enter listeners, dispatch whitelisted inputs, or
explicitly dispatch nested programmatic Enter. Every operation requires the exact
currently nested issued scope. Published view caches retain their ordinary role.

`viewCommandScopeDispatch` accepts only these generated EditorCommand values:
InsertText, RemoveText, InsertParagraph, InsertLineBreak, InsertTab, Indent,
Outdent, FormatText, FormatElement, SelectAll, ClearEditor, DeleteCharacter,
DeleteWord and DeleteLine. History, SetState, generic KeyDown, composition, sync,
initialization, flush, commit and admission are excluded. Use the dedicated Enter
operation, never a keyboard approximation.

Non-keyboard EditorApplication inputs require the current actual generation and
one of these registered source names: group-b.table, group-b.table-check-down,
group-b.move, group-b.resolve-pr, group-b.link, group-b.media, group-b.checklist,
group-b.code, group-b.select-all, group-b.node-transform. The existing application
decoder validates each payload. Unknown/future names and keyboard routes remain
closed. Scoped document mutation requires captured effective Edit access;
selection reads/writes and SelectAll remain available under the existing policy.
Ordinary Session admission always rechecks its own current authorization.

Failure collection and control supersession follow the owning crate's AGENTS.md:
collect per-cause readonly leases before the same output, suppress only valid
current ordinals, drain actual Diff/IO before choosing the first original cause,
and preserve retired causes under live canonical control. Metadata is never a
publication acknowledgement or permission token. The consumer must hold its
runSync busy guard through output consumption and cause handling.

Source tests use actual model transactions and Session lifecycle. Encoder fault
injection and the two-error aggregate are mechanical controls, explicitly not a
claim that one normal Session input produced the aggregate. A source checkpoint
alone does not establish a source-matched WASM/DTS, component browser parity,
production compatibility initialization, or the full application plugin profile.
