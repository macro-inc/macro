# Lexical model

## What it is

Portable editor model for the Lexical port. This crate owns values, registered
node types, immutable snapshots, transactional tree editing, update processing, JSON interchange, selection editing directional caret traversal, commands, plugins, history, structural view diffs and EditorCore.

## Start here

- `src/lib.rs` exposes the model API.
- `build.rs` derives ForeignHook IDs from ForeignHooks; keep upstream aliases on the trait and syn optional behind foreign-nodes.
- `src/node.rs` defines node kinds, inheritance and dispatch.
- `src/read/record.rs` owns borrowed records and ephemeral copies; `src/foreign/` owns runtime hooks, registration and state codecs.
- `src/foreign/render.rs` captures raw base/links and typed native payloads for a separate render metadata batch; never route installed instance hosts through public exportJSON/getters or NodeState serialization in flat Diff. Keep owner registry entries weak and validate exact captured record identities; record_keys includes detached pending records, and snapshot selection identities retain their exact scope. Use foreign_dirty_keys for update deltas instead of scanning all records.
- `src/foreign/instances.rs` stages semantic JS instance clones with editor-owner namespaces and opaque IDs; validate every base/payload/link acknowledgement before installing the record. Track writable instance updates separately from Rust Arc sharing so read captures never run additional JS constructors.
- `src/foreign/records.rs` exposes collected records for raw host captures without restoring graph membership; capture_for_foreign_read copies fields without clone hooks or key allocation.
- `src/foreign/read.rs` captures independent pure-callout inputs, including current native projections, active/previous/detached selection fields and composition; its independent read transaction rejects guarded writes, pipeline and publication before model hooks. Its point values can change without composition, dirtiness or memo side effects; hosts still own complete read-only ABI and JS object freezing.
- `src/selection/caret.rs` implements directional caret range deletion.
- `src/transaction.rs` owns writes; never mutate a committed snapshot.
- `src/pipeline/` implements flush order, normalization, GC and view-attached caches; its non-converging transform regression pins the upstream invariant text. `pipeline/continuation.rs` shares this engine between ordinary unboxed flush and owned sliced work; budgets count node work rather than elapsed time. Move its optional state unchanged through suspend/resume/adoption, reject intervening writes, and retain failed continuations until cancellation.
- `src/commit.rs` computes mutations before cache writes and atomically publishes snapshots.
- `src/plugin.rs`, `command.rs` and `extension.rs` own dispatch, follow-up rounds and transactional extension state.
- `src/history.rs` owns undo/redo stacks and the standalone merge tracker.
- `src/diff/` owns the versioned flat ABI; keep all 12 opcodes in sync with the independent TS decoder test. Native decorator signature sidecars are resolved by the consuming view, never serialized as state or observed by Commit.diff.
- `src/core/` owns input policy, raw remote edits and host effects.
- `src/caret/` implements directional positions, eager cursors, range removal and splitting.
- `src/test/proptest.rs` checks generated scripts against independent link, cache, JSON, mutation and view-diff invariants.
- `benches/node_map.rs` measures isolated writes and full keystrokes at three document sizes; read `benches/README.md` before interpreting timings.
- Keep learned NodeState configs scoped to each editor and exact registered type; import learned fields in incoming JSON order.
- `src/json.rs` preserves export order and JavaScript number serialization; `json/parse` borrows typed node envelopes and `json/write` streams `EditorState::to_json_string` into one shared buffer.
- Keep JSON fast paths restricted to exact builtin types without replacements, foreign hooks or flat state layouts; custom imports/exports retain their complete ordered payloads and virtual dispatch.
- Reuse `json::js_string` and `json::js_to_number` for JSON boundary coercions; JSON.stringify is a different operation.
- `src/style/css.rs` is the shared ordered JavaScript CSS parser for selections and HTML export.

- `src/foreign/native.rs`: one-shot native-super scopes shared by owned read captures; skip only the matching outer virtual dispatch.

## Boundaries

- Preserve imported element text format/style through the immutable main initialization receipt; reconcile writable follow-ups normally and never change the import baseline to fit derived caches.

- Keep parse_editor_state strict; parse_editor_state_report exposes partial state and its diagnostic only to hosts that choose a logging error policy.
- Require equivalent NodeState on both text neighbors before normalization merges them, including absent versus populated state.
- Preserve optional StateValue inner identity and imported undefined text fields through paragraph exports.
- Preserve known typed state on raw remote updates only when its effective serialized value is unchanged; parse changed/explicit-null values and reset removals, while ordinary JSON imports always reparse.

- Preserve owning-package extension callback errors in Error::Extension; never classify them as unrelated model failures.
- Use Error::invariant for runtime diagnostic context; static and owned messages display verbatim and share the Invariant classification.
- Use NodeType::create_default for context-dependent constructors; default_node and flag probes remain pure data for foreign projections; runtime foreign types without defaults reject create_resolved.
- Pure Rust model; no network, database, runtime or browser dependencies.
- Use CompositionEvent::Clear for Android ownership reset; it preserves text and
  restores anchor typing style without CompositionEnd semantics.
- Client crate: keep it excluded from workspace-hack through `crates/client/*`.
- Use `replace_selection` when a package allocates a new selection object; point mutations preserve the active object identity.
- TableSelection::set changes keys while preserving point offsets/kinds and dirties only changed keys, retaining any existing dirty mark.
- Use Input::TextDeltaFromView with a UTF-16 offset/deleted span and inserted text for ordinary DOM-first input; reserve full TextFromView for explicit resync. Validate edits before selection changes, preserve typing attributes, and acknowledge text only when post-transform content matches. Full resync shares unchanged-input and composition termination policy, including newline Enter dispatch.
- Text replacement uses upstream node-based removal across every block type; caret deletion has different shadow-root semantics.
- Use base parent splices for sibling insertion and replacement; element append retains virtual splice dispatch.
- Clamp element offsets during caret reads while retaining the stored selection points.
- Node removal relocates affected points to adjacent sibling element boundaries without descending into their text.
- Selection direction caches survive text-only edits; point setters and range clones invalidate them.
- Selection slots, formatting and range edits preserve upstream active-versus-detached selection side effects; inline insertion derives its split index from the current Active range and splices the receiver block, while empty block insertion skips that split.
- Movement consumes explicit host points; `NoView` runs structural rules only.
- Optional `model-segmentation` enables Unicode movement within text nodes; visual line boundaries still require host layout.
- Read SharedKeyCounter::last_allocated when a host must observe temporary allocations without retaining nodes.
- Borrow committed leaf identities through DirtyLeaves; selected tabs remain atomic during range replacement.
- Stage plugin notifications with `emit`; consume typed events from a successful Commit, never call host callbacks inside transforms.
- Typed selection-change and application commands use immutable plugins and transactional extension state.
- Caret cursors compute successors before returning items; keep the construction-time first step.
- Commands visit registered listeners only; external dispatch flushes between levels, inline dispatch does not.
- Keep Click a normal indexed command; views supply DOM selection facts and registered rich-text listeners own selection clearing and format escaping.
- Hooks share one follow-up transaction per round; conditional hooks then run isolated transactions and discard false results, including early flushes. Keep the shared 99-round guard and roll back extension state with updates.
- `StateRef::export_text_slice` exports changed clipboard text through ephemeral clone and export hooks without mutating snapshots.
- `Transaction::restore_editor_state` clones snapshot records, preserves composition and staged dirty sets, and permits further writes; `set_editor_state` seals instead.
- Publish event-only commits without advancing the history merge clock; history records only document or selection changes.
- History restores snapshots without rerunning transforms; diffs compare descendant map entries even when ancestor records are shared.
- EditorCore is sans-IO: host time, layout, clipboard and composition facts arrive as data; effects leave as values.
- Failed hook rounds roll back early publications too; failed main inputs retain and report their early commits. Use IsolatedAfterCommit for speculative follow-ups that must discard declined writes without undoing shared plugin commits; include queued updates and early publications in the round limit.

- `src/staging.rs` owns always-built PendingUpdate suspend/resume/adoption and `core/staging.rs` scopes it on the same core; dropping it discards unpublished work, and wrong-editor or stale-publication resumes reject. Native identity markers stay lazy until staging is used. Feature-gated `foreign-nodes` adds runtime node descriptors, own JSON fields, inherited hooks, conformance peers, seeded-state restoration and foreign identity aliases.
- Use Transaction::has_foreign_effects before closing a host no-op; selection, composition, extension state, events, reconciliation and queued work must survive even without node diff operations.
- Use Transaction::commit_foreign for fallible prepublication encoding; preparation errors drop current effects without rolling back previously published commits or reusing allocated identities.
- Preserve getNodesBetween's directional walk and crossed ancestors in Read::nodes_between; it is not a slice of document preorder, especially for ancestor/root endpoints.
- Resolve descendant_by_index past the child count through the last child's last descendant; an in-range child resolves through its first descendant.
- Foreign records retain ForeignData; typed payload reads return None outside inherited native hooks. Native hooks use a private decoded parent projection, including native ancestry/capabilities; synchronize and suspend it before foreign callouts, refresh it afterward, and preserve subclass fields on writeback.
- Runtime command registration deduplicates callback identity at each command/priority and snapshots each priority when reached; runtime transforms snapshot per type for each pipeline pass and follow build-time transforms. Unregister updates listener priorities immediately.
- Foreign state values stay in unknown JSON slots; first read binds the codec without dirtying the record. Use codec equality/default omission only for bound keys, preserve raw unbound JSON, and let class declarations override a config's flat default. Release registration/binding guards before every host callback.
- Clone hooks run before projected mutable access. Invalid native parent fields from infallible clones reject flush and publication; snapshots retain their previous values.

- Accepted text splices acquire writable records even for unchanged content; equal set_text_content remains a no-op.
- Raw element splices preserve surviving parent offsets; sibling insertion/removal APIs adjust their own source and destination endpoints.
- Structural deletion and movement traverse directional carets before consuming host layout targets; direct child blocks are not adjacent block boundaries.
- Block insertion compares captured writability when upstream checks node object identity.

Preserve empty-splice dirty ordering and selection points when optimizing detached tail appends; update only new links, the previous tail and the parent.

## Checks

- `cargo test -p lexical_model -j4`
- `cargo test -p lexical_model --all-features -j4`
- `PROPTEST_CASES=256 cargo test -p lexical_model proptest -j4`
- `cargo bench -p lexical_model --bench node_map -j4` (release performance checkpoint)
- `cargo check -p lexical_model --all-features --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_model --all-targets -j4 -- -D warnings`
- `cargo test -p lexical_conformance --test flat_diff -j4` (requires Bun for the independent decoder)
- `cargo tree -p lexical_model --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Gotchas

- Text positions are UTF-16 code units; allow interior selection offsets but reject edits that split surrogate pairs.
- Text insertion checks the adjacent text node's insertion edge before reusing it; tabs and entity boundaries require a new plain text node.
- Node ordering is post-order within shared ancestry, including detached subtrees.
- Node ancestry follows the kind trait's `Parent`, never Rust layout casts.
- Keep key allocation outside rollback, and snapshots independent on first write.
- Give owned captures of pending state a separate root-text memo; materialize native projections without clone hooks while retaining their source record identity. Preserve detached slot indices, holes and selection caches when capturing read inputs.
- Use SharedKeyCounter::allocate_for_foreign_host for dev generateRandomKey; it shares allocation with editors without creating records or consuming commit identities.
- Preserve update provenance through pending and previous root-text cache evaluation, including publication; plain external state views remain originless.
- Preserve source editor/update provenance through pure read peers; combine matches_origin with active callback checks, and keep plain editor-state captures originless.

## Tests

- Cover every public function with an explicit literal behavior test before adding table-driven or generated cases; do not hide fixture construction behind a helper DSL.
- The independent Tier C lockstep lives in `packages/lexical-conformance/diff/`.
- Test pipeline order, rollback, JSON bytes and boundary cases locally; replay the admitted Tier A core subset with `cargo test -p lexical_conformance --test replay -j4`.

The sibling test modules cover values, reads, node dispatch, tree edits and NodeState.
`pipeline/test.rs` covers ordering and transaction boundaries; `json/test.rs` checks
literal exported bytes. `selection/*/test.rs` and `selection/test.rs` port explicit
upstream selection examples, including the §18.5 `remove_text` fixture, detached-slot
side effects, UTF-16 boundaries, formatting, block deletion and host movement.

Root text-cache reconciliation clones its record after mutation reporting and retains
the intentional root dirty mark; cache-only writes do not add mutations. Use
EditorBuilder::without_reconciler_caches when an external JS reconciler owns root
text and element text-format/style cache writes; normal native editors retain
model-derived caches, and explicit writes remain subject to the normal pipeline.
Hydrating an external-reconciler root preserves an absent raw cache; explicit
text aggregation may fill the state memo without inventing a raw JS root cache.

Generate command scripts with inline paragraph contents and block decorators at root; malformed nested paragraphs can legitimately reject insertion upstream. Check range-only command preconditions after decorator deletion enters NodeSelection, and validate selected node keys too.

Generated properties cover S4 P1–P13 for the core node subset. P5 follows S1 §8.6
cache eligibility; P10 compares dirty records before cache writes per S1 §8.7.
Exact history JSON identity (P11) uses headless mode: restoring view-attached
snapshots can reconcile cached element defaults, as the upstream literal guard
demonstrates. Place P14 markdown round-trip properties in lexical_markdown. Persist shrinking seeds in
`proptest-regressions/`. Keep the decorator count in sync with record insertion
and removal; opaque text hooks rule out the local root-text proof.

Cache range direction only when upstream calls isBackward in a write context; invalidate it on endpoint changes and selection-object cloning, while preserving it through text-only trimming.
Collaborative callers opt into `opaque_unknown_types(true)`; strict import stays
the default. Opaque records keep original type/version and own JSON, while framework
links own children. Own export stays flat and overlays changed framework fields.

Opaque future framework enum values round-trip unchanged. Apply source import rules to known fields; unknown element-format strings default through the source lookup.
Copy only own fields when importing opaque elements; never recursively clone children.

Expose immutable event names and the DirtyLeaves alias to boundary and post-commit adapters;
keep typed event payload ownership in the plugin registry.

Capture an existing selection for a foreign host with snapshot_for_foreign_read; Clone intentionally clears range direction memos for upstream clone() semantics.

Apply splice_text through its own check hook and direct text write, without dispatching set_text_content; move_selection edits an existing range in place, preserving its identity and typing attributes.

Move existing text ranges through point edits in select and splice_text so composition follows the old anchor/focus node.

Use with_foreign_native for explicit development native-super dispatch; consume the exact node/hook before entering native behavior so nested virtual calls stay active. Keep scopes update-local and thread-local even when read captures share their owner; drop guards independent of transaction borrows; import/clone lifecycle dispatch needs its own construction scope.

Native-super currently selects the nearest registered native ancestor. Explicit older-prototype targeting (for example a TextNode base method on a TabNode) is still required with the native facade/overlay; do not count this primitive as full native-class hosting acceptance.

Track foreign captured-record identity with immutable marker tokens that do not retain records or affect writability; copy-on-write slot clones receive fresh markers. Resolve materialized read identities through source aliases, and never substitute payload-copy addresses for source identity.

Hide typed native projections while invoking pure foreign hooks, but retain the lexical projection stack for owned read captures; nested native predicates and sibling hooks must capture all pending projected payload fields with their original source identities.

Give runtime ForeignHooks text setters the current mutable transaction and ownership of the whole operation; Override::Value does not trigger a second framework write. Native TextNode coercion stays pure on fallback. Run the write guard before callbacks, and consume native-super bypass before walking any runtime ancestors.

Toggle text directionless/unmergeable bits directly on the writable detail field, clearing absent-detail export state; do not call the virtual set_detail hook or Tab's forbidden setter. toggle_format remains virtual through set_format.

Development selection identities use pointer tokens with no retained model data. Retire replaced objects into detached slots before callbacks; preserve tokens across suspend/read captures, explicit reactivation and removeText restoration. In-place point/format/normalization updates preserve tokens. Native replace installs a cloned RangeSelection after structural edits; NodeSelection stays the original object.

Use ForeignReadSnapshot::contains_selection_identity to distinguish inherited selection objects from newly owned peer values; never infer that distinction from transaction-local slot indices.

Retain the current selection token and memo in immutable committed state clones; clone/reset selection values explicitly for pending updates. Publish the pending token only with the pending state so no-op commits retain the committed object. Give with_selection replacement snapshots a fresh token. Carry previous selection identity through owned read captures/suspension and hydrate it with detach_previous_foreign_selection without activation or write permission.

Invoke selection_transform through its public guarded transaction entry point for explicit host calls; read-only peers must reject before callbacks. The flush pipeline uses the same vtable entry and reevaluates live focus after the anchor hook.

Use needs_flush for a development host's implicit pre-commit pipeline pass; preserve the model dirty_since_flush predicate across suspension and keep explicit flush semantics unchanged.

ForeignReadSnapshot::is_originless_capture_of compares the exact canonical records and selection identity, including native projection sources. Compare selection values, memo and order too. Save ForeignReadContext metadata without pinning pending records before cache writes; pair an authorized publication state only under a ForeignReadLease and have the host check its exact installed lease on derived reads. Pairing alone grants no dispatcher authority.

Bracket fallible development runtime reads with ForeignReadOperation. Its thread-local stack transports owned failures only and grants no editor authority; nested failures are isolated, first error wins, and unscoped deferral rejects without retaining thread state. Check before callbacks, writes, memo publication, projection writeback and commit publication; infallible native signatures alone cannot report JS exceptions. Restore native scopes from the latest already-decoded payload even after a child failure; block payload writeback instead of restoring stale typed fields.

Preserve bound instance IDs through raw captures and state installs; use explicit CopyOnWrite, Copy, Restore and Ephemeral staging only at semantic clone sites. Materialize bound root cached text before cache publication and exact-publication hydration; keep root cache metadata separate from native payload patches. ForeignCloneContext exposes an owned source read only during payload cloning. Capture after materializing the persistent-map path but before borrowing its writable record; no transaction pointer enters TLS. Normal native/default-feature clones are unchanged.

ForeignSelectionCapture owns an explicit ordinary argument and optional identity. StateRef.with_foreign_selection_argument carries provenance through native traversal; recognize exact objects, never infer identity from equal selection fields. Owned read snapshots hydrate captured arguments without granting graph write authority.

Use EditorCore suspended host scopes to stage on the same editor, then adopt only through an admitted command transaction. Validate editor identity/publication and a pristine target before moving pending fields; reject read peers and previously published staged commits. The host still owns readiness/access admission.

Use ModifyTarget::RequireView when a view-backed host has not supplied layout endpoints; keep NoView for source paths with no DOM view. Structural movement runs first, then unresolved movement returns LayoutRequired.
Native boundaries reconstruct dense indices with `NodeTypeIndex::from_raw`; validate against the receiving registry before lookup.

Restore owned selection metadata through with_foreign_value_metadata; synchronization preserves object identity and treats cached direction alone as a memo change without dirty/publication effects.

Consume ForeignReservedKey capabilities for externally constructed native records; keys come from the exact allocator and are never reallocated or rolled back.

Opt out of class static transforms with without_static_transforms only when an external runtime owns them; explicit transforms and core text normalization remain enabled.

Supply foreign_instance_hooks on the builder when hydration or initial document callbacks need the runtime; install it before initial-state parsing/publication, without running JS constructors during registration.

Install foreign_native_hooks on exact builtin registrations before flag computation; retain their typed payload/index/ancestry and saved native baseline. Dynamic foreign children must execute inherited baseline mutations through native projection, while native payloads use the baseline directly. Import/update/export/clone lifecycle and static-transform callbacks use separate host paths.

Capture actual update dirty sets, intent and full-reconcile mode in ForeignReadSnapshot metadata for pure host callouts; preserve those facts through readonly peers, suspend/resume and authorized historical read contexts instead of inferring them from rendered records or the peer dirty sets. Composition remains the snapshot view fact.

Read captured/retired root __cachedText through NodeRef::foreign_raw_root_cached_text without materializing text or resolving latest; retain the separate lazy StateRef cache API for callers that explicitly request computation.

Apply ForeignBaseField assignments only to existing writable records, without virtual setter dispatch or another semantic clone; keep unknown u32 element formats raw while their exported/public alignment name is empty, matching the pinned numeric-property fallback.

EditorCore output exposes the selection accepted before an input runs, including explicit clearing and resolved view boundaries; external collaborative history must use it rather than reconstruct raw host points. This is native metadata, not a host wire field.

Use ForeignBaseField::apply_owned for independent clone-stage scalar validation
without repeated base copies; retain writable/update authorization in transaction
entry points. Captured composition ownership belongs to the exact read snapshot.

Preserve shared unbound hydration cells only in exact read copies; isolate them
when cloning a record for mutation, without invoking JS constructors from
NodeSlot::clone. Use clone_fields only for raw read captures and projections.

Keep deferred foreign payload validation off registries with no runtime payload
classes. Validate only dirty live records during normal flush/publication; use a
full check for state replacement/full reconciliation and explicit state validation.

Create already-constructed hosted native instances through
create_reserved_with_instance: validate owner/class/base before installation and
bind the new record as writable in its current update, without replaying a JS
constructor or clone when an owned raw capture incidentally shares the record.

Keep the foreign failure stack thread-local without synchronization locks; scopes
cannot move between threads. Preserve failure checks for native editors invoked
inside a failed foreign callback, even when their registry has no foreign classes.

Skip empty foreign-state metadata through the actual ForeignStateRegistry and
ForeignBindings population markers, borrowing unchanged layouts and avoiding
empty configuration lock/map clones. Never use foreign payload node presence as
that guard: builtin text can carry registered JS NodeState and must preserve its
codec behavior, lazy reads, flat serialization and previous snapshots.

Seal delegated host reconciliation only after a flushed same-update phase and
validated host acknowledgement; preserve staged publication denial. Derived
cache writes must not replay transforms/GC on admission. Reopen only an actually
sealed unpublished phase after policy refusal; stage tokens never grant commit
authority or rollback a published transition.

Render retired records only through the explicit owned metadata API; preserve
last removed scalar/link fields and identity without restoring graph reachability
or invoking public export hooks. Live render lookup must still reject those keys.

Keep DecoratorNode::render_revision optional, inherited and nonserialized; preserve
it through clones and advance it only at actual component-invalidating setters.
Keep render_signature pure and source-ordered for signature-cached decorators;
compare it only at consuming-view exposure, never increment a counter per write
or advertise both signature and eager revision policies for one node.
External publication adapters may associate a callback and its real commit using
`ForeignReadSnapshot::origin_update_identity` and `Commit::foreign_update`. These
opaque markers grant no active scope or mutation authority; unowned state reads
and synthetic no-op commits carry no origin. Never serialize or print marker
addresses, or infer a new publication from a historical/read-only capture.
