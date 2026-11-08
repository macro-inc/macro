# Service export boundary

Use `export_builder` for the service registry. It registers stored code/list
classes directly, with no replacements or Prism cleanup. `parse_export_state`
explicitly implements the service logging error policy and retains reached state;
permission checks use the strict parser through `comment_gate` instead.

Exports read immutable editor snapshots. Search and cognition return shallow
`exportJSON` bytes in source key order. Block Markdown takes an explicit root
child list instead of modifying the document. External document links require an
explicit hostname; booking links capture constructor hostname through NodeHost.
XML reads the original serialized document without importing or normalizing it.

S1 Q8: the service export call graph reads the declared `idState` through `$getId`
(`services/lexical-service/src/lib/convsersions.ts`, search and cognition paths;
`packages/lexical-core/plugins/nodeIdPlugin.ts` declares that key). Transformer,
search-text and XML callbacks introduce no additional StateKey reads. The
TaskList view accessor is outside this export call graph. Rust reads ID_STATE
through StateRef without mutating known/unknown NodeState or committed caches.
The 342-case source oracle includes identity between unknown state keys and
compares shallow JSON bytes exactly, then repeats serialization after all reads.
It covers internal/external/embedding Markdown, plaintext, search, cognition/v2
and XML, including supplied and absent hostname. No read cache fallback is needed
for these paths; keep future StateKey reads under the same acceptance check.

Regenerate with `bun packages/lexical-conformance/corpus/macro-exports.ts` and
check freshness with its `--check` flag. Run `cargo test -p macro_document_model
--test exports -j4` for strict source results and unchanged-state checks.
