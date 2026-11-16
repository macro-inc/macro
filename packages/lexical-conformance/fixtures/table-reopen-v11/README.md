# Keyless table reopen under Source version 11

This independent Macro oracle uses the shipped Source Lexical wrapper, markdown
editing registrations, history, `CollabProvider`, Loro manager, sync engine and WAL.
It does not patch any product module. The Source product files are from
`9c3bc5782961f4eb2609f27d4201d648b36e16cb`. Account lookup and import-time service
sockets are mocked; an in-memory Loro peer implements the transport. IndexedDB
uses fake-indexeddb. This records editor/storage behavior, not browser UI or a
backend websocket frame.

The original received snapshot is
`crates/client/document_session/tests/testdata/table-keyless-reopen-received.loro`
(SHA-256 `f60b590a08550c51d2584f971258860a56c3f2e8b1a51310d63fd8ec0d804555`).
It stores metadata version 10 and omits the table's optional frozen-row,
frozen-column and striping fields. The synthetic content has no account data.
The tags-null control starts from those bytes, inserts the null slot with Loro,
and exports the resulting input snapshot before mounting Source. The current-version
control similarly changes only the input version to 11.

Run from the repository root after the root locked Bun install:

```sh
SOURCE_TABLE_REOPEN_SEARCH_TEXT=false SOURCE_TABLE_REOPEN_OUT=/tmp/table-reopen-capture \
  node node_modules/vitest/vitest.mjs run \
  --config packages/lexical-conformance/corpus/table-reopen.config.ts
```

Each case writes the received bytes, each unfiltered local update, full decoded
update JSON, the received/stored trees, local event origins and history facts.
The test waits for the real provider readiness and its flush command; it does
not choose an order by sleeping. The document-metadata plugin queues its version
update with `queueMicrotask` after the initialization update. The captured commit
boundaries and intermediate metadata are part of the native regression oracle.
Read and comment access both use the provider's `canEdit: false` branch.

The native test compares the local update sequence to this recording; IDs,
values and per-update boundaries remain available in the raw updates. The recorder fixes
peer IDs and disables timestamp recording so fresh Source captures can be byte-checked;
native writers retain their own peer and caller-provided time.

Run with `SOURCE_TABLE_REOPEN_SEARCH_TEXT=true` for the search-on profile. Both
values are passed through the actual feature-flag module and recorded. Search
is off in the production profile; the native regression selects the matching
sync policy for each profile. With no output directory the recorder checks the
fresh result against the committed profile instead of regenerating fixtures.

Observed local commits (the arrow separates commits, not individual operations):

| Input | Search off | Search on |
| --- | --- | --- |
| v10, missing tags | `environmentTags:null` → `version:11` | Same |
| v10, tags already null | `version:11` | Same |
| v11, missing tags | `environmentTags:null` | Same |
| v11, tags already null | None | None |
| Read / Comment | None | None |
| v10, missing search text | `environmentTags:null` → `version:11` | `[searchText:Alpha, environmentTags:null]` → `version:11` |

The original reopen's two update files were byte-identical across both captures.
The native tests resolve compressed peer aliases and compare existing container
identities, complete operation content and order, per-commit intermediate metadata,
and the final stored tree. New writer operation IDs and binary byte identity are
not native equivalence requirements.

The call-through spy records the real Source UndoManager alongside the last
`CAN_UNDO`/`CAN_REDO` notification. Single-write opens have actual `canUndo:true`
while the last `CAN_UNDO` remains false. Native availability is compared with the
actual UndoManager; the stale notification is recorded separately. The native tests require a
single undo item for writable opens with changes; no-op and Read/Comment opens have none.

Native projection-failure controls preserve the existing excluded-fixup convention:
with search on, the partial search-text write is sealed before a recovery commit
containing version and tags; with search off, the partial tags write is sealed
before the version-only recovery commit. These injected failures do not establish
Source error-path origin or undo parity.
