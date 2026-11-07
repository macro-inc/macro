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
The collaborative session owns Loro's undo manager, history grouping, selection
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

See AGENTS.md for checks. Literal tests cover schema kinds, text-operation parity,
UTF-16 cursor round trips, delete/move and cross-parent restructuring, remote
application, no-echo write-back and explicit divergence/schema errors.
