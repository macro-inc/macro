# Lexical Loro projection

`lexical_loro` maps portable editor commits to the persisted loro-mirror node
schema and native Loro events back to raw model changes. Loro is pinned jointly
with the TypeScript catalog to 1.17.1. Native text positions use Unicode scalar
indices; editor offsets and awareness points use UTF-16.

Call `new_doc(peer)` or `fork_doc(doc, peer)` before any operations. Both set the
explicit peer immediately and disable recorded timestamps. `initialize` seeds an
empty portable document; `attach` checks an already-loaded document against its
editor and subscribes to native events. Application golden snapshots are owned
by the later application layer.

Project each full editor output with `local_commit`, including its follow-ups,
as one Loro commit with the caller's timestamp. `local` also exports transport
updates. Imports or native undo/redo are drained with `remote`/`take_remote`.
Apply the returned changes through EditorCore, pass `RemoteNodesCreated` to
`bind_created`, then project normalization/plugin repairs with `FIXUP_ORIGIN`.
Restore selection from the pre-import cursors after core fixups; unresolved
cursors leave the fixed-up selection intact. The collaborative session owns Loro's undo manager, history grouping, selection
restoration and explicit recovery via reconstruct_state + attach.

`SyncPolicy` owns application exclusions, local NodeState and remote comparison
rules. No application node types, network, persistence, async runtime, host
callbacks or authentication policy live here. Entry spans expose counts and
caller-connected local/remote phases without recording document contents.

The implementation preserves fresh-map plain values, existing-map inference,
containerization on ancestor visits and unknown fields. Child maps retain their
native identities during reorders; cross-parent moves create new containers.
Remote matching reuses editor keys by durable id only after the old container
is deleted. Cursor reads never create native containers.

The checker compares the complete synced JSON and cached native slot identities.
Known typed nodes cannot re-export newer clients' unknown own fields: those fields
are preserved in Loro and the strict checker reports the mismatch. Unknown
NodeState keys round-trip. Recovery remains an explicit caller decision.

The current mirror's string-id list diff also retains unmatched old items when
the requested list is exhausted or an id is empty. Literal tests preserve that
quirk. The child-list implementation intentionally fixes stale move indices and
uses native container identity when ids change or are absent (S11 Δ-1/Δ-2).
A touched persisted transparent wrapper containing adopted children is flattened
into fresh child containers; unrelated foreign containers remain untouched.
Numbers follow JavaScript's JSON representation, including integral floats.

Tests require Bun and installed root workspace dependencies. The independent
runner imports the real `packages/loro-mirror` implementation and markdown
schema. It compares deep values and all container kinds at every key and relay
step. Four fixed seeds cover 2,048 key steps plus 2,048 relay commands; proptest
adds generated streams with shrinking (`PROPTEST_CASES` controls the count).
Two native peers and two mirrors run the same offline/reordered delivery schedule.
Mixed-runtime tests check snapshots, updates, UTF-16 cursor bytes and all version
pins/lockfiles. `loro-pair` is a generated CI workflow called by the PR gate when
its package, schema or version inputs change.

Literal tests also cover text-operation parity with native LoroText.update,
remote creation/id repair and missing bindings, native undo/redo and FIXUP
exclusion, policy transitions, buffered slot replacement, explicit recovery,
all three-item permutations, id-less stored highlights and deterministic outputs.
A half-megabyte typing test asserts bounded node visits and zero sibling scans.
`containers_written` counts mutation batches, including one batch per fresh
subtree; `children_scanned` and `nodes_visited` expose incremental work.

See AGENTS.md for commands. Application golden snapshots/plugins and session
history grouping are owned by WP-29/WP-49.
