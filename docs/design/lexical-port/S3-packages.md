# S3: crates above the Lexical core

Revision: R2.1 (R1 resolved audit R1-B and the package items of R1-D; R2 resolves the package items of audits R2-1, R2-2 and R2-4; R2.1 applies S1 R2.1's "Changes other specs must make" for S3; see "R1 resolutions", "R2 resolutions" and "R2.1 consistency" at the end). **Where body text and "R2 resolutions" disagree, "R2 resolutions" wins**; the body rows edited in place in R2 are marked `(R2)`.

Spec for the Rust crates layered on `lexical_model`: `lexical_rich_nodes`, `lexical_markdown`,
`lexical_html` and `macro_document_model`. Target: Lexical v0.45.0 (`target/lexical-upstream`,
commit `0cfcc16`) and Macro at `.`. Context:
`SCOPE.md`, `notes-packages.md`, `notes-macro.md`, `notes-api.md`.

Paths in mapping tables are relative to the repo they come from: `packages/lexical-*/…` is
upstream, `packages/lexical-core/…`, `services/…`, `crates/…`, `apps/…` are Macro. Line numbers
were read from those checkouts on 2026-11-07. "Core spec" (also written S1/S2 below) means the
parallel `lexical_model` spec. Each section lists what it assumes from it; §0.3 collects them.

## 0. Overview

### 0.1 Crates and dependencies

All under `crates/client/lexical/<crate>/`, wasm32- and native-safe (no tokio, axum, sqlx,
reqwest, aws, rdkafka), excluded from hakari, each with an `AGENTS.md` + `CLAUDE.md` symlink.

| Crate | Depends on | Replaces | Section |
| --- | --- | --- | --- |
| `lexical_html` | `lexical_model` only (+ `base64`, `ryu-js`) | `$generateHtmlFromNodes` + the `ExportDom` trait, walker, serializer and core-node impls (export only) | §3 |
| `lexical_rich_nodes` | `lexical_model`, `regress` (`utf16`); feature `html` adds `lexical_html` | `@lexical/{rich-text,plain-text,list,link,table,code-core,mark,hashtag,overflow,selection,utils,text,offset,clipboard}` model halves; feature `html` holds their `ExportDom` impls | §1 |
| `lexical_markdown` | `lexical_model`, `lexical_rich_nodes`, `regress` (`utf16`) | `@lexical/markdown` + the list-indent patch | §2 |
| `macro_document_model` | `lexical_model`, `lexical_rich_nodes`, `lexical_markdown`, `lexical_loro` (snapshot fns), `quick-xml`, `lexical_node_id`, `document_id` (S13; flat crates until reorg phase 3); feature `html` adds `lexical_html`, `lexical_rich_nodes/html` and the htmlparser2 port for HtmlRenderNode (§3.8). **No default features. Never `trigger_context`** (R2, B3) | `packages/lexical-core` model code + every `services/lexical-service` route except the composers | §4 |
| `macro_document_composers` (R2, server-side, `crates/macro_document_composers`, flat, **not** under `crates/client/`) | `macro_document_model`, `trigger_context`, `bot_id`, `chrono` | the `/agent-context`, `/agent-announcement`, `/extract-reply`, `/image-markdown` composers (§4.4) | §4.4, R2 B3 |
| `lexical_loro` (snapshot: §4.3.6; live projection: S11) | `lexical_model`, `loro` (`=1.16.2`, R2 H4) | §4.3.6 puts the snapshot functions here | §4.3.6 |

```
lexical_model
  ├─ lexical_html (trait + core impls) ─────────────┐ (feature "html")
  └─ lexical_rich_nodes ──[html: impls for its nodes]┘
       └─ lexical_markdown ─┐
                            ├─ macro_document_model ── server crates, sync-service, wasm
           lexical_loro ────┘
```

The orphan rule puts each `impl ExportDom for X` in the crate that defines `X` or the crate that
defines `ExportDom`. `lexical_html` defines the trait and implements it for the core nodes
(`ParagraphNode`, `TextNode`, `TabNode`, `LineBreakNode`); `lexical_rich_nodes` implements it for
its nodes in `src/<module>/html.rs` behind its `html` feature; `macro_document_model` implements it
for the 41 Macro nodes in `src/html/nodes.rs` behind its `html` feature. sync-service builds
`macro_document_model` with `default-features = false`, so neither `lexical_html` nor the
htmlparser2 port is linked into the Worker (size gate: §6.6).

### 0.2 Decisions applied throughout

1. **Code highlighting is view-only.** No tokenizer and no `CodeHighlightNode` creation in Rust.
   Stored `code-highlight` nodes deserialize, round-trip byte-identically and are never merged:
   core "simple text" is `type == "text" && mode == normal` (§1c.1.3).
2. **Markdown list indent is configuration** (`MarkdownOptions::list_indent`, upstream 4, Macro 2).
   This replaces [markdown patch](../../../apps/web/patches/%40lexical%252Fmarkdown%400.45.0.patch) (§2.2).
3. **Table `$clearText`** follows [table patch](../../../apps/web/patches/%40lexical%252Ftable%400.45.0.patch): cleared
   cells keep one childless paragraph (§1b.8). Guard test `tableClear.test.ts:135`.
4. **No DOM in Rust.** createDOM/updateDOM/decorate/importDOM stay in the JS view. exportDOM
   becomes `lexical_html::ExportDom` (§3). Each section ends with a "Not ported" list.
5. **Regex: `regress`** with UTF-16 indices for every transformer pattern. The dead
   `allMarkdownCriteria*` legacy block (`packages/lexical-markdown/src/utils.ts:30-404`) is not
   ported (§2.9).
6. **Byte-identical output to lexical-service is the M1 acceptance bar.** Anything that affects
   stored JSON, caller-visible markdown or the comment-only gate is bug-compatible unless the fix
   is provably safe: JS produces no output (it throws), the path is interactive-only with no
   stored-data surface, or the value never leaves the process. §5.1 records each ruling
   (fixed: Q1, Q4, Q7; copied: Q2, Q3, Q5, Q6, Q8, Q17, Q18).
7. **Two node registries** (§4.0). `export_registry()` is `SupportedNodeTypes` with no node
   replacements and no plugins, exactly `services/lexical-service/src/lib/editor.ts:4-8`; the
   comment-only gate and every doc-id export route use it. `headless_editor()` adds
   `NodeReplacements`; composers, `/html` (`lib/html.ts:63`), snapshots and Notion use it. Never
   substitute one for the other.
8. **JS truthiness on strings.** Wherever JS tests a string by truthiness (`if (peerId)`, `!id`,
   `label || slug`, `snapshotDate || now`), Rust treats `Some("")` exactly like `None`. Where JS
   tests nullishness (`??`, `=== undefined`, `!= null`), `Some("")` is a value. Each site below says
   which; a site that does not say follows the JS operator literally.
9. **`undefined` vs `null` vs absent.** A field that JS `exportJSON` writes as `undefined` is omitted
   (`#[opt]`); a field JS can hold as `null` round-trips `null` (`double_option` or `Value`). Rust
   never emits `null` where JS has no key (§4.1a rule 2).

### 0.3 What these crates require from `lexical_model`

The sections assume these from the core spec. S1 (now Revision R2.1) is the source of truth for every
`lexical_model` name and signature; the status column records where S1 satisfies each
requirement (R1 consistency pass; locations updated to S1 R2/R2.1 in "R2.1 consistency"). Where S1
chose a different shape, S3 follows S1.

| Id | Requirement | Needed by | S1 R1 status |
| --- | --- | --- | --- |
| CR-1 | Structural writes (`append`, `splice`, `insert_after`, `insert_before`, `replace`, `remove`, `set_indent`) dispatch to the node's override | ListNode, ListItemNode (§1a.5–1a.6), Watermark no-op `remove` (§4.1b) | Satisfied: S1 §3.2 (R2-38: mutator hooks `remove`/`replace`/`insert_after`/`insert_before` are declared once in `common_node_hooks!` and expanded into each kind trait, so they are overridden in the kind-trait impl, not on `NodeType`; `splice`/`append`/`set_indent` on `ElementNode`), §3.5 vtable, §7.4 |
| CR-2 | Ancestry (upstream `instanceof`): a subclass declares its superclass, and `is::<Base>`, `get::<Base>`, `get_mut::<Base>`, `cast::<Base>` accept a `Sub`. Covers both replacements and plain subclasses | AutoLinkNode, TaskListNode, CustomCodeNode, CommentNode, SearchMatchNode, ImageNode/VideoNode | Satisfied: S1 §3.2 (R2-38) `Parent` + `as_parent`/`as_parent_mut` on each kind trait (`ElementNode::Parent: ElementNode`, …; `ParentOf<Node>`/`KindOf<Node>::Parent` for generic code), §4.1 `RegisteredNode::ancestry`, §5.2 `Read::{is, cast, get}`, §7.2 `get_mut`, §2.1 `Id::upcast`. There is no `Extends` trait |
| CR-3 | `.replace::<Base, Sub>(with)`: creation, JSON of `Base::TYPE`, and `.transform::<Base>` all route to `Sub` | `ListNode → TaskListNode`, `CodeNode → CustomCodeNode` | Satisfied: S1 §4.2 `replace(with: fn(Original) -> Replacement)` (Replacement's `Parent` chain must reach Original), §7.3 `create`, §13.3 step 2, §8.2 (direct replacement) |
| CR-4 | Transforms are keyed on exact type (or its direct replacement), as upstream keys by `__type`; node-intrinsic transforms are inherited along the class chain | hashtag, autolink, list, AgentSessionMentionNode | Satisfied: S1 §3.2 `static_transform` (per level, registry walks `Parent`), §4.2 `transform`, §8.2 |
| CR-5 | Tree-aware JSON export hook | ListItemNode `indent`/`checked` | Satisfied: S1 §3.2 `adjust_export_json(&self, node: NodeView<'_>, json: &mut SerializedNode) -> Result<(), Error>` in `common_node_hooks!` (kind-trait impl, R2-38); base keys come from virtual getters (§13.2) |
| CR-6 | Transforms read captured configuration | autolink matchers, hashtag, text entities | Satisfied by the alternative: transforms are `fn` items (S1 §8.2 `TransformFn`); configuration lives in `ExtensionState`, read with `tx.extension::<Config>()` (S1 §14.3). Closures rejected (no stored callbacks) |
| CR-7 | `Selection::Table(TableSelection)` variant and a table-selection hook trait | §1b.5 | Satisfied: S1 §9.1 `TableSelection`, `TableSelectionHooks`; §4.2 `EditorBuilder::table_selection_hooks` |
| CR-8 | The committed state and selection inside an update (`editor.getEditorState()`, `$getPreviousSelection`) | tables, markdown shortcuts, utils | Satisfied: S1 §7.2 `Transaction::committed_state()`, §5.2 `Read::previous_selection()` |
| CR-9 | `remove` on an already-detached node is a no-op; formatting works on a detached range | table column delete, `format_cells` | Satisfied: S1 §7.4 `remove`, §9.4 `format_text_at(SelectionSlot::Detached(..))`, §7.6 slots |
| CR-10 | `is_simple_text()` = `TYPE == "text" && mode == Normal`; normalization merges or prunes only simple text | CodeHighlightNode, InlineSearchNode, UnlinkedTextNode, DiffTextNode, comment gate | Satisfied: S1 §3.4 (TextNode row 11), §5.2 `Read::is_simple_text`, §8.2–8.3 |
| CR-11 | A load hook that may return a different node type from `importJSON` | DatabaseQueryNode → UnknownMentionNode (§4.1a) | Satisfied: S1 §3.2 `NodeType::import(tx, json) -> Result<NodeKey, Error>` |
| CR-12 | NodeState (`$`) JSON round trip with upstream defaults, plus per-node "keep only these `$` keys on import" | nodeId/peerId, most Macro nodes | Satisfied: S1 §6, §13.1 `JsonImport { state: StateImportFilter, base_fields, own_fields }`, §7.3 `update_from_json_with`. S3's `ImportPolicy`/`ImportedState` (§4.1a rule 5) lower onto it |
| CR-13 | Insertion-ordered JSON maps and a JS `Number#toString`-compatible number writer (`1` not `1.0`) | comment gate, XML codec, HTML data attributes, Loro snapshot | Satisfied: S1 §0 (`serde_json` `preserve_order`), §13.1 `to_js_json_string`, §13.5 `js_number`, `js_truthy`. S3's `js_json` re-exports them |
| CR-14 | One transform for an explicit list of type names, run with typed-transform rules; never for a type not in the list (so never for `root`) | nodeId plugin (§4.3.1) | Satisfied: S1 §4.2 `EditorBuilder::transform_each(AnyTransformFn, TransformScope::Types(&[..]))` (also `AllExceptRoot`) |
| CR-15 | `Commit` exposes tags, dirty leaves and the previous selection | markdown shortcuts (§2.8), nodeId (§4.3.1) | Satisfied: S1 §11.1 `Commit::{tags, changes.dirty_leaves, prev}`; previous selection is `commit.prev.selection()` (`Read`) |
| CR-16 | Clone hook: constructor side effects run on the copy made by the first write in a transaction (upstream: the constructor runs inside `clone()` at the first `getWritable()`) | CustomCodeNode language normalization (Q6), BookingLinkMentionNode url default | Satisfied: S1 §3.2 `NodeType::after_clone(&self) -> Option<Self>`, run at the clone points of S1 §3.1 |
| CR-17 | A registry built without `.replace` registers base and subclass independently: JSON `"code"` stays `CodeNode`, `"list"` stays `ListNode`, `tx.create(base)` returns the base | `export_registry()` and the comment gate (§4.0, §4.3.3) | Satisfied: S1 §4.1 (one `Registry` per builder; `ForeignEditorState`) |
| CR-18 | Hooks beyond the basic set: `reset_on_copy` receiving the original, `can_select_before`, `is_parent_required` + `create_parent_element`, tree-aware export (CR-5) | ListItemNode, TableNode, OverflowNode | Satisfied: S1 §3.2 `common_node_hooks!` (kind-trait impl, R2-38) `reset_on_copy(tx, this, original: NodeKey)`, `is_parent_required(&self, node: <Kind>View<'_>)`, `create_parent_element(tx, this)`. `can_select_before` is not a core hook (no core caller): TableNode exposes it through `EditorBuilder::node_trait` + `Read::get_dyn` (S1 §4.2, §5.2) |
| CR-19 | `Transaction::is_writable(key) -> bool`: the node was created or already cloned in this transaction (upstream `cloneNotNeeded.has(key)`) | table live-cell reads (§1b.0) | Satisfied after the R1 consistency pass added it to S1 §7.2 |
| CR-20 | Transform order is upstream-exact: dirty leaves in `_dirtyLeaves` insertion order, then intentionally dirty elements in insertion order, repeated until no node is dirty (`LexicalUpdates.ts:$applyAllTransforms`) | nodeId duplicate winner, comment gate list merges, autolink re-entry | Satisfied: S1 §8.2 steps 1–5 |
| CR-21 | Text normalization is upstream-exact: `$canSimpleTextNodesBeMerged(a, b)` is asymmetric (`LexicalNormalization.ts:16-34`) and each direction merges at most once per call (`:63-66`, `:78-81`) | comment gate (§4.3.3) | Satisfied: S1 §8.3 `normalize_text_node`, `can_merge` |
| CR-22 | Package invariants: hooks, transforms and plugin handlers return `lexical_model::Error`, so an upstream `invariant(false, msg)` in package or Macro code needs a variant that carries `msg` verbatim | every package hook that throws (list, code, table, mark) | Satisfied after the R1 consistency pass added `Error::Invariant(&'static str)` to S1 §16; R2-44 made it `Cow<'static, str>` + `invariant!` (CR-24) |

### 0.4 Counts

See §5.0 for the counts from each section.

---

## 1. lexical_rich_nodes

One crate mirroring the `@lexical/*` packages Macro uses (model halves only). Split later only if
compile time demands it.

```
crates/client/lexical/lexical_rich_nodes/src/
  lib.rs          re-exports; register_rich_text_nodes(), register_all_nodes()
  heading.rs  quote.rs  rich_text/        §1a  (@lexical/rich-text)
  list/                                   §1a  (@lexical/list)
  link/                                   §1a  (@lexical/link, incl. AutoLink)
  hashtag/  overflow.rs                   §1a  (@lexical/hashtag, @lexical/overflow)
  tab.rs                                  §1a  (tab-indentation model; TabNode itself is core)
  plain_text.rs                           §1a.4b (@lexical/plain-text)
  clipboard/                              §1d  (@lexical/clipboard model half)
  <module>/html.rs                        §3   (feature "html": ExportDom impls for this crate's nodes)
  table/                                  §1b  (@lexical/table)
  code/                                   §1c  (@lexical/code-core; no tokenizer)
  mark/                                   §1c  (@lexical/mark)
  selection/                              §1c  (@lexical/selection)
  utils/                                  §1c  (@lexical/utils)
  text/                                   §1c  (@lexical/text, incl. text/entity.rs)
  offset/                                 §1c  (@lexical/offset)
```

`registerLexicalTextEntity` has one implementation: `text/entity.rs`. §1a.13 and §1c.5 both
describe it; §1c.5's `TextEntity` trait and transform pair is the API, and where the two differ
§1c.5 decides. §1a.13's `src/text_entity.rs` is that module, not a second copy, and hashtag uses it.

## 1a. lexical_rich_nodes: rich-text, list, link, hashtag, overflow, tab

Crate `crates/client/lexical/lexical_rich_nodes/`. Ports the node classes and the model halves of
`@lexical/rich-text`, `@lexical/plain-text`, `@lexical/list`, `@lexical/link`, `@lexical/hashtag` (with the
`registerLexicalTextEntity` helper from `@lexical/text`), `@lexical/overflow`, and the tab
indentation model from `@lexical/extension`. wasm32-safe, depends on `lexical_model`, `regress`
(feature `utf16`), `serde`, `serde_json`, `url`. `utils` and `selection` are modules of this crate
(§1c), not crates: every `lexical_utils::x` / `lexical_selection::x` below means
`crate::utils::x` / `crate::selection::x`.

### 1a.0 Conventions used in this section

Core names this section relies on. S1 (Revision R1) is the source of truth for every
`lexical_model` name and signature; these bullets only list the ones used most. They apply to
every section of S3 (§1–§4), not only §1a.

- A1 Node types (S1 §3.2–3.3). `trait NodeType { const TYPE: &'static str; type Kind; type Parent;
  fn as_parent(&self) -> &Self::Parent; fn as_parent_mut(&mut self) -> Option<&mut Self::Parent>; .. }`
  carries the type string and the superclass. `ElementNode`, `TextNode` (trait), `DecoratorNode`
  are the behaviour traits. A direct subclass of a base class uses `element_node_base!(X)`,
  `text_node_base!(X)` or `decorator_node_base!(X)` (`Parent` = the marker, or `Text` for text
  subclasses). The registered plain text type is `lexical_model::Text` (`Id<Text>`); its base
  fields are `TextData` (`text`, `format`, `style`, `mode`, `detail`). Element base fields are
  `ElementData`. Every `impl NodeType for X { const TYPE .. }` sketch below also has the
  `Kind`/`Parent`/`as_parent*` items, normally through those macros; they are omitted for brevity.
- A2 Tree reads are the `Read` trait (S1 §5.2), implemented by `EditorState`, `Transaction` and
  `StateRef`. Sketches below write `st: &EditorState`; any `impl Read` works. Names: `parent(k)`,
  `children(k)` (iterator; `children_keys(k) -> Result<Vec<NodeKey>>`), `first_child`,
  `last_child`, `next_sibling`, `prev_sibling`, `next_siblings(k)`, `prev_siblings`,
  `index_within_parent`, `children_size`, `is_empty(k)`, `is_attached(k)`, `is_parent_of(a, b)`,
  `first_descendant`, `last_descendant`, `text_content(k) -> Cow<str>`,
  `text_content_size(k) -> Utf16Offset`, `type_name(k) -> Result<&'static str>`,
  `kind(k) -> Option<NodeKind>`, `is::<T>(k)`, `cast::<T>(k) -> Option<Id<T>>`,
  `get::<T>(k) -> Option<&T>`, `element_data(k)`, `text_data(k)`, `is_root_or_shadow_root(k)`,
  `is_inline(k)`, `can_indent(k)`, `indent(k)`, `is_simple_text(k)`, `is_text_entity(k)`,
  `selection()`, `previous_selection()`. Element `format`/`direction`/`text_format`/`text_style`
  are fields of `element_data(k)`.
- A3 Tree writes on `Transaction` (S1 §7.3–7.6): `create(T) -> Result<Id<T>>` (applies a
  registered replacement, `$applyNodeReplacement`; the `Id<T>` may name the replacement, which
  `is::<T>`), `create_exact(T)` (no replacement), `create_text(&str)`, `copy_node(k, skip_reset)`
  (`$copyNode`: then the virtual `reset_on_copy`), `append(parent, &[k])`,
  `splice(parent, start: ChildIndex, delete_count: u32, &[k])`, `insert_before(k, new, restore)`,
  `insert_after(k, new, restore_selection)`, `replace(old, new, include_children)`,
  `remove(k, preserve_empty_parent)`, `mark_dirty(k)`, `set_indent(k, u32)`,
  `insert_new_after(k, SelectionSlot, restore)`, `collapse_at_start(k, SelectionSlot)`,
  `get_mut::<T>(k) -> Result<NodeMut<T>>` (`getWritable()` on the struct; works for an ancestor
  `T`), `update_node::<T>(k, |n| ..)`, `select_start(k)`, `select_end(k)`,
  `select_next(k, a, f)`, `select_previous(k, a, f)`, `set_selection`. Base-field setters are on
  the handles: `tx.element(k)?.set_format(..)/set_direction/set_text_format/set_text_style/
  set_style/select(..)` and `tx.text(k)?.set_text_content(..)/set_format/set_style/set_mode/
  set_detail/splice_text/split_text(&[Utf16Offset]) -> Vec<NodeKey>/merge_with_sibling/select(..)`.
  Every structural write dispatches to the node's override (CR-1).
- A4 Upstream helpers owned by other sections, called here by these names:
  `crate::utils::{find_matching_parent, get_nearest_block_element_ancestor_or_throw,
  handle_indent_and_outdent, insert_node_to_nearest_root_at_caret, InsertAtCaretOptions,
  get_nearest_node_of_type}`, `crate::selection::should_override_default_character_selection`
  (`$isParentRTL` and `$moveCharacter` are view-side, §1c.3.4), and from `lexical_model`:
  `Read::{adjacent_node, find_matching_parent}`, `Transaction::{select_all, normalize_selection,
  create_text, nodes_from_raw_text, insert_nodes, insert_nodes_at_selection,
  set_point_from_caret}` (S1 §9.4, §8.3), and `caret::{caret_from_point, normalize_caret,
  point_from_caret}`, `SiblingCaret::new`, `ChildCaret::new`, `SiblingCaret::rewind`
  (S1 §10.2, §10.5). Paragraph and Tab are `tx.create(Paragraph::default())` /
  `tx.create(Tab::default())`.
- A5 Configuration that a transform or plugin needs (autolink matchers, hashtag config) lives in
  an `ExtensionState` registered with `EditorBuilder::extension_state` and read with
  `tx.extension::<Config>()?` (S1 §14.3, CR-6). Transforms are plain `fn` items
  (`TransformFn<T> = fn(&mut Transaction<'_>, Id<T>) -> Result<(), Error>`).
- A6 Builders always name their mode: `Editor::builder(EditorMode::Headless)` or
  `Editor::builder(EditorMode::ViewAttached)` (S1 §4.2; there is no default). The S3 builders
  (`export_registry()`, `headless_editor()`, §4.0) are Headless and leave
  `opaque_unknown_types` off; collaborative document sessions turn it on (S1 D-23, S7 §2.2).

How each core requirement lands (S1 must provide; §0.3 has the status):

- CR-1 Override dispatch. `tx.append/splice/insert_after/insert_before/replace/remove/set_indent`
  and `Read::indent(k)` call the node's override. `ListNode::splice` and `ListItemNode`'s
  `append`, `set_indent`, `indent` (on `ElementNode`) and `replace`, `insert_after`, `remove` (the
  `common_node_hooks!` part of `ElementNode`, S1 §3.2 R2-38) depend on it.
- CR-2 Ancestry. A subclass names its superclass as `type Parent` in its **kind-trait** impl
  (`impl ElementNode for TaskListNode { type Parent = ListNode; … }`, S1 R2-38; the `NodeType` impl
  carries only `TYPE`, `Kind`, consts and `NodeType` methods) and embeds it:
  `struct TaskListNode { #[serde(flatten)] list: ListNode }` with `type Parent = ListNode`,
  `as_parent(&self) -> &ListNode { &self.list }`, `as_parent_mut(..) -> Some(&mut self.list)`.
  Then `tx.is::<ListNode>(k)`, `tx.get::<ListNode>(k)`, `tx.get_mut::<ListNode>(k)` and
  `tx.cast::<ListNode>(k)` accept a `TaskListNode` (upstream `instanceof`). Every hook a subclass
  does not override delegates to `Parent`, so subclasses inherit the parent's overrides without
  macros. `AutoLinkNode: Parent = LinkNode`, Macro `TaskListNode: Parent = ListNode`,
  `CustomCodeNode: Parent = CodeNode`, `CommentNode`/`SearchMatchNode: Parent = MarkNode`.
- CR-3 Replacement. `.replace::<Base, Sub>(with: fn(Base) -> Sub)`; `Sub`'s `Parent` chain must
  reach `Base` (`BuildError::ReplacementNotSubtype`). It makes `tx.create(base)` produce
  `with(base)`, makes JSON of `Base::TYPE` import as `Sub` (running `Sub`'s `update_from_json`,
  serializing as `Sub::TYPE`), and makes `.transform::<Base>(f)` also run for `Sub` (one level,
  upstream `registerNodeTransform` adds the listener to `replaceWithKlass`,
  `packages/lexical/src/LexicalEditor.ts:1351`).
- CR-4 Transform scope. A transform registered for `T` runs only for nodes whose type is exactly
  `T::TYPE` or its direct replacement (upstream keys transforms by `__type`,
  `packages/lexical/src/LexicalUpdates.ts:187`). Node-intrinsic transforms (upstream `$config
  {$transform}`) are `NodeType::static_transform`, collected by the registry along the `Parent`
  chain (`packages/lexical/src/LexicalEditor.ts:713`). Consequence: `.transform::<Text>` does not
  run for `HashtagNode`; `.transform::<LinkNode>` does not run for `AutoLinkNode`; the `ListNode`
  intrinsic transform does run for `TaskListNode`.
- CR-5 Tree-aware export. `adjust_export_json(&self, node: NodeView<'_>, json: &mut
  SerializedNode) -> Result<(), Error>` (a `common_node_hooks!` hook, overridden in the kind-trait
  impl; default: delegates to `Parent`), called after the
  framework wrote base keys (through virtual getters, so `indent` is already `Read::indent`),
  `type`, `version`, NodeState and the serde fields. `ListItemNode` uses it for `checked`
  (depends on the parent list type).
- CR-6 Transform configuration through `ExtensionState` (A5). Autolink and hashtag read their
  config with `tx.extension::<C>()`.

**Hook signatures (normative).** Every `NodeType`/`ElementNode`/`TextNode`/`DecoratorNode`
override in S3 has exactly the signature of the S1 §3.2 trait:

- Predicates take a view: `ElementNode` predicates `(&self, node: ElementView<'_>, ..)`;
  `TextNode` predicates `(&self, node: TextView<'_>)`; `DecoratorNode` predicates and
  `text_content` `(&self, node: DecoratorView<'_>)`, with `text_content -> Cow<'_, str>`;
  `is_parent_required(&self, node: <Kind>View<'_>)` (a `common_node_hooks!` hook).
- Mutating hooks are associated fns `(tx: &mut Transaction<'_>, this: Id<Self>, ..)`.
  `ElementNode`: `splice(tx, this, start: ChildIndex, delete_count: u32, nodes: &[NodeKey])`,
  `append`, `set_indent`, `insert_new_after(tx, this, selection: SelectionSlot,
  restore_selection: bool) -> Result<Option<NodeKey>>`, `collapse_at_start(tx, this, selection:
  SelectionSlot) -> Result<bool>`. The hook reads the selection it was given with
  `tx.range_at(selection)` (usually `Active`; `$splitNodeAtPoint` passes a detached slot), never
  `tx.range_selection()`. Common hooks, overridden in the kind-trait impl (`common_node_hooks!`,
  S1 R2-38): `remove`, `replace`, `insert_after`, `insert_before`,
  `reset_on_copy(tx, this, original: NodeKey)`, `create_parent_element(tx, this)`,
  `adjust_export_json`, `json_version`. `NodeType`: `import`, `default_node`, `flag_probe`.
  `ElementNode::indent(&self, node: ElementView<'_>) -> u32` is a predicate, not an associated fn.
- `exclude_from_copy(&self, node, destination: Option<CopyDestination>)`;
  `extract_with_child(&self, node, child: NodeKey, selection: Option<&Selection>,
  destination: CopyDestination)`; `CopyDestination::{Clone, Html}`.
- Constructor side effects on clone are `NodeType::after_clone(&self) -> Option<Self>` (CR-16);
  export post-processing is `adjust_export_json` (CR-5).
- Constructors and type-table flags (S1 §3.2 R2-43, R2.1). A node type whose `$createX` needs no
  argument writes `impl_default_node!()` in its `impl NodeType` (it is then also its `flag_probe`).
  Every other registered type implements `fn flag_probe() -> Option<Self>` with any valid instance,
  or sets `const FLAGS_PER_INSTANCE: bool = true` when an answer of `is_inline`,
  `can_insert_text_before`/`after`, `is_keyboard_selectable`, `is_isolated` or `is_shadow_root`
  depends on instance state; that state must be a serialized prop so the view's mirror can answer.
  A type with neither fails `build()` with `BuildError::NoFlagProbe`. The audit of S3's types is in
  "R2.1 consistency" (three per-instance types, all Macro).
- Not hooks in S1 (do not override): `isSimpleText`, `splitText`, `setTextContent` (Tab's override
  is `coerce_text_content`), `mergeWithSibling`, `select*`, `getTopLevelElement`. TableNode's
  `canSelectBefore` is a package trait reached through `node_trait`/`get_dyn` (CR-18).

Sketches below are written in a shorter shape (no `node` view, `&EditorState` arguments, a
`selection` reference instead of a slot, `-> String` for decorator text). The S1 signature
governs; the sketch gives only the override's semantics. If S1 renames a hook, S3 follows S1.

Upstream `invariant(false, msg)` in package or Macro code becomes `Err(Error::Invariant(msg.into()))`
or `invariant!(fmt, args…)` (S1 §16, CR-22/CR-24).

`Result<T>` in S3 sketches is each crate's own alias over its own `Error`, which wraps
`lexical_model::Error` (`#[error(transparent)] Model(#[from] lexical_model::Error)`, R2-45); hooks,
transforms and handlers registered with the core return `lexical_model::Error`. S1 exports no
`Result` alias.

### 1a.1 Module layout

```
lexical_rich_nodes/
  src/lib.rs                 re-exports, register_rich_text(), register_all_nodes()
  src/heading.rs             HeadingNode, HeadingTagType
  src/quote.rs               QuoteNode
  src/rich_text/mod.rs       RichTextConfig, escape-format triggers, register_rich_text
  src/rich_text/commands.rs  model halves of registerRichText command handlers
  src/list/mod.rs            ListType, ListNodeTagType, re-exports
  src/list/node.rs           ListNode
  src/list/item.rs           ListItemNode
  src/list/format.rs         formatList.ts
  src/list/utils.rs          utils.ts
  src/list/register.rs       registerList, registerListStrictIndentTransform, ListExtension
  src/list/check.rs          model half of checkList.ts
  src/link/mod.rs            re-exports
  src/link/node.rs           LinkNode, AutoLinkNode, attributes, sanitize_url, format_url
  src/link/transform.rs      link_node_transform ($linkNodeTransform)
  src/link/toggle.rs         toggle_link, LinkExtension command model
  src/link/auto.rs           LinkMatcher, RegexLinkMatcher, AutoLinkConfig, autolink transform
  src/text_entity.rs         registerLexicalTextEntity (generic)
  src/hashtag/mod.rs         HashtagNode, HashtagConfig, register_hashtag
  src/hashtag/regex.rs       hashtag pattern (built at first use)
  src/overflow.rs            OverflowNode
  src/tab.rs                 indent_over_tab, tab-indentation INDENT model
  src/normalize_triple_click.rs  (R2.1) §1a.18
  src/click_after_last_block.rs  (R2.1) §1a.19
```

`text_entity` is the one implementation of `@lexical/text` `registerLexicalTextEntity`; any other
crate needing it re-exports this module.

```rust
// src/lib.rs
pub mod heading; pub mod quote; pub mod rich_text; pub mod list; pub mod link;
pub mod text_entity; pub mod hashtag; pub mod overflow; pub mod tab;
pub mod normalize_triple_click; pub mod click_after_last_block;   // R2.1

/// HeadingNode + QuoteNode (RichTextExtension `nodes`).
pub fn register_rich_text_nodes(b: EditorBuilder) -> EditorBuilder;
```

### 1a.2 `heading`

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HeadingTagType { #[default] H1, H2, H3, H4, H5, H6 }

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HeadingNode {
    pub tag: HeadingTagType,
}
impl NodeType for HeadingNode { const TYPE: &'static str = "heading"; }

impl ElementNode for HeadingNode {
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot,
        restore_selection: bool /* upstream default true */) -> Result<Option<NodeKey>>;
    fn collapse_at_start(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot)
        -> Result<bool>;
    fn extract_with_child(&self, _: &EditorState, _: NodeKey, _: NodeKey, _: &Selection,
        _: CopyDestination) -> bool { true }
}

pub fn create_heading_node(tx: &mut Transaction, tag: HeadingTagType) -> Id<HeadingNode>;
pub fn is_heading_node(st: &EditorState, k: NodeKey) -> bool;      // st.is::<HeadingNode>(k)
pub fn get_tag(st: &EditorState, k: Id<HeadingNode>) -> Option<HeadingTagType>;
pub fn set_tag(tx: &mut Transaction, k: Id<HeadingNode>, tag: HeadingTagType) -> Result<()>;
```

JSON (`exportJSON`, key order): `children, direction, format, indent, type:"heading", version:1,
[$], [textFormat], [textStyle], tag`. Import calls `setTag(serialized.tag)` without validation; Rust
rejects tags outside `h1..h6` with a deserialization error (no stored doc has one).

`insert_new_after` (upstream `index.ts:374`), exactly:
0. `selection` below is `tx.range_at(slot).ok()`: the range in the slot the caller passed (S1 §3.2),
   `None` when that slot holds no range selection.
1. `anchor_offset = selection.map(|s| s.anchor.offset).unwrap_or(0)`.
2. `last = last_descendant(this)`. `is_at_end = last.is_none() || (selection.is_some() &&
   anchor.key == last && anchor_offset == text_content_size(last))`.
3. New node is a paragraph if `is_at_end || selection.is_none()`, else a heading with the same tag.
   Copy `direction` from `this`. `insert_after(this, new, restore_selection)`.
4. If `anchor_offset == 0 && !is_empty(this) && selection.is_some()`: create a paragraph, `select()`
   it (still detached), then `replace(this, paragraph, include_children = true)`. Note this fires for
   any offset-0 anchor, including offset 0 of a non-first text node. Port as is.
5. Return the node from step 3.

`collapse_at_start`: if empty, create paragraph, move all children into it, `replace(this, p,
false)`. Always return `true`.

### 1a.3 `quote`

```rust
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct QuoteNode {}
impl NodeType for QuoteNode { const TYPE: &'static str = "quote"; }

impl ElementNode for QuoteNode {
    /// New paragraph with this node's direction, inserted after. Returns it.
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot,
        restore_selection: bool) -> Result<Option<NodeKey>>;
    /// Always: move every child into a new paragraph, replace self with it, return true.
    fn collapse_at_start(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot)
        -> Result<bool>;
    fn can_merge_when_empty(&self) -> bool { true }
}

pub fn create_quote_node(tx: &mut Transaction) -> Id<QuoteNode>;
pub fn is_quote_node(st: &EditorState, k: NodeKey) -> bool;
```

JSON: plain element, `type:"quote"`. Quote passes `restoreSelection` through as `undefined`, which
`insertAfter` defaults to `true`; JS glue passes `true`.

### 1a.4 `rich_text`: model halves of `registerRichText`

`registerRichText` is a bag of command listeners at `COMMAND_PRIORITY_EDITOR`. The command bus stays
in JS (`registerRichText` in the JS shim keeps every `registerCommand`). Each listener calls one Rust
function below and does the DOM work itself (`preventDefault`, focus, clipboard, platform checks).
Return values mirror the listener's boolean.

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EscapeFormatTrigger { Enter, Click, Arrow, Space, Tab }

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TriggerConfig {
    pub enter: bool, pub click: bool, pub arrow: bool, pub space: bool, pub tab: bool,
    /// Only escape when the collapsed text caret is at a node boundary with no sibling that way.
    pub only_at_boundary: bool,
}

/// Ordered (upstream iterates `Object.entries`). `None` disables a format explicitly.
#[derive(Clone, Debug, PartialEq)]
pub struct EscapeFormatTriggerConfig(pub Vec<(Format, Option<TriggerConfig>)>);

impl Default for EscapeFormatTriggerConfig {
    /// capitalize, lowercase, uppercase -> {enter, space, tab}
    fn default() -> Self;
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RichTextConfig { pub escape_format_triggers: EscapeFormatTriggerConfig }
impl RichTextConfig {
    /// mergeRichTextConfig: per-format shallow merge of TriggerConfig; an override of None wins.
    pub fn merge(&self, overrides: &RichTextConfig) -> RichTextConfig;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EscapeDirection { Start, End, Both }

/// (R2-08) `selection` is a slot; writes go through `tx.toggle_selection_format_at(slot, ..)`.
pub fn escape_formats_for_trigger(tx: &mut Transaction, selection: SelectionSlot,
    trigger: EscapeFormatTrigger, direction: EscapeDirection, config: &EscapeFormatTriggerConfig) -> Result<()>;
```

`escape_formats_for_trigger` (`index.ts:592`): boundary is computed only for a collapsed `text`
anchor: `at_end = offset == size && next_sibling.is_none()`, `at_start = offset == 0 &&
prev_sibling.is_none()`; `Start`/`End`/`Both` pick which. For each `(format, Some(t))` whose trigger
flag is set: if `t.only_at_boundary`, skip unless boundary and the anchor text node has `format`,
and remember `did_escape_boundary`; then if `selection.has_format(format)` toggle it. After the loop,
if `did_escape_boundary`, `selection.set_style("")`.

Command model functions (`src/rich_text/commands.rs`):

```rust
/// CLICK: NodeSelection -> clear it, return true. RangeSelection -> escape(Click, Both), false.
pub fn click(tx: &mut Transaction, cfg: &EscapeFormatTriggerConfig) -> Result<bool>;
/// DELETE_CHARACTER: Range -> deleteCharacter(is_backward); Node -> deleteNodes; else false.
pub fn delete_character(tx: &mut Transaction, is_backward: bool) -> Result<bool>;
/// (R2-21) The handler passes the command's `target` and `character_target` through
/// (`Command::DeleteWord { direction, target, character_target }`, S1 §14.1).
pub fn delete_word(tx: &mut Transaction, direction: EditDirection, target: ModifyTarget, character_target: ModifyTarget) -> Result<bool>;
pub fn delete_line(tx: &mut Transaction, direction: EditDirection, target: ModifyTarget, character_target: ModifyTarget) -> Result<bool>;
/// CONTROLLED_TEXT_INSERTION with a string: insertText on any non-null selection, true.
/// Null selection with a string still returns true (upstream quirk).
pub fn controlled_text_insertion(tx: &mut Transaction, text: &str) -> Result<bool>;
pub fn remove_text(tx: &mut Transaction) -> Result<bool>;
pub fn format_text(tx: &mut Transaction, format: Format) -> Result<bool>;
/// FORMAT_ELEMENT: Range or Node selection; for each selected node, the nearest non-inline
/// element ancestor-or-self gets setFormat(format). True when the selection kind matched.
pub fn format_element(tx: &mut Transaction, format: ElementFormat) -> Result<bool>;
pub fn insert_line_break(tx: &mut Transaction, select_start: bool) -> Result<bool>;
pub fn insert_paragraph(tx: &mut Transaction) -> Result<bool>;
/// INSERT_TAB: TabNode with selection format/style when Range; $insertNodes([tab]); true.
pub fn insert_tab(tx: &mut Transaction) -> Result<bool>;
/// INDENT_CONTENT: handle_indent_and_outdent(|b| indent+1).
pub fn indent_content(tx: &mut Transaction) -> Result<bool>;
/// OUTDENT_CONTENT: handle_indent_and_outdent(|b| if indent>0 { indent-1 }).
pub fn outdent_content(tx: &mut Transaction) -> Result<bool>;

pub enum ArrowOutcome { NotHandled, Handled /* JS calls preventDefault */,
    /// The view calls `$moveCharacter(selection, shift, backward)` and preventDefault.
    MoveCharacter { backward: bool } }
/// KEY_ARROW_UP: NodeSelection with nodes -> selectPrevious on first, Handled.
/// Range, !shift, adjacent (backward) node is a non-isolated block decorator -> selectPrevious.
pub fn arrow_up(tx: &mut Transaction, shift: bool) -> Result<ArrowOutcome>;
/// KEY_ARROW_DOWN: NodeSelection -> first.selectNext(0,0). Range at end of root -> Handled
/// (swallow). Forward adjacent block decorator, !shift -> selectNext.
pub fn arrow_down(tx: &mut Transaction, shift: bool) -> Result<ArrowOutcome>;
/// KEY_ARROW_LEFT / RIGHT. `is_parent_rtl` comes from the view (`$isParentRTL` reads computed
/// style, §1c.3.4). NodeSelection -> select prev/next (swapped when `is_parent_rtl`), Handled.
/// Range: if !shift escape(Arrow, Start|End); if should_override_default_character_selection(sel,
/// backward) (left: true, right: false; `$isEditorVerticalOrientation` is view-side, so headless
/// callers pass these unadjusted) -> `MoveCharacter { backward }` and the view runs `$moveCharacter`
/// (`selection.modify`, DOM). Else NotHandled.
pub fn arrow_left(tx: &mut Transaction, shift: bool, is_parent_rtl: bool,
    cfg: &EscapeFormatTriggerConfig) -> Result<ArrowOutcome>;
pub fn arrow_right(tx: &mut Transaction, shift: bool, is_parent_rtl: bool,
    cfg: &EscapeFormatTriggerConfig) -> Result<ArrowOutcome>;

pub enum BackspaceAction { Outdent, DeleteCharacter, NotHandled }
/// KEY_BACKSPACE routing after the JS-side decorator-target and iOS ko-KR checks:
/// Range collapsed at front of an indented block -> Outdent; Range/Node -> DeleteCharacter.
pub fn backspace_action(st: &EditorState) -> BackspaceAction;
/// KEY_DELETE: Range or Node -> true (JS dispatches DELETE_CHARACTER(false)).
pub fn delete_key_applies(st: &EditorState) -> bool;

/// KEY_ENTER first half: a NodeSelection of exactly one block decorator becomes
/// `select_next()`; then if Range, escape(Enter, Both) and return true. JS then applies the
/// iOS/Safari beforeinput bail-out, Shift -> INSERT_LINE_BREAK(false), else INSERT_PARAGRAPH.
pub fn prepare_enter(tx: &mut Transaction, cfg: &EscapeFormatTriggerConfig) -> Result<bool>;
/// KEY_SPACE / KEY_TAB: escape(Space|Tab, Both) on Range. Always returns false.
pub fn escape_on_key(tx: &mut Transaction, trigger: EscapeFormatTrigger,
    cfg: &EscapeFormatTriggerConfig) -> Result<bool>;
/// MOVE_TO_END: Range anchor at element offset 0 of an element whose first child is an inline
/// decorator and whose last descendant is a non-decorator -> select_end(element); if shift keep
/// anchor at (element, 0). Handled.
pub fn move_to_end(tx: &mut Transaction, shift: bool) -> Result<ArrowOutcome>;
/// MOVE_TO_START: symmetric; both endpoints in the same block, focus not already at (block,0);
/// set focus (block,0) and, unless shift, anchor too.
pub fn move_to_start(tx: &mut Transaction, shift: bool) -> Result<ArrowOutcome>;
/// SELECT_ALL: `tx.select_all(None)` (S1 §9.4, R2-19). True.
pub fn select_all(tx: &mut Transaction) -> Result<bool>;
/// CUT second half (after JS copied to the clipboard): Range -> removeText; Node -> remove each.
pub fn cut_selection(tx: &mut Transaction) -> Result<()>;
/// DROP with files, after JS resolved caretFromPoint to (node, dom_offset): build a collapsed
/// point (text: node/offset; else parent/index+1), normalize, set selection.
pub fn set_drop_selection(tx: &mut Transaction, node: NodeKey, offset: Utf16Offset) -> Result<()>;
/// DROP of a Lexical drag (`$handleRichTextDrop` -> `$doDrop`, `clipboard.ts:260-362`): see
/// `clipboard::do_drop` (§1d). The view resolves the drop caret and the drag marker.
pub use crate::clipboard::do_drop;
/// CLEAR_EDITOR default `$onClear` (`@lexical/extension` ClearEditorExtension.ts:43, XB-04):
/// `had_selection = tx.selection().is_some()`; `root.clear()`; append a new paragraph; if
/// `had_selection`, `paragraph.select()`; then if the selection is a RangeSelection set its
/// `format` to 0. Returns true. Macro dispatches CLEAR_EDITOR
/// (`apps/web/src/features/channel/Input/tests/clear-composer.test.ts`).
pub fn clear_editor(tx: &mut Transaction) -> Result<bool>;

fn is_selection_at_end_of_root(st: &EditorState, sel: &RangeSelection) -> bool;
fn is_selection_collapsed_at_front_of_indented_block(st: &EditorState, sel: &RangeSelection)
    -> bool;
```

`is_selection_collapsed_at_front_of_indented_block` (`index.ts:536`): collapsed, `anchor.offset
== 0`, anchor node not root, `block = nearest block ancestor-or-self`, `indent(block) > 0` and
(`block == anchor_node` or `anchor_node == first_descendant(block)`).

`handle_indent_and_outdent` (owned by `crate::utils`, `packages/lexical-utils/src/index.ts:690`)
semantics relied on here: Range only; for each `selection.getNodes()`, take the nearest non-inline
element ancestor-or-self; if `can_indent` and not yet handled, call the closure once; return
`handled.len() > 0`. For a `ListItemNode` block, `set_indent` restructures the list (1a.6).

Headless dispatch order (lexical-service has no command bus): INSERT_PARAGRAPH is
`list::handle_list_insert_paragraph(tx, restore)` (LOW, runs first), then
`rich_text::insert_paragraph(tx)` if that returned false. INDENT under Macro is Macro's
`$handleIndentWithLimit` (LOW) before `indent_content` (EDITOR).

Stays in JS: `onPasteForRichText`/`PASTE_COMMAND` (reads `DataTransfer` and hands the strings to
`clipboard::insert_data_transfer_for_rich_text`, §1d), `COPY_COMMAND`, CUT clipboard write, `DRAGSTART`/`DRAGOVER`/`DROP`
DOM work and `DRAG_DROP_PASTE`, `eventFiles`, `$isTargetWithinDecorator` (DOM target to node; JS
then asks Rust `st.kind(k) == NodeKind::Decorator`), `KEY_ESCAPE` (`editor.blur()`), the
`CAN_USE_BEFORE_INPUT`/`navigator.language` checks, `CONTROLLED_TEXT_INSERTION`
with an `InputEvent` (`dataTransfer` path), every `event.preventDefault()`.

(R2.1) Platform branches that run inside a Rust handler (`IS_IOS`, `IS_ANDROID`, `IS_APPLE`,
`IS_SAFARI` = `AppleWebKit` engine on a non-iOS OS) read `tx.view_host()` (`ViewHost { engine:
ViewEngine, os: ViewOs }`, set by `EditorBuilder::view_host`, S1 §7.2/§15; `ViewEngine::Native` for
the native views), never a config field. The same holds for the Rust ports of Macro's
`native-ios-backspace` (`KEY_BACKSPACE` at LOW, `os == ViewOs::Ios`) and `word-navigation`
(`MOVE_TO_*` at HIGH) plugins (S12 §1.14). Where a branch also needs `navigator.language` (the
`IS_IOS && ko-KR` bail-out, R2-37), the JS glue keeps it.

### 1a.4b `plain_text`: model halves of `registerPlainText`

Upstream `packages/lexical-plain-text/src/index.ts:120-414`, all at `COMMAND_PRIORITY_EDITOR`.
Macro uses it in `apps/web/src/lib/core/component/LexicalMarkdown/plugins/pluginManager.ts:4` (the
`plain-text` node preset, `packages/lexical-core/node-list.ts:158`, pairs with it) and a resize test
fixture. The command bus stays in JS, as for rich text.

```rust
/// DELETE_CHARACTER/WORD/LINE: Range only (PT-01). Node and null selections -> false.
pub fn delete_character(tx: &mut Transaction, is_backward: bool) -> Result<bool>;
/// (R2-21) The handler passes the command's `target` and `character_target` through
/// (`Command::DeleteWord { direction, target, character_target }`, S1 §14.1).
pub fn delete_word(tx: &mut Transaction, direction: EditDirection, target: ModifyTarget, character_target: ModifyTarget) -> Result<bool>;
pub fn delete_line(tx: &mut Transaction, direction: EditDirection, target: ModifyTarget, character_target: ModifyTarget) -> Result<bool>;
/// CONTROLLED_TEXT_INSERTION with a string: Range only -> insertText, true; else false (PT-02).
pub fn controlled_text_insertion(tx: &mut Transaction, text: &str) -> Result<bool>;
/// INSERT_PARAGRAPH: Range -> `insertLineBreak(false)`, true (PT-05).
pub fn insert_paragraph(tx: &mut Transaction) -> Result<bool>;
/// KEY_BACKSPACE: Range -> DeleteCharacter (never Outdent, PT-07); else NotHandled.
pub fn backspace_action(st: &EditorState) -> rich_text::BackspaceAction;
/// KEY_ARROW_LEFT/RIGHT: Range and should_override_default_character_selection -> MoveCharacter;
/// no escape-format and no NodeSelection handling (PT-06).
pub fn arrow_horizontal(st: &EditorState, backward: bool, adjusted_is_backward: bool)
    -> rich_text::ArrowOutcome;
/// KEY_ENTER: Range -> true (the view applies the iOS/Safari bail-out, then dispatches
/// INSERT_LINE_BREAK(false) whatever shift is, PT-09).
pub fn enter_applies(st: &EditorState) -> bool;
/// CUT second half: Range -> removeText (PT-12). Node selections are not cut.
pub fn cut_selection(tx: &mut Transaction) -> Result<()>;
```

| Command | Plain text | Same as rich text? |
| --- | --- | --- |
| DELETE_CHARACTER/WORD/LINE | Range only | differs (rich also deletes NodeSelection) |
| CONTROLLED_TEXT_INSERTION | Range only; null selection -> false; `dataTransfer` -> `clipboard::insert_data_transfer_for_plain_text` | differs (rich: any non-null selection; null with a string -> true) |
| REMOVE_TEXT, INSERT_LINE_BREAK, SELECT_ALL, KEY_DELETE | Range only | `rich_text::remove_text`, `insert_line_break`, `select_all`, `delete_key_applies` reused unchanged except that they return false on a NodeSelection |
| INSERT_PARAGRAPH | `insertLineBreak()` | differs |
| KEY_BACKSPACE | never outdents | differs |
| KEY_ENTER | always line break | differs |
| KEY_ARROW_LEFT/RIGHT | move character only | differs |
| COPY/CUT/PASTE/DROP/DRAGSTART | view; model half `clipboard::*` with the plain inserter | — |
| CLICK, FORMAT_TEXT, FORMAT_ELEMENT, INDENT/OUTDENT, INSERT_TAB, ARROW_UP/DOWN, ESCAPE, SPACE, TAB, DRAGOVER, MOVE_TO_* | not handled (PT-15) | — |

`register_plain_text` registers no nodes. Mapping: `registerPlainText` ->
`plain_text::*` (Y, Macro); `PlainTextExtension` -> not ported (extension wrapper; its
NormalizeInlineElements dependency is §1a.17).

### 1a.5 `list::node` (`ListNode`)

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListType { Number, Bullet, Check }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListNodeTagType { Ul, Ol }

impl ListType {
    /// 'number' -> Ol, else Ul.
    pub fn tag(self) -> ListNodeTagType;
}

/// `tag` is derived from `list_type` and ignored on import (upstream `updateFromJSON` only calls
/// setListType + setStart).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "SerializedListNode", into = "SerializedListNode")]
pub struct ListNode {
    list_type: ListType,
    start: i32,
}
impl NodeType for ListNode { const TYPE: &'static str = "list"; }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SerializedListNode {
    list_type: ListType,
    start: i32,
    #[serde(default)]
    tag: Option<ListNodeTagType>,   // written as list_type.tag(); read and discarded
}

impl ListNode {
    pub fn new(list_type: ListType, start: i32) -> Self;   // upstream default ('number', 1)
    pub fn list_type(&self) -> ListType;
    pub fn tag(&self) -> ListNodeTagType;
    pub fn start(&self) -> i32;
    pub fn set_list_type(&mut self, t: ListType);          // also re-derives tag
    pub fn set_start(&mut self, start: i32);
}

/// Subclasses (Macro TaskListNode, `type Parent = ListNode`) inherit these through S1's
/// delegate-to-`Parent` defaults (CR-2); no macro is needed.
impl ElementNode for ListNode {
    fn can_be_empty(&self, _: ElementView<'_>) -> bool { false }
    fn can_indent(&self, _: ElementView<'_>) -> bool { false }
    fn splice(tx: &mut Transaction<'_>, this: Id<Self>, start: ChildIndex, delete_count: u32,
        nodes: &[NodeKey]) -> Result<(), Error> { list_splice(tx, this, start, delete_count, nodes) }
    fn extract_with_child(&self, node: ElementView<'_>, child: NodeKey, _: Option<&Selection>,
        _: CopyDestination) -> bool { node.state.is::<ListItemNode>(child) }
}

/// ListNode.splice: every inserted node that is not a ListItemNode is wrapped in
/// `create_list_item_node(this)`. A non-inline, non-list element is replaced by a TextNode of its
/// text content; inline elements, lists, text and decorators are appended as-is.
pub fn list_splice(tx: &mut Transaction, this: Id<ListNode>, start: ChildIndex, delete_count: u32,
    nodes: &[NodeKey]) -> Result<()>;
/// ListNode.createListItemNode hook (no subclass overrides it today): create_list_item_node(None).
pub fn create_list_item_node_for(tx: &mut Transaction, list: Id<ListNode>) -> Id<ListItemNode>;
/// Intrinsic transform ($config $transform): merge_next_sibling_list_if_same_type, then
/// update_children_list_item_value.
pub fn list_node_transform(tx: &mut Transaction, list: Id<ListNode>) -> Result<()>;

pub fn create_list_node(tx: &mut Transaction, list_type: ListType, start: i32) -> Id<ListNode>;
pub fn is_list_node(st: &EditorState, k: NodeKey) -> bool;   // st.is::<ListNode>(k): includes subclasses
```

JSON: `children, direction, format, indent, type:"list", version, [$], [textFormat], [textStyle],
listType, start, tag`. `start`/`value` are `i32`; a stored non-integer fails deserialization (JS
would keep it).

Macro `TaskListNode` (lives in Macro's node crate, shown for the contract):

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TaskListNode { #[serde(flatten)] pub list: ListNode }
impl NodeType for TaskListNode {
    const TYPE: &'static str = "task-list";
    type Kind = ElementKind;
    type Parent = ListNode;
    fn as_parent(&self) -> &ListNode { &self.list }
    fn as_parent_mut(&mut self) -> Option<&mut ListNode> { Some(&mut self.list) }
}
impl From<ListNode> for TaskListNode { fn from(list: ListNode) -> Self { Self { list } } }
impl ElementNode for TaskListNode {}   // every hook delegates to ListNode
// Editor::builder(EditorMode::Headless).node::<ListNode>().node::<TaskListNode>()
//     .replace::<ListNode, TaskListNode>(TaskListNode::from)
```

Same wire shape as `list` (`packages/lexical-core/nodes/TaskListNode.ts:57`); legacy `"type":"list"`
JSON deserializes to `TaskListNode` and re-serializes as `task-list` (CR-3). The view settings are
NodeState (`$.taskListView`), carried by core state, not a struct field. The replacement copies
only `listType` and `start` (`packages/lexical-core/node-list.ts:143`), which `From<ListNode>`
matches. Everything in 1a.5-1a.9 reads and writes through `Id<ListNode>`/`tx.get::<ListNode>` so it
works unchanged on `TaskListNode`.

### 1a.6 `list::item` (`ListItemNode`)

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ListItemNode {
    /// Raw stored value (`__checked`). Read through `get_checked`, not this field.
    #[serde(default, skip_serializing)]
    pub checked: Option<bool>,
    pub value: i32,
}
impl NodeType for ListItemNode { const TYPE: &'static str = "listitem"; }

impl NodeType for ListItemNode {
    const TYPE: &'static str = "listitem";
    // element_node_base!: Kind = ElementKind, Parent = ElementBase
    fn replace(tx: &mut Transaction<'_>, this: Id<Self>, replacement: NodeKey,
        include_children: bool) -> Result<NodeKey, Error>;
    fn insert_after(tx: &mut Transaction<'_>, this: Id<Self>, node: NodeKey,
        restore_selection: bool) -> Result<NodeKey, Error>;
    fn remove(tx: &mut Transaction<'_>, this: Id<Self>, preserve_empty_parent: bool)
        -> Result<(), Error>;
    /// CR-18. `if get_checked(original) == Some(true) { checked = Some(false) }` on `this`. The
    /// getter is parent-aware (`LexicalListItemNode.ts:387-392`): a stored `true` under a
    /// non-check list stays.
    fn reset_on_copy(tx: &mut Transaction<'_>, this: Id<Self>, original: NodeKey) -> Result<(), Error>;
    fn is_parent_required(&self, _: NodeView<'_>) -> bool { true }
    fn create_parent_element(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<NodeKey, Error>; // bullet list
    /// CR-5: inserts `checked` before `value` (see below). `indent` is already the virtual getter.
    fn adjust_export_json(&self, node: NodeView<'_>, json: &mut SerializedNode) -> Result<(), Error>;
}
impl ElementNode for ListItemNode {
    fn append(tx: &mut Transaction<'_>, this: Id<Self>, nodes: &[NodeKey]) -> Result<(), Error>;
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot,
        restore_selection: bool) -> Result<Option<NodeKey>, Error>;  // copy_node(this), insert after
    fn collapse_at_start(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot)
        -> Result<bool, Error>;
    fn indent(&self, node: ElementView<'_>) -> u32;              // = get_indent
    fn set_indent(tx: &mut Transaction<'_>, this: Id<Self>, indent: u32) -> Result<(), Error>;
    fn can_merge_with(&self, node: ElementView<'_>, other: NodeKey) -> bool; // ListItem | Paragraph
    fn extract_with_child(&self, node: ElementView<'_>, child: NodeKey,
        selection: Option<&Selection>, destination: CopyDestination) -> bool;
    fn can_merge_when_empty(&self, _: ElementView<'_>) -> bool { true }
}

pub fn create_list_item_node(tx: &mut Transaction, checked: Option<bool>) -> Id<ListItemNode>;
pub fn is_list_item_node(st: &EditorState, k: NodeKey) -> bool;
pub fn get_value(st: &EditorState, k: Id<ListItemNode>) -> i32;
pub fn set_value(tx: &mut Transaction, k: Id<ListItemNode>, value: i32) -> Result<()>;
/// `Some(stored.unwrap_or(false))` when the parent is a `check` list, else `None`.
pub fn get_checked(st: &EditorState, k: Id<ListItemNode>) -> Option<bool>;
pub fn set_checked(tx: &mut Transaction, k: Id<ListItemNode>, checked: Option<bool>) -> Result<()>;
/// Stored value negated; `None` becomes `Some(true)`.
pub fn toggle_checked(tx: &mut Transaction, k: Id<ListItemNode>) -> Result<()>;
/// Nesting depth when attached (count ListItem->List->ListItem hops), else stored indent.
pub fn get_indent(st: &EditorState, k: Id<ListItemNode>) -> u32;
/// Step-by-step: handle_indent / handle_outdent until get_indent == target.
pub fn set_indent(tx: &mut Transaction, k: Id<ListItemNode>, indent: u32) -> Result<()>;
/// Intrinsic transform ($config $transform), see below.
pub fn list_item_node_transform(tx: &mut Transaction, item: Id<ListItemNode>) -> Result<()>;
```

JSON (`exportJSON`): `children, direction, format, indent, type:"listitem", version, [$],
[textFormat], [textStyle], [checked], value`. The framework writes `indent` through
the virtual getter (`Read::indent` → `get_indent`, S1 §13.2); `adjust_export_json` inserts `checked`
(bool) before `value` only when `get_checked` is `Some` (JS drops `checked: undefined`). Import stores `checked` raw. Import ignores
`indent`: upstream `setIndent` on a detached item loops without effect, so the stored indent stays 0.
`set_indent` must reproduce that (detached item: no-op).

Override semantics:
- `append` (`LexicalListItemNode.ts:257`): for each node, if it is an element and
  `can_merge_with` (ListItem or Paragraph), append its children recursively through this override,
  then remove it; else base append.
- `replace` (`:273`): replacing with a ListItemNode is base replace (children not moved,
  `include_children` dropped, as upstream). Otherwise: `set_indent(this, 0)`; parent not a list ->
  return `with` unchanged (no-op). If `this` is the list's first child insert `with` before the list;
  if last, after; else copy the list, move all following siblings into the copy, insert `with` after
  the list and the copy after `with`. If `include_children` (requires `with` to be an element, else
  `Err(Invariant)`), splice `this`'s children at the end of `with` and remap element points on
  `this` to `(with, prev_size + offset)`. Remove `this`; remove the list if now empty.
- `insert_after` (`:341`): parent must be a list, else `Err(Invariant("insertAfter: list node is
  not parent of list item node"))`. ListItem -> base. Otherwise insert `node` after the list, move
  following siblings into a copy of the list inserted after `node`.
- `remove` (`:371`): base remove; then if the former previous and next siblings are both nested list
  items, `merge_lists(first_child(prev), first_child(next))` and remove `next`.
- `collapse_at_start` (`:405`): move children into a new paragraph. If the list has one child:
  nested (list's parent is a ListItem) -> remove the list, select the parent item; else insert the
  paragraph before the list, remove the list, remap element points on `this` to the paragraph.
  Otherwise insert the paragraph before the list and remove `this`. Return true.
- `extract_with_child` (`:529`): Range only; both endpoints inside `this` and
  `text_content(this).utf16_len() == selection.text_content().utf16_len()`.

`list_item_node_transform` (`:99`): parent is a list: `if get_checked(item).is_some() && list_type
!= Check { set_checked(None) }`, exactly upstream's `node.getChecked() != null` test. `get_checked` is
parent-aware and returns `None` unless the parent is a check list, so this branch never fires
(dead upstream; keep it as written and do **not** test the stored field). Stored `checked` is
cleared only by `update_children_list_item_value`, from the ListNode transform. Parent exists and is not a list: create the parent via
`create_parent_element` (must be a list, else `Err(Invariant)`), collect the contiguous run of
ListItem siblings on both sides in document order, insert the list before `this`, splice the run into
it. If the old parent is not root/shadow root, `insert_node_to_nearest_root_at_caret(list,
rewind(sibling_caret(list, Next)), {should_split: |_| false, remove_empty_destination: true})`, then
remove the old parent if empty and attached.

### 1a.7 `list::format` (formatList.ts)

```rust
pub fn insert_list(tx: &mut Transaction, list_type: ListType) -> Result<()>;
pub fn remove_list(tx: &mut Transaction) -> Result<()>;
pub fn merge_lists(tx: &mut Transaction, list1: Id<ListNode>, list2: Id<ListNode>) -> Result<()>;
pub fn update_children_list_item_value(tx: &mut Transaction, list: Id<ListNode>) -> Result<()>;
pub fn merge_next_sibling_list_if_same_type(tx: &mut Transaction, list: Id<ListNode>)
    -> Result<()>;
pub fn handle_indent(tx: &mut Transaction, item: Id<ListItemNode>) -> Result<()>;
pub fn handle_outdent(tx: &mut Transaction, item: Id<ListItemNode>) -> Result<()>;
pub fn handle_list_insert_paragraph(tx: &mut Transaction, restore_numbering: bool)
    -> Result<bool>;

fn is_selecting_empty_list_item(st: &EditorState, anchor: NodeKey, nodes: &[NodeKey]) -> bool;
fn create_list_or_merge(tx: &mut Transaction, node: NodeKey, list_type: ListType)
    -> Result<Id<ListNode>>;
fn append(tx: &mut Transaction, parent: NodeKey, nodes: &[NodeKey]) -> Result<()>; // splice at end
```

- `insert_list` (`formatList.ts:68`): no selection -> no-op. Any non-null selection (Range, Node,
  Table) starts with `nodes = selection.getNodes()` (`:71-72`). Only for a RangeSelection: `anchor` =
  first of `getStartEndPoints()`; anchor is root/shadow root: use `first_child.select_start().getNodes()`, or
  append a paragraph and use its selection's nodes. Else if selecting an empty list item: new list of
  `list_type`; if the item's parent is root/shadow root (orphan), replace the item with the list,
  create a new item, set its format to the old item's format, call `set_indent` on it while it is
  still detached (a no-op, so the indent is lost, as upstream `:91-97`), then append it; else if
  the anchor is a ListItem, move the parent list's children into the new list and replace the
  parent. Return. Then for each node: an empty, non-ListItem element not yet handled ->
  `create_list_or_merge` (this branch does not add the key to `handled`); a leaf, or an empty
  ListItem, walks up from `parent(leaf)` (or the node itself if it is an empty ListItem): a list
  ancestor is replaced by a new list of `list_type` holding its children (once per key); a node whose
  parent is root/shadow root is `create_list_or_merge`d (once per key). Any other node (a non-empty
  non-leaf that is not an empty element) is skipped (`parent = null`, `:122-126`).
- `append` goes through `tx.splice`, so `ListNode::splice` wraps non-items (CR-1).
- `create_list_or_merge` (`:160`): lists return themselves. Move `node`'s children into a new
  item; same-type previous sibling list: append the item and fold a same-type next list into it;
  else same-type next list: insert before its first child; else new list replaces `node`. Then
  copy format and indent to the item (after attach, so `set_indent` nests), remap element points on
  the target list to the item, remove `node`.
- `merge_lists` (`:224`): if `list1.last` and `list2.first` are both nested items, merge their inner
  lists recursively and remove `list2.first`. Append `list2`'s remaining children to `list1`; remove
  `list2`.
- `remove_list` (`:252`): Range only. Empty item selected -> its top list; else the top list of each
  leaf's nearest ListItem (`get_nearest_node_of_type::<ListItemNode>`). For each list, walk
  `get_all_list_items` in order, create a paragraph with `selection.style`/`selection.format` as
  text style/format, move the item's children in, chain-insert after the previous paragraph (first
  after the list), move points keyed on the item to `normalize_caret(child_caret(p, Next))`, remove
  the item; finally remove the list.
- `update_children_list_item_value` (`:323`): `value = start`; for each ListItem child set value if
  different; in non-check lists clear a stored `checked`; increment unless the item's first child is
  a list.
- `merge_next_sibling_list_if_same_type` (`:346`): next sibling is a list of the same type ->
  `merge_lists(list, next)`.
- `handle_indent` (`:362`): nested items return. Both siblings nested: append `this` to the
  previous inner list, then move the next inner list's children there and remove the next sibling.
  Only next nested: insert before its inner list's first child. Only previous nested: append to its
  inner list. Else (parent is a list): copy the item and the list, nest `this` in them, insert after
  the previous sibling / before the next / append to the parent.
- `handle_outdent` (`:436`): nested items return. Needs list -> item -> list ancestors. First child:
  insert before the grandparent item, remove the grandparent if the list emptied. Last child: insert
  after, same cleanup. Middle: split previous and next siblings into two copied item+list wrappers on
  either side of the grandparent, then `replace(grandparent, this)`.
- `handle_list_insert_paragraph` (`:503`): collapsed Range only. Target item: the anchor ListItem
  with no children, or the parent ListItem of a text anchor whose children are all text with
  `trim()` empty (JS `trim` whitespace set). Parent must be a list (`Err(Invariant)`). Grandparent
  root/shadow root: paragraph after the top list; grandparent ListItem: copy of it after it; else
  false. Set text style/format from the selection and select it. If the item has next siblings, a
  copied list with `start = restore_numbering ? start + index : 1` takes them (wrapped in a copied
  item when the replacement is an item). Then `remove_highest_empty_list_parent(item)`. True.

### 1a.8 `list::utils`

```rust
pub fn get_list_depth(st: &EditorState, list: Id<ListNode>) -> Result<u32>;
pub fn get_top_list_node(st: &EditorState, item: NodeKey) -> Result<Id<ListNode>>;
pub fn is_last_item_in_list(st: &EditorState, item: Id<ListItemNode>) -> bool;
/// Post-order: leaf items only; a nested item contributes its inner list's items.
pub fn get_all_list_items(st: &EditorState, list: Id<ListNode>) -> Vec<Id<ListItemNode>>;
/// ListItem whose first child is a list.
pub fn is_nested_list_node(st: &EditorState, k: NodeKey) -> bool;
pub fn find_nearest_list_item_node(st: &EditorState, k: NodeKey) -> Option<Id<ListItemNode>>;
pub fn remove_highest_empty_list_parent(tx: &mut Transaction, sublist: NodeKey) -> Result<()>;
pub fn get_new_list_start(st: &EditorState, list: Id<ListNode>, item: Id<ListItemNode>) -> i32;
```

`get_list_depth` starts at 1 and adds one per ListItem->List hop; a ListItem whose parent is not a
list is `Err(Invariant("A ListItemNode must have a ListNode for a parent."))`. `get_top_list_node`
errors when the direct parent is not a list, then keeps the outermost list ancestor.
`remove_highest_empty_list_parent` climbs while the node has no siblings and the parent is a list or
item, then removes the reached node.

### 1a.9 `list::register` and `list::check`

```rust
#[derive(Clone, Copy, Debug, Default)]
pub struct RegisterListOptions { pub restore_numbering: bool }

#[derive(Clone, Copy, Debug, Default)]
pub struct ListConfig { pub has_strict_indent: bool, pub should_preserve_numbering: bool }

/// Registers ListNode + ListItemNode. Their intrinsic transforms (list_node_transform,
/// list_item_node_transform) are each type's `NodeType::static_transform`, which the registry
/// also runs for every subtype whose `Parent` chain reaches it (S1 §3.2, §8.2; CR-4).
pub fn register_list_nodes(b: EditorBuilder) -> EditorBuilder;
/// registerList model part: the two style-sync transforms below. The command handlers are JS
/// glue over insert_list / update_list_start / remove_list / handle_list_insert_paragraph.
pub fn register_list(b: EditorBuilder, options: RegisterListOptions) -> EditorBuilder;
pub fn register_list_strict_indent_transform(b: EditorBuilder) -> EditorBuilder;
/// ListExtension: register_list_nodes + register_list(should_preserve_numbering)
/// + strict indent when has_strict_indent.
pub fn list_extension(b: EditorBuilder, config: ListConfig) -> EditorBuilder;

/// UPDATE_LIST_START_COMMAND: not a list -> false; number list -> set start and
/// update_children_list_item_value; true for any list.
pub fn update_list_start(tx: &mut Transaction, list: NodeKey, new_start: i32) -> Result<bool>;
/// ListItemNode transform: first child text -> copy its style/format to the item's text
/// style/format when different. No children -> if collapsed Range anchored on the item and the
/// selection's style/format differ, copy them.
pub fn list_item_text_style_transform(tx: &mut Transaction, item: Id<ListItemNode>) -> Result<()>;
/// TextNode transform: if the parent is a ListItem and this is its first child, sync as above.
pub fn list_text_node_transform(tx: &mut Transaction, text: Id<Text>) -> Result<()>;
/// ListNode transform for strict indent: BFS over the list and nested lists, applying
/// format_list_indent_strict to each item.
pub fn process_list_with_strict_indent(tx: &mut Transaction, list: Id<ListNode>) -> Result<()>;
fn format_list_indent_strict(tx: &mut Transaction, item: Id<ListItemNode>) -> Result<()>;
fn find_children_end_list_item_node(st: &EditorState, item: Id<ListItemNode>)
    -> Id<ListItemNode>;
```

`format_list_indent_strict` (`registerList.ts:153`): skip nested items and items not in a list.
`start` = nearest ancestor-or-self ListItem in a list with a ListItem previous sibling. None and
indent > 0 -> `set_indent(0)`. Else take the deepest last item under `start`'s previous sibling; if
its list depth + 1 < this item's list depth, `set_indent(prev_depth)`.

```rust
// list::check — model half of checkList.ts
/// KEY_ARROW_UP/DOWN when a check item has DOM focus: next/previous non-nested item across
/// nesting levels (climb li -> list -> li until a sibling exists, then descend first/last
/// children through nested lists).
pub fn find_check_list_item_sibling(st: &EditorState, item: Id<ListItemNode>, backward: bool)
    -> Option<Id<ListItemNode>>;
/// find_check_list_item_sibling + select_start. JS focuses the returned item's DOM.
pub fn select_check_list_item_sibling(tx: &mut Transaction, item: Id<ListItemNode>,
    backward: bool) -> Result<Option<Id<ListItemNode>>>;
/// KEY_ARROW_LEFT predicate: collapsed Range at element point or text offset 0 whose nearest
/// block is a ListItem in a check list and (element point or anchor is its first descendant).
/// JS focuses that item's DOM if not already active.
pub fn check_list_item_at_caret_start(st: &EditorState) -> Option<Id<ListItemNode>>;
```

INSERT_CHECK_LIST is `insert_list(Check)`. KEY_SPACE and click toggling call
`item::toggle_checked`; the hit test, focus, dedup window and update tags stay in JS.

### 1a.10 `link::node`

```rust
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LinkAttributes {
    pub rel: Option<String>, pub target: Option<String>, pub title: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AutoLinkAttributes { pub link: LinkAttributes, pub is_unlinked: Option<bool> }

/// Field order is JSON key order: rel, target, title, url. `None` serializes as null (upstream
/// always writes the three keys). Import maps "" / null / missing to None (`|| null`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LinkNode {
    #[serde(default, deserialize_with = "empty_as_none")] pub rel: Option<String>,
    #[serde(default, deserialize_with = "empty_as_none")] pub target: Option<String>,
    #[serde(default, deserialize_with = "empty_as_none")] pub title: Option<String>,
    pub url: String,
}
impl NodeType for LinkNode { const TYPE: &'static str = "link"; }

/// AutoLinkNode (`Parent = LinkNode`) inherits all of these and replaces only insert_new_after.
impl ElementNode for LinkNode {
    fn can_insert_text_before(&self, _: ElementView<'_>) -> bool { false }
    fn can_insert_text_after(&self, _: ElementView<'_>) -> bool { false }
    fn can_be_empty(&self, _: ElementView<'_>) -> bool { false }
    fn is_inline(&self, _: ElementView<'_>) -> bool { true }
    /// Range only; both endpoints inside and selection text non-empty.
    fn extract_with_child(&self, node: ElementView<'_>, child: NodeKey,
        selection: Option<&Selection>, destination: CopyDestination) -> bool;
    /// copy_node(this), insert after (restore_selection default true).
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot,
        restore_selection: bool) -> Result<Option<NodeKey>, Error>;
}

/// JSON adds isUnlinked after url. null / missing -> false.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct AutoLinkNode {
    #[serde(flatten)] pub link: LinkNode,
    #[serde(rename = "isUnlinked", default, deserialize_with = "null_as_false")]
    pub is_unlinked: bool,
}
impl NodeType for AutoLinkNode {
    const TYPE: &'static str = "autolink";
    type Kind = ElementKind;
    type Parent = LinkNode;   // as_parent: &self.link, as_parent_mut: Some(&mut self.link)
}
impl ElementNode for AutoLinkNode {
    // The LinkNode overrides are inherited through `Parent` (CR-2).
    /// New AutoLinkNode with the same url/rel/target/title/is_unlinked (not copy_node).
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot,
        restore_selection: bool) -> Result<Option<NodeKey>, Error>;
}

pub fn create_link_node(tx: &mut Transaction, url: &str, attrs: LinkAttributes) -> Id<LinkNode>;
pub fn is_link_node(st: &EditorState, k: NodeKey) -> bool;          // includes AutoLinkNode
pub fn create_auto_link_node(tx: &mut Transaction, url: &str, attrs: AutoLinkAttributes)
    -> Id<AutoLinkNode>;
pub fn is_auto_link_node(st: &EditorState, k: NodeKey) -> bool;
pub fn is_email_uri(link: &LinkNode) -> bool;     // url starts with "mailto:"
pub fn is_web_site_uri(link: &LinkNode) -> bool;  // "https://" or "http://"
/// Same exact type, url, target, rel, title. Always false when `a` is an AutoLinkNode.
pub fn should_merge_adjacent_link(st: &EditorState, a: Id<LinkNode>, b: Id<LinkNode>) -> bool;
/// formatUrl: has scheme /^[a-z][a-z0-9+.-]*:/i or starts with / # . -> unchanged;
/// contains '@' -> "mailto:"+; matches /^\+?[0-9\s()-]{5,}$/ -> "tel:"+; else "https://"+.
pub fn format_url(url: &str) -> String;
/// sanitizeUrl (used by lexical_html export): format_url, parse with the `url` crate (WHATWG);
/// protocol not in {http:, https:, mailto:, sms:, tel:} -> "about:blank"; parse error -> formatted.
pub fn sanitize_url(url: &str) -> String;
```

### 1a.11 `link::transform`, `link::toggle`

```rust
/// $linkNodeTransform (registered by LinkExtension for LinkNode only, CR-4).
pub fn link_node_transform(tx: &mut Transaction, link: Id<LinkNode>) -> Result<()>;
```
Semantics (`LexicalLinkNode.ts:335`): save each Range endpoint as a caret pair (next caret and its
flip). For each child that is a block element: if it has children, wrap them in `copy_node(link)`
appended to that block (`transformed`); lift the block to the nearest root via
`insert_node_to_nearest_root_at_caret(block, rewind(caret), {should_split: |_| false})`. If still
attached: previous sibling link that `should_merge_adjacent_link(prev, link)` absorbs `link`'s
children and `link` is removed; fix a caret pair whose sibling caret origin is the absorbing link to
`normalize_caret(child_caret(merging, Next))`; restore selection; return. Else a mergeable next
sibling link is absorbed into `link` (`transformed`). If not transformed, return. Empty
non-`can_be_empty` link is removed, and its parent if then empty. Restore selection: first attached
caret of each pair, normalized, then `normalize_selection`.

```rust
/// Upstream tri-state per attribute: Unset (key absent / undefined), Null, Value.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum AttrUpdate { #[default] Unset, Null, Value(String) }

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ToggleLinkAttributes { pub rel: AttrUpdate, pub target: AttrUpdate, pub title: AttrUpdate }

/// $toggleLink. `url: None` removes links. `rel: Unset` defaults to "noreferrer".
pub fn toggle_link(tx: &mut Transaction, url: Option<&str>, attributes: ToggleLinkAttributes)
    -> Result<()>;

pub enum ToggleLinkPayload { Remove, Url(String), WithAttributes { url: Option<String>,
    attributes: ToggleLinkAttributes } }
#[derive(Clone, Default)]
pub struct LinkConfig {
    pub validate_url: Option<Arc<dyn Fn(&str) -> bool + Send + Sync>>,
    pub attributes: Option<LinkAttributes>,
}
/// LinkExtension TOGGLE_LINK_COMMAND model: Remove -> toggle_link(None), true. Url -> rejected
/// (false) when validate_url says no, else toggle_link with config attributes. WithAttributes ->
/// toggle_link(url, payload rel/target/title, each `Unset` when absent from the payload), true.
/// Config attributes are **not** consulted: upstream builds `{...attributes, rel, target, title}`
/// from a destructured payload, so absent keys overwrite the config with `undefined`
/// (`LexicalLinkExtension.ts:77-83`); a missing `rel` then becomes `"noreferrer"` in toggle_link.
pub fn handle_toggle_link_command(tx: &mut Transaction, payload: &ToggleLinkPayload,
    config: &LinkConfig) -> Result<bool>;
/// PASTE model (only when validate_url is set): non-collapsed Range, validate_url(text), no
/// element among selected nodes -> toggle_link(text, config attributes), true.
pub fn paste_url_as_link(tx: &mut Transaction, clipboard_text: &str, config: &LinkConfig)
    -> Result<bool>;
/// LinkExtension: registers LinkNode + link_node_transform.
pub fn link_extension(b: EditorBuilder) -> EditorBuilder;

fn get_point_node(st: &EditorState, point: &Point, offset: i32) -> Result<Option<NodeKey>>;
fn with_selected_nodes<T>(tx: &mut Transaction, f: impl FnOnce(&mut Transaction) -> Result<T>)
    -> Result<T>;
fn split_link_at_selection(tx: &mut Transaction, parent_link: Id<LinkNode>, extracted: &[NodeKey])
    -> Result<()>;
```

`toggle_link` (`LexicalLinkNode.ts:740`), every `find_matching_parent` below excludes AutoLinkNode
except where noted. Step 0 (`:753`): `rel = Unset -> Value("noreferrer")`; after this rel is never
`Unset`, so every "when not `Unset`" below can skip only target and title:
1. Selection neither Range nor Node -> return.
2. NodeSelection (empty -> return): per node, remove: insert the node before its link ancestor and
   remove the link if childless. Add: update an existing link ancestor's url, and target/rel when not
   `Unset` (title ignored); else wrap the node in `create_link_node(url, {rel, target})` (no title).
3. Range collapsed and `url` is None: if `getNodes()` is empty, continue at step 4. Otherwise, for the
   first node only, if it has a link ancestor, splice the link's children into its parent at its
   index and remove it; return either way (`:809-828` returns inside the loop body).
4. `nodes = selection.extract()`. Remove: for each node's link ancestor (once per link),
   `split_link_at_selection`. Return.
5. Single node with any link ancestor including AutoLinkNode (`$findMatchingParent(n, $isLinkNode)`)
   -> update it (url, then target/rel/title when not `Unset`) and return.
6. `with_selected_nodes`: for each attached node: link ancestor -> update; block element -> skip;
   a LinkNode that is not an AutoLinkNode and no current link or not in the current link's parent ->
   update and adopt as current; other links (or AutoLinkNode) -> unwrap; previous sibling is the
   current link -> append into it; else new link (url, rel, target, title) inserted after the node,
   node appended into it, becomes current.

`with_selected_nodes` (`:635`): normalize the Range; remember the child node at anchor
(`-1` if backward) and focus (`-1` if forward) for element points; after `f`, re-anchor those
endpoints at `(parent, index + (backward ? 1 : 0))` / `(parent, index + (backward ? 0 : 1))` and set
the normalized selection.

`split_link_at_selection` (`:681`): a child is extracted if it is one of `extracted` or an element
containing one. All children extracted -> unwrap. Extracted run at start -> move before the link; at
end -> move after (reverse order); middle -> move after and put trailing children into
`copy_node(link)` after the last extracted child.

### 1a.12 `link::auto` (AutoLink)

```rust
/// Offsets are UTF-16 code units into the text passed to `find`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LinkMatcherResult {
    pub attributes: Option<AutoLinkAttributes>,
    pub index: Utf16Offset,
    pub length: u32,
    pub text: String,
    pub url: String,
}

pub trait LinkMatcher: Send + Sync {
    /// First match in `text`, or None. Must be stateless (always search from 0).
    fn find(&self, text: &str) -> Option<LinkMatcherResult>;
}

/// createLinkMatcherWithRegExp. Runs `regress::Regex::find_from_utf16(utf16(text), 0)`.
/// Divergence: a JS regex with the `g` flag keeps `lastIndex` between calls; this never does.
pub struct RegexLinkMatcher {
    pub regex: regress::Regex,
    pub url_transformer: Arc<dyn Fn(&str) -> String + Send + Sync>,   // default identity
}
impl LinkMatcher for RegexLinkMatcher { fn find(&self, text: &str) -> Option<LinkMatcherResult>; }
pub fn create_link_matcher_with_reg_exp(regex: regress::Regex,
    url_transformer: Option<Arc<dyn Fn(&str) -> String + Send + Sync>>) -> RegexLinkMatcher;

/// (R2.1, S1 §14.5) Replaces upstream's `ChangeHandler`: the transform calls
/// `tx.emit(&AUTO_LINK_CHANGED, AutoLinkChanged { url, prev_url })` where upstream calls
/// `onChange(url, prevUrl)`; the host reads `Commit::events_of(&AUTO_LINK_CHANGED)` or
/// `Effect::PluginEvent`. The event rolls back with the transaction.
#[derive(Clone, Debug, PartialEq)]
pub struct AutoLinkChanged { pub url: Option<String>, pub prev_url: Option<String> }
pub static AUTO_LINK_CHANGED: EventKey<AutoLinkChanged> = EventKey::new("autolink.changed");
pub type ExcludeParent = fn(StateRef<'_>, NodeKey) -> bool;   // R2-47, R2-53

#[derive(Clone)]
pub struct AutoLinkConfig {
    pub exclude_parents: Vec<ExcludeParent>,
    pub matchers: Vec<Arc<dyn LinkMatcher>>,
    /// Tested against one UTF-16 code unit. Default /[.,;\s]/.
    pub separator_regex: regress::Regex,
}
impl AutoLinkConfig {
    /// AutoLinkExtension mergeConfig: concatenates the three Vecs, overrides separator.
    pub fn merge(&self, overrides: AutoLinkConfig) -> AutoLinkConfig;
}

/// registerAutoLink model part: AutoLinkNode + the TextNode transform below. CR-6: `config` is
/// registered with `EditorBuilder::extension_state`, and the transform (a `fn` item) reads it with
/// `tx.extension::<AutoLinkConfig>()` (clone the `Arc`s out before writing, S1 §7.2).
pub fn register_auto_link(b: EditorBuilder, config: AutoLinkConfig) -> EditorBuilder;
/// The TextNode transform (`TransformFn<Text>`).
pub fn auto_link_text_transform(tx: &mut Transaction, text: Id<Text>) -> Result<()>;
/// TOGGLE_LINK_COMMAND with payload null at LOW priority: for each extracted node whose parent
/// is an AutoLinkNode, flip is_unlinked and mark_dirty. JS returns false so LinkExtension's handler
/// still runs.
pub fn toggle_auto_link_unlinked(tx: &mut Transaction) -> Result<()>;

fn find_first_match(text: &str, matchers: &[Arc<dyn LinkMatcher>]) -> Option<LinkMatcherResult>;
fn is_separator(ch: Option<u16>, sep: &regress::Regex) -> bool;
fn starts_with_separator(text: &str, sep: &regress::Regex) -> bool;
fn ends_with_separator(text: &str, sep: &regress::Regex) -> bool;
fn starts_with_tld(text: &str, is_email: bool) -> bool;   // /^\.[a-zA-Z]{2,}/ | /^\.[a-zA-Z0-9]{1,}/
fn is_previous_node_valid(st: &EditorState, node: NodeKey, sep: &regress::Regex) -> bool;
fn is_next_node_valid(st: &EditorState, node: NodeKey, sep: &regress::Regex) -> bool;
fn is_content_around_is_valid(st: &EditorState, match_start: u32, match_end: u32,
    sep: &regress::Regex, text: &[u16], nodes: &[NodeKey]) -> bool;
fn extract_matching_nodes(st: &EditorState, nodes: &[NodeKey], start: u32, end: u32)
    -> (u32, Vec<NodeKey>, Vec<NodeKey>, Vec<NodeKey>);
fn create_auto_link_node_from(tx: &mut Transaction, nodes: &[NodeKey], start: u32, end: u32,
    m: &LinkMatcherResult) -> Result<Option<NodeKey>>;
fn handle_link_creation(tx: &mut Transaction, nodes: &[NodeKey], cfg: &AutoLinkConfig)
    -> Result<()>;
fn handle_link_edit(tx: &mut Transaction, link: Id<AutoLinkNode>, cfg: &AutoLinkConfig)
    -> Result<()>;
fn handle_bad_neighbors(tx: &mut Transaction, text: Id<Text>, cfg: &AutoLinkConfig)
    -> Result<()>;
fn replace_with_children(tx: &mut Transaction, node: NodeKey) -> Result<Vec<NodeKey>>;
fn get_text_nodes_to_match(st: &EditorState, text: NodeKey) -> Vec<NodeKey>;
```

All offsets and lengths here are UTF-16; `text[i]` is a code unit. `is_separator(None, ..)`
reproduces JS `regex.test(undefined)`, which tests the string `"undefined"`: false for the default
separator, but a custom separator matching a letter of "undefined" returns true.

Transform (`LexicalAutoLinkExtension.ts:561`): parent is an AutoLinkNode -> `handle_link_edit(parent)`.
Else if the parent is not a link and no `exclude_parents` predicate matches: if simple text and
(starts with a separator or the previous sibling is not an AutoLinkNode) ->
`handle_link_creation(get_text_nodes_to_match(text))`; then `handle_bad_neighbors(text)`.

- `get_text_nodes_to_match` (`:507`): this node plus following simple-text siblings, stopping after
  the first one containing `\s`.
- `handle_link_creation` (`:293`): any node whose parent is a linked (not unlinked) AutoLinkNode ->
  return. Loop `find_first_match` on the remaining `text`, tracking `invalid_match_end`. A match is
  valid when the code unit before (or the previous node via `is_previous_node_valid`) and after (or
  `is_next_node_valid`) are separators, evaluated on the initial concatenated text. Valid: split out
  matching nodes; skip if any is already inside a linked AutoLinkNode (advance); else build the link
  and continue on `[remaining, ...after]` with `invalid_match_end = 0`, calling
  `on_change(url, None)`. Invalid: `invalid_match_end += match_end`. Always `text =
  text[match_end..]`. The "already inside a linked AutoLinkNode" skip is exactly the invalid
  branch: `invalid_match_end += match_end; text = text[match_end..]; continue` (`:342-346`).
- `is_previous_node_valid` / `is_next_node_valid` (`:119`, `:135`): sibling (descending to last /
  first descendant when an element) is absent, a LineBreak, or text ending / starting with a
  separator.
- `create_auto_link_node_from` (`:214`): one node: split `[start,end)`, new TextNode with the match
  text and the split part's format/detail/style inside the autolink, replace the split part, return
  the remainder. Several nodes: split the first at `start`, collect whole following nodes up to `end`
  and split the one crossing it; copy the first part into a fresh TextNode, append it plus the
  collected nodes to the autolink; if the selection's first text node was that first part, reselect
  (Range: same anchor/focus offsets on the new node; Node: whole text); replace the first part with
  the link; return the remainder.
- `handle_link_edit` (`:369`): unwrap with `on_change(None, url)` when a child is not simple text,
  when the text is not a full match (`match.text != text`), or when a neighbor is invalid. Else, as
  upstream `:406-424`: if `url != match.url`, `set_url(match.url)` and `on_change(match.url, url)`; if
  the match has attributes: if `rel != match.attributes.rel`, `set_rel(match.attributes.rel or None)`
  and `on_change(rel, old_rel)`; same for `target`. Nothing is written (so the node is not marked
  dirty) when the values are equal. `x or None` is JS `|| null` (empty string -> None, rule 8).
- `handle_bad_neighbors` (`:429`): skip when inside a linked AutoLinkNode. Previous sibling linked
  AutoLinkNode (still adjacent, same parent): text not starting with a separator -> unwrap it,
  `on_change(None, url)`, return; starts with a TLD continuation (`starts_with_tld(text,
  is_email_uri)`) and the concatenation fully matches -> append the text node into the link,
  `handle_link_edit`, `on_change(None, url)`, then **continue** to the next-sibling check (no return,
  `:463-492`). Next sibling linked AutoLinkNode and text not ending in
  a separator (still adjacent) -> unwrap, `on_change(None, url)`.
- `replace_with_children` (`:495`): insert children after the node in reverse, remove it.

Macro does not register upstream autolink; its own matcher (`apps/web/src/lib/core/component/
LexicalMarkdown/plugins/links/autoLink.ts`, `findNextAutoLinkMatch`) becomes a Macro
`impl LinkMatcher` or its own transform; it only needs `AutoLinkNode` from here.

### 1a.13 `text_entity` and `hashtag`

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EntityMatch { pub start: Utf16Offset, pub end: Utf16Offset }
pub type GetMatch = Arc<dyn Fn(&str) -> Option<EntityMatch> + Send + Sync>;
pub type CreateEntity<T> = Arc<dyn Fn(&mut Transaction, NodeKey) -> Result<Id<T>> + Send + Sync>;

/// Per-entity configuration, an `ExtensionState` keyed by `T` (CR-6): the JS closures over
/// `getMatch`/`createNode` become this value.
#[derive(Clone)]
pub struct TextEntityConfig<T> { pub get_match: GetMatch, pub create: CreateEntity<T> }
/// registerLexicalTextEntity: a TextNode transform plus a reverse transform on T (CR-4: T's own
/// type only). Registers `TextEntityConfig<T>` and the two generic `fn` transforms, which read it
/// with `tx.extension::<TextEntityConfig<T>>()`.
pub fn register_lexical_text_entity<T: TextNode + NodeType>(b: EditorBuilder,
    get_match: GetMatch, create: CreateEntity<T>) -> EditorBuilder;
pub fn text_entity_text_transform<T: TextNode + NodeType>(tx: &mut Transaction,
    node: Id<Text>) -> Result<()>;
pub fn text_entity_reverse_transform<T: TextNode + NodeType>(tx: &mut Transaction, node: Id<T>)
    -> Result<()>;
fn replace_with_simple_text(tx: &mut Transaction, node: NodeKey) -> Result<()>;
```

`replace_with_simple_text`: new TextNode with the same text and format only (style and detail are
dropped, as upstream), `replace`.

Text transform (`registerLexicalTextEntity.ts:60`), with `is_target(k) = st.is::<T>(k)` and all
slicing in UTF-16:
1. Not simple text -> return.
2. Previous sibling is text: `combined = prev + text`, `prev_match = get_match(combined)`. If prev is
   a target: no match or prev mode != normal -> replace prev with simple text, return; else
   `diff = prev_match.end - prev_len`; if `diff > 0`, select prev, set prev text to
   `prev + text[..diff]`, remove this node if `diff == len` else set its text to `text[diff..]`,
   return. If prev is not a target and (no match or `prev_match.start < prev_len`) -> return.
3. Loop: `m = get_match(text)`; `text = m ? text[m.end..] : ""`. If `text` is empty and the next
   sibling is text: `next_match = get_match(current + next)`; none -> next target is replaced with
   simple text, a non-target next is `mark_dirty`ed; return. `next_match.start != 0` -> return.
   No `m` -> return. `m.start == 0` and prev is a text entity -> `skip += m.end`, continue. Split
   (`m.start == 0`: at `m.end`; else at `m.start+skip, m.end+skip`), `create` the replacement, copy
   format, `replace`. No remainder -> return. `skip = 0`, prev = replacement.

Reverse transform (`:174`): no match or `start != 0` -> simple text; text longer than `end` -> split
at `end`, return; previous sibling text entity -> both become simple text; next sibling text entity
-> it becomes simple text, and this node too if still a target.

```rust
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HashtagNode {}
impl NodeType for HashtagNode { const TYPE: &'static str = "hashtag"; }
impl TextNode for HashtagNode {
    fn can_insert_text_before(&self) -> bool { false }
    fn is_text_entity(&self) -> bool { true }
}
pub fn create_hashtag_node(tx: &mut Transaction, text: &str) -> Id<HashtagNode>;
pub fn is_hashtag_node(st: &EditorState, k: NodeKey) -> bool;

#[derive(Clone)]
pub struct HashtagConfig { pub get_hashtag_match: GetMatch }   // default: get_hashtag_match
impl Default for HashtagConfig { fn default() -> Self; }
/// HashtagExtension / registerLexicalHashtag: HashtagNode + register_lexical_text_entity with
/// create = |tx, k| create_hashtag_node(tx, &tx.text_content(k)).
pub fn register_hashtag(b: EditorBuilder, config: HashtagConfig) -> EditorBuilder;
/// `REGEX.exec(text)`: start = index + len(group1); end = start + len(group3) + 1 (UTF-16).
pub fn get_hashtag_match(text: &str) -> Option<EntityMatch>;
```

JSON: TextNode JSON with `type:"hashtag"`.

Hashtag regex (`hashtag/regex.rs`, built once in a `OnceLock<regress::Regex>`):
`(^|$|[^&/{AN}])([#＃])([{AN}]*[{ALPHA}][{AN}]*)` with `ALPHA = unicodeLetters + latinAccents +
nonLatinChars + cjkChars`, `AN = ALPHA + unicodeAccents + unicodeDigits + "_"`, copied from
`LexicalHashtagExtension.ts:24-215` with every JS `\xNN`/`\uNNNN` written as a regress `\uNNNN`
escape. Compile with flags `"i"` and without `u`, and match with `find_from_utf16` so the class
works on UTF-16 code units exactly as JS does. Upstream builds three "astral" ranges with
`String.fromCharCode`, which truncates to 16 bits: `0x2a700-0x2b73f`, `0x2b740-0x2b81f`,
`0x2f800-0x2fa1f` are really `꜀-뜿`, `띀-렟`, `-﨟`. Emit those truncated
ranges; do not "fix" them, or hashtag boundaries change for Hangul and CJK compatibility text
(Q17: copy; confirmed at `LexicalHashtagExtension.ts:91-108`). The `i` flag here needs mitigation
M-I (§2.9): with stock regress `#K` (Kelvin sign) and `#ſ` classify differently from V8.

### 1a.14 `overflow`

```rust
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct OverflowNode {}
impl NodeType for OverflowNode { const TYPE: &'static str = "overflow"; }
impl ElementNode for OverflowNode {
    /// Delegates to the parent: parent's insert_new_after(selection, restore_selection).
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot,
        restore_selection: bool) -> Result<Option<NodeKey>>;
    fn exclude_from_copy(&self, _: CopyDestination) -> bool { true }
}
/// Intrinsic transform: remove when empty.
pub fn overflow_node_transform(tx: &mut Transaction, node: Id<OverflowNode>) -> Result<()>;
pub fn create_overflow_node(tx: &mut Transaction) -> Id<OverflowNode>;
pub fn is_overflow_node(st: &EditorState, k: NodeKey) -> bool;
```

JSON: plain element, `type:"overflow"`. `isInline` is not overridden upstream (stays false).

### 1a.15 `tab`

`TabNode`, `create_tab_node` and `INSERT_TAB` insertion live in `lexical_model` /
`rich_text::insert_tab`. This module ports the model half of `@lexical/extension`
`TabIndentationExtension`.

```rust
/// $indentOverTab: true if any selected block can indent, or the first point (by order) equals the
/// normalized start of its can-indent block. False -> JS dispatches INSERT_TAB instead.
pub fn indent_over_tab(st: &EditorState, selection: &RangeSelection) -> Result<bool>;
/// TabIndentation INDENT_CONTENT handler (CRITICAL): handle_indent_and_outdent where each block
/// that passes `can_indent` gets indent+1 unless `max_indent` is set and indent+1 >= max_indent
/// (upstream `!max || new < max`, so max_indent = Some(0) means unlimited).
pub fn indent_with_limit(tx: &mut Transaction, max_indent: Option<u32>,
    can_indent: &dyn Fn(&EditorState, NodeKey) -> bool) -> Result<bool>;
```

Macro does not use `TabIndentationExtension`. Its own plugin
(`apps/web/src/lib/core/component/LexicalMarkdown/plugins/tab-indentation/tabIndentationPlugin.ts`)
maps Tab/Shift+Tab straight to INDENT/OUTDENT (never INSERT_TAB) and overrides INDENT at LOW with
`$handleIndentWithLimit`: skip `code`/`quote`/`heading` blocks, allow indent only while
`indent < prev_sibling_indent + 1`. It calls upstream `$findMatchingParent`, `getIndent`/`setIndent`
(the ListItemNode override does the nesting) and relies on `rich_text::outdent_content` for OUTDENT.
Its Rust port is a Macro-crate function over `find_matching_parent` and `tx.set_indent`.

### 1a.16 Mapping tables

Rich text and heading/quote (`packages/lexical-rich-text/src/…`):

| Rust item | Ports | Source (file:line) | Used by Macro | Notes |
| --- | --- | --- | --- | --- |
| `HeadingNode`, `HeadingTagType` | `HeadingNode`, `HeadingTagType` | packages/lexical-rich-text/src/index.ts:226, :223 | Y | |
| `heading::get_tag`/`set_tag` | `getTag`/`setTag` | packages/lexical-rich-text/src/index.ts:248, :252 | Y | |
| `HeadingNode` serde | `importJSON`/`updateFromJSON`/`exportJSON` | packages/lexical-rich-text/src/index.ts:354, :360, :366 | Y | |
| `HeadingNode::insert_new_after` | `insertNewAfter` | packages/lexical-rich-text/src/index.ts:374 | Y | |
| `HeadingNode::collapse_at_start` | `collapseAtStart` | packages/lexical-rich-text/src/index.ts:400 | Y | |
| `HeadingNode::extract_with_child` | `extractWithChild` | packages/lexical-rich-text/src/index.ts:410 | Y | |
| `create_heading_node`, `is_heading_node` | `$createHeadingNode`, `$isHeadingNode` | packages/lexical-rich-text/src/index.ts:449, :455 | Y | |
| `QuoteNode` | `QuoteNode` | packages/lexical-rich-text/src/index.ts:133 | Y | |
| `QuoteNode::insert_new_after` | `insertNewAfter` | packages/lexical-rich-text/src/index.ts:192 | Y | |
| `QuoteNode::collapse_at_start` | `collapseAtStart` | packages/lexical-rich-text/src/index.ts:200 | Y | |
| `QuoteNode::can_merge_when_empty` | `canMergeWhenEmpty` | packages/lexical-rich-text/src/index.ts:208 | Y | |
| `create_quote_node`, `is_quote_node` | `$createQuoteNode`, `$isQuoteNode` | packages/lexical-rich-text/src/index.ts:213, :217 | Y | |
| `EscapeFormatTrigger`, `TriggerConfig`, `EscapeFormatTriggerConfig` | same | packages/lexical-rich-text/src/index.ts:565, :577, :588 | Y | default config only |
| `escape_formats_for_trigger` | `$escapeFormatsForTrigger` | packages/lexical-rich-text/src/index.ts:592 | Y | |
| `EscapeFormatTriggerConfig::default` | `DEFAULT_ESCAPE_FORMAT_TRIGGERS` | packages/lexical-rich-text/src/index.ts:645 | Y | |
| `RichTextConfig`, `RichTextConfig::merge` | `RichTextConfig`, `mergeRichTextConfig` | packages/lexical-rich-text/src/LexicalRichTextExtension.ts:53, :86 | N | Macro calls `registerRichText` directly |
| `register_rich_text_nodes` | `RichTextExtension` `nodes` | packages/lexical-rich-text/src/LexicalRichTextExtension.ts:100 | N | |
| `click` | CLICK handler | packages/lexical-rich-text/src/index.ts:658 | Y | via `registerRichText` |
| `delete_character` | DELETE_CHARACTER handler | packages/lexical-rich-text/src/index.ts:678 | Y | |
| `delete_word` | DELETE_WORD handler | packages/lexical-rich-text/src/index.ts:693 | Y | |
| `delete_line` | DELETE_LINE handler | packages/lexical-rich-text/src/index.ts:705 | Y | |
| `controlled_text_insertion` | CONTROLLED_TEXT_INSERTION (string) | packages/lexical-rich-text/src/index.ts:717 | Y | InputEvent path stays JS |
| `remove_text` | REMOVE_TEXT handler | packages/lexical-rich-text/src/index.ts:746 | Y | |
| `format_text` | FORMAT_TEXT handler | packages/lexical-rich-text/src/index.ts:758 | Y | |
| `format_element` | FORMAT_ELEMENT handler | packages/lexical-rich-text/src/index.ts:770 | Y | |
| `insert_line_break` | INSERT_LINE_BREAK handler | packages/lexical-rich-text/src/index.ts:792 | Y | |
| `insert_paragraph` | INSERT_PARAGRAPH handler | packages/lexical-rich-text/src/index.ts:804 | Y | |
| `insert_tab` | INSERT_TAB handler | packages/lexical-rich-text/src/index.ts:816 | Y | |
| `indent_content` | INDENT_CONTENT handler | packages/lexical-rich-text/src/index.ts:830 | Y | Macro's LOW handler runs first |
| `outdent_content` | OUTDENT_CONTENT handler | packages/lexical-rich-text/src/index.ts:840 | Y | |
| `arrow_up`, `arrow_down` | KEY_ARROW_UP/DOWN handlers | packages/lexical-rich-text/src/index.ts:852, :882 | Y | |
| `arrow_left`, `arrow_right` | KEY_ARROW_LEFT/RIGHT handlers | packages/lexical-rich-text/src/index.ts:916, :955 | Y | |
| `backspace_action` | KEY_BACKSPACE handler | packages/lexical-rich-text/src/index.ts:994 | Y | |
| `delete_key_applies` | KEY_DELETE handler | packages/lexical-rich-text/src/index.ts:1020 | Y | |
| `prepare_enter` | KEY_ENTER handler | packages/lexical-rich-text/src/index.ts:1035 | Y | |
| `set_drop_selection` | DROP handler (files) | packages/lexical-rich-text/src/index.ts:1102 | Y | caretFromPoint stays JS |
| `select_all` | SELECT_ALL handler | packages/lexical-rich-text/src/index.ts:1189 | Y | |
| `cut_selection` | `onCutForRichText` model half | packages/lexical-rich-text/src/index.ts:484 | Y | |
| `escape_on_key` | KEY_SPACE / KEY_TAB handlers | packages/lexical-rich-text/src/index.ts:1244, :1262 | Y | |
| `move_to_end`, `move_to_start` | MOVE_TO_END / MOVE_TO_START handlers | packages/lexical-rich-text/src/index.ts:1280, :1318 | Y | |
| `is_selection_at_end_of_root` | `$isSelectionAtEndOfRoot` | packages/lexical-rich-text/src/index.ts:531 | Y | private |
| `is_selection_collapsed_at_front_of_indented_block` | same | packages/lexical-rich-text/src/index.ts:536 | Y | private |

List (`packages/lexical-list/src/…`):

| Rust item | Ports | Source (file:line) | Used by Macro | Notes |
| --- | --- | --- | --- | --- |
| `ListType`, `ListNodeTagType` | `ListType`, `ListNodeTagType` | packages/lexical-list/src/LexicalListNode.ts:50, :52 | Y | |
| `ListNode` (+ serde via `SerializedListNode`) | `ListNode`, `SerializedListNode` | packages/lexical-list/src/LexicalListNode.ts:55, :41 | Y | |
| `ListNode::new` | constructor (`TAG_TO_LIST_TYPE`) | packages/lexical-list/src/LexicalListNode.ts:84, :366 | Y | `ol`/`ul` aliases not accepted |
| `ListNode::{tag, list_type, start, set_list_type, set_start}` | getters/setters | packages/lexical-list/src/LexicalListNode.ts:99-121 | Y | |
| serde import/export | `updateFromJSON`/`exportJSON` | packages/lexical-list/src/LexicalListNode.ts:157, :179 | Y | |
| `impl ElementNode for ListNode` (`can_be_empty`, `can_indent`) | `canBeEmpty`, `canIndent` | packages/lexical-list/src/LexicalListNode.ts:188, :192 | Y | |
| `list_splice` | `splice` | packages/lexical-list/src/LexicalListNode.ts:196 | Y | |
| `impl ElementNode for ListNode` (`extract_with_child`) | `extractWithChild` | packages/lexical-list/src/LexicalListNode.ts:218 | Y | |
| `create_list_item_node_for` | `createListItemNode` | packages/lexical-list/src/LexicalListNode.ts:228 | Y | |
| `list_node_transform` | `$config` `$transform` | packages/lexical-list/src/LexicalListNode.ts:66 | Y | runs for TaskListNode |
| `create_list_node`, `is_list_node` | `$createListNode`, `$isListNode` | packages/lexical-list/src/LexicalListNode.ts:377, :389 | Y | |
| Macro `TaskListNode` contract | `TaskListNode` | packages/lexical-core/nodes/TaskListNode.ts:61 | Y | replacement `packages/lexical-core/node-list.ts:142` |
| `ListItemNode` (+ serde) | `ListItemNode`, `SerializedListItemNode` | packages/lexical-list/src/LexicalListItemNode.ts:92, :57 | Y | |
| `list_item_node_transform` | `$config` `$transform` | packages/lexical-list/src/LexicalListItemNode.ts:101 | Y | |
| serde import / `adjust_export_json` | `updateFromJSON` / `exportJSON` | packages/lexical-list/src/LexicalListItemNode.ts:204, :249 | Y | CR-5 |
| `ListItemNode::append` | `append` | packages/lexical-list/src/LexicalListItemNode.ts:257 | Y | |
| `ListItemNode::replace` | `replace` | packages/lexical-list/src/LexicalListItemNode.ts:273 | Y | |
| `ListItemNode::insert_after` | `insertAfter` | packages/lexical-list/src/LexicalListItemNode.ts:341 | Y | |
| `ListItemNode::remove` | `remove` | packages/lexical-list/src/LexicalListItemNode.ts:371 | Y | |
| `ListItemNode::reset_on_copy` | `resetOnCopyNodeFrom` | packages/lexical-list/src/LexicalListItemNode.ts:387 | Y | |
| `ListItemNode::insert_new_after` | `insertNewAfter` | packages/lexical-list/src/LexicalListItemNode.ts:394 | Y | |
| `ListItemNode::collapse_at_start` | `collapseAtStart` | packages/lexical-list/src/LexicalListItemNode.ts:405 | Y | |
| `get_value`, `set_value` | `getValue`, `setValue` | packages/lexical-list/src/LexicalListItemNode.ts:444, :450 | Y | |
| `get_checked`, `set_checked`, `toggle_checked` | `getChecked`, `setChecked`, `toggleChecked` | packages/lexical-list/src/LexicalListItemNode.ts:456, :469, :475 | Y | checklist, progress, ai-editing |
| `get_indent`, `set_indent` | `getIndent`, `setIndent` | packages/lexical-list/src/LexicalListItemNode.ts:480, :497 | Y | |
| `ListItemNode::can_merge_with` | `canMergeWith` | packages/lexical-list/src/LexicalListItemNode.ts:525 | Y | `canInsertAfter`/`canReplaceWith` (:516, :521) deprecated, not ported |
| `ListItemNode::extract_with_child` | `extractWithChild` | packages/lexical-list/src/LexicalListItemNode.ts:529 | Y | |
| `is_parent_required`, `create_parent_element`, `can_merge_when_empty` | same | packages/lexical-list/src/LexicalListItemNode.ts:544, :548, :552 | Y | |
| `create_list_item_node`, `is_list_item_node` | `$createListItemNode`, `$isListItemNode` | packages/lexical-list/src/LexicalListItemNode.ts:711, :720 | Y | |
| `is_selecting_empty_list_item` | `$isSelectingEmptyListItem` | packages/lexical-list/src/formatList.ts:46 | Y | private |
| `insert_list` | `$insertList` | packages/lexical-list/src/formatList.ts:68 | Y | |
| `append` (private) | `append` | packages/lexical-list/src/formatList.ts:156 | Y | |
| `create_list_or_merge` | `$createListOrMerge` | packages/lexical-list/src/formatList.ts:160 | Y | private |
| `merge_lists` | `mergeLists` | packages/lexical-list/src/formatList.ts:224 | Y | |
| `remove_list` | `$removeList` | packages/lexical-list/src/formatList.ts:252 | Y | via REMOVE_LIST |
| `update_children_list_item_value` | `updateChildrenListItemValue` | packages/lexical-list/src/formatList.ts:323 | Y | |
| `merge_next_sibling_list_if_same_type` | `mergeNextSiblingListIfSameType` | packages/lexical-list/src/formatList.ts:346 | Y | |
| `handle_indent` | `$handleIndent` | packages/lexical-list/src/formatList.ts:362 | Y | via `setIndent` |
| `handle_outdent` | `$handleOutdent` | packages/lexical-list/src/formatList.ts:436 | Y | via `setIndent` |
| `handle_list_insert_paragraph` | `$handleListInsertParagraph` | packages/lexical-list/src/formatList.ts:503 | Y | via `registerList` |
| `get_list_depth` | `$getListDepth` | packages/lexical-list/src/utils.ts:21 | Y | |
| `get_top_list_node` | `$getTopListNode` | packages/lexical-list/src/utils.ts:48 | Y | |
| `is_last_item_in_list` | `$isLastItemInList` | packages/lexical-list/src/utils.ts:73 | N | |
| `get_all_list_items` | `$getAllListItems` | packages/lexical-list/src/utils.ts:102 | Y | via `$removeList` |
| `is_nested_list_node` | `isNestedListNode` | packages/lexical-list/src/utils.ts:131 | Y | |
| `find_nearest_list_item_node` | `$findNearestListItemNode` | packages/lexical-list/src/utils.ts:145 | N | |
| `remove_highest_empty_list_parent` | `$removeHighestEmptyListParent` | packages/lexical-list/src/utils.ts:161 | Y | |
| `get_new_list_start` | `$getNewListStart` | packages/lexical-list/src/utils.ts:191 | N | restoreNumbering off in Macro |
| `RegisterListOptions` | `RegisterListOptions` | packages/lexical-list/src/registerList.ts:46 | Y | |
| `register_list`, `list_item_text_style_transform`, `list_text_node_transform` | `registerList` + its two transforms | packages/lexical-list/src/registerList.ts:50, :103, :130 | Y | |
| `update_list_start` | UPDATE_LIST_START handler | packages/lexical-list/src/registerList.ts:63 | N | |
| `register_list_strict_indent_transform`, `process_list_with_strict_indent`, `format_list_indent_strict` | `registerListStrictIndentTransform` | packages/lexical-list/src/registerList.ts:150, :188, :153 | N | |
| `find_children_end_list_item_node` | `$findChildrenEndListItemNode` | packages/lexical-list/src/registerList.ts:213 | N | |
| `ListConfig`, `list_extension`, `register_list_nodes` | `ListConfig`, `ListExtension` | packages/lexical-list/src/LexicalListExtension.ts:18, :31 | N | Macro registers nodes + `registerList` |
| `find_check_list_item_sibling` | `findCheckListItemSibling` | packages/lexical-list/src/checkList.ts:402 | N | |
| `select_check_list_item_sibling` | `handleArrowUpOrDown` model half | packages/lexical-list/src/checkList.ts:437 | N | |
| `check_list_item_at_caret_start` | KEY_ARROW_LEFT handler model half | packages/lexical-list/src/checkList.ts:177 | N | |
| `insert_list(Check)` | INSERT_CHECK_LIST handler | packages/lexical-list/src/checkList.ts:115 | Y | Macro dispatches the command |
| `insert_list(Number)` | `INSERT_ORDERED_LIST_COMMAND` handler | packages/lexical-list/src/registerList.ts:33, :88 | Y | P0; the constant itself is view |
| `insert_list(Bullet)` | `INSERT_UNORDERED_LIST_COMMAND` handler | packages/lexical-list/src/registerList.ts:36, :97 | Y | P0 |
| `CheckListConfig { disable_take_focus_on_click }` | `CheckListConfig` | packages/lexical-list/src/LexicalListExtension.ts | N | view-only flag; kept for config parity |
| `HeadingNode` serde | `SerializedHeadingNode` | packages/lexical-rich-text/src/index.ts | Y | the struct is the serialized form |
| `QuoteNode` serde | `SerializedQuoteNode` | packages/lexical-rich-text/src/index.ts | Y | |
| `OverflowNode` serde | `SerializedOverflowNode` | packages/lexical-overflow/src/index.ts | N | |

Link (`packages/lexical-link/src/…`):

| Rust item | Ports | Source (file:line) | Used by Macro | Notes |
| --- | --- | --- | --- | --- |
| `LinkAttributes`, `AutoLinkAttributes` | same | packages/lexical-link/src/LexicalLinkNode.ts:52, :58 | Y | |
| `LinkNode` (+ serde) | `LinkNode`, `SerializedLinkNode` | packages/lexical-link/src/LexicalLinkNode.ts:80, :62 | Y | |
| serde import/export | `updateFromJSON`/`exportJSON` | packages/lexical-link/src/LexicalLinkNode.ts:175, :198 | Y | |
| `sanitize_url` | `sanitizeUrl`, `SUPPORTED_URL_PROTOCOLS` | packages/lexical-link/src/LexicalLinkNode.ts:184, :71 | Y | for `lexical_html` |
| `LinkNode` field access | `get/setURL`, `get/setTarget`, `get/setRel`, `get/setTitle` | packages/lexical-link/src/LexicalLinkNode.ts:208-246 | Y | plain struct fields via `get_mut` |
| `LinkNode::insert_new_after` | `insertNewAfter` | packages/lexical-link/src/LexicalLinkNode.ts:248 | Y | |
| `impl ElementNode for LinkNode` (inherited by AutoLinkNode) | `canInsertTextBefore/After`, `canBeEmpty`, `isInline`, `extractWithChild` | packages/lexical-link/src/LexicalLinkNode.ts:257, :261, :265, :269, :273 | Y | |
| `is_email_uri`, `is_web_site_uri` | `isEmailURI`, `isWebSiteURI` | packages/lexical-link/src/LexicalLinkNode.ts:292, :296 | Y | |
| `should_merge_adjacent_link` | `shouldMergeAdjacentLink` (both) | packages/lexical-link/src/LexicalLinkNode.ts:302, :514 | N | |
| `link_node_transform` | `$linkNodeTransform` (+ caret pair helpers) | packages/lexical-link/src/LexicalLinkNode.ts:335, :315, :320 | N | Macro does not register LinkExtension |
| `create_link_node`, `is_link_node` | `$createLinkNode`, `$isLinkNode` | packages/lexical-link/src/LexicalLinkNode.ts:448, :460 | Y | |
| `AutoLinkNode` (+ serde) | `AutoLinkNode`, `SerializedAutoLinkNode` | packages/lexical-link/src/LexicalLinkNode.ts:475, :466 | Y | |
| `AutoLinkNode::is_unlinked` | `getIsUnlinked`/`setIsUnlinked` | packages/lexical-link/src/LexicalLinkNode.ts:518, :522 | Y | |
| `AutoLinkNode::insert_new_after` | `insertNewAfter` | packages/lexical-link/src/LexicalLinkNode.ts:571 | Y | |
| `create_auto_link_node`, `is_auto_link_node` | `$createAutoLinkNode`, `$isAutoLinkNode` | packages/lexical-link/src/LexicalLinkNode.ts:593, :605 | Y | |
| `get_point_node` | `$getPointNode` | packages/lexical-link/src/LexicalLinkNode.ts:615 | Y | private |
| `with_selected_nodes` | `$withSelectedNodes` | packages/lexical-link/src/LexicalLinkNode.ts:635 | Y | private |
| `split_link_at_selection` | `$splitLinkAtSelection` | packages/lexical-link/src/LexicalLinkNode.ts:681 | Y | private |
| `toggle_link`, `ToggleLinkAttributes`, `AttrUpdate` | `$toggleLink` | packages/lexical-link/src/LexicalLinkNode.ts:740 | Y | |
| `format_url` | `formatUrl`, `PHONE_NUMBER_REGEX` | packages/lexical-link/src/LexicalLinkNode.ts:940, :932 | N | |
| `LinkConfig`, `handle_toggle_link_command`, `paste_url_as_link`, `link_extension` | `LinkConfig`, `registerLink`, `LinkExtension` | packages/lexical-link/src/LexicalLinkExtension.ts:31, :56, :136 | N | |
| `LinkMatcherResult`, `LinkMatcher` | `LinkMatcherResult`, `LinkMatcher` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:41, :49 | N | Macro has its own matcher |
| `RegexLinkMatcher`, `create_link_matcher_with_reg_exp` | `createLinkMatcherWithRegExp` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:51 | N | |
| `find_first_match` | `findFirstMatch` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:69 | N | |
| `AutoLinkConfig::default` separator | `PUNCTUATION_OR_SPACE` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:84 | N | |
| `is_separator`, `ends_with_separator`, `starts_with_separator` | same | packages/lexical-link/src/LexicalAutoLinkExtension.ts:86, :90, :97 | N | |
| `starts_with_tld` | `startsWithTLD` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:111 | N | |
| `is_previous_node_valid`, `is_next_node_valid` | same | packages/lexical-link/src/LexicalAutoLinkExtension.ts:119, :135 | N | |
| `is_content_around_is_valid` | `isContentAroundIsValid` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:148 | N | |
| `extract_matching_nodes` | `extractMatchingNodes` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:170 | N | |
| `create_auto_link_node_from` | `$createAutoLinkNode_` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:214 | N | |
| `handle_link_creation` | `$handleLinkCreation` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:293 | N | |
| `handle_link_edit` | `handleLinkEdit` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:369 | N | |
| `handle_bad_neighbors` | `handleBadNeighbors` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:429 | N | |
| `replace_with_children` | `replaceWithChildren` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:495 | N | |
| `get_text_nodes_to_match` | `getTextNodesToMatch` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:507 | N | |
| `AutoLinkConfig`, `AutoLinkConfig::merge` | `AutoLinkConfig`, `AutoLinkExtension.mergeConfig` | packages/lexical-link/src/LexicalAutoLinkExtension.ts:525, :626 | N | |
| `register_auto_link`, `auto_link_text_transform` | `registerAutoLink` TextNode transform | packages/lexical-link/src/LexicalAutoLinkExtension.ts:544, :561 | N | |
| `toggle_auto_link_unlinked` | `registerAutoLink` TOGGLE_LINK handler | packages/lexical-link/src/LexicalAutoLinkExtension.ts:587 | N | |

Hashtag, text entity, overflow, tab:

| Rust item | Ports | Source (file:line) | Used by Macro | Notes |
| --- | --- | --- | --- | --- |
| `HashtagNode` | `HashtagNode` (`canInsertTextBefore`, `isTextEntity`, `importJSON`) | packages/lexical-hashtag/src/LexicalHashtagNode.ts:15, :34, :38, :30 | N | |
| `create_hashtag_node`, `is_hashtag_node` | `$createHashtagNode`, `$isHashtagNode` | packages/lexical-hashtag/src/LexicalHashtagNode.ts:48, :57 | N | |
| `hashtag::regex` | `getHashtagRegexStringChars`, `getHashtagRegexString`, `REGEX` | packages/lexical-hashtag/src/LexicalHashtagExtension.ts:15, :224, :249 | N | truncated ranges kept |
| `get_hashtag_match` | `getHashtagMatch` | packages/lexical-hashtag/src/LexicalHashtagExtension.ts:251 | N | |
| `HashtagConfig`, `register_hashtag` | `HashtagConfig`, `registerLexicalHashtag`, `HashtagExtension` | packages/lexical-hashtag/src/LexicalHashtagExtension.ts:284, :270, :298 | N | |
| `EntityMatch`, `register_lexical_text_entity` | `EntityMatch`, `registerLexicalTextEntity` | packages/lexical-text/src/registerLexicalTextEntity.ts:19, :40 | N | |
| `replace_with_simple_text` | `$replaceWithSimpleText` | packages/lexical-text/src/registerLexicalTextEntity.ts:50 | N | |
| `text_entity_text_transform` | `$textNodeTransform` | packages/lexical-text/src/registerLexicalTextEntity.ts:60 | N | |
| `text_entity_reverse_transform` | `$reverseNodeTransform` | packages/lexical-text/src/registerLexicalTextEntity.ts:174 | N | |
| `OverflowNode`, `overflow_node_transform` | `OverflowNode`, `$config` `$transform` | packages/lexical-overflow/src/index.ts:21, :25 | N | |
| `OverflowNode::insert_new_after`, `exclude_from_copy` | same | packages/lexical-overflow/src/index.ts:47, :55 | N | |
| `create_overflow_node`, `is_overflow_node` | `$createOverflowNode`, `$isOverflowNode` | packages/lexical-overflow/src/index.ts:60, :64 | N | |
| `indent_over_tab` | `$indentOverTab` | packages/lexical-extension/src/TabIndentationExtension.ts:40 | N | |
| `indent_with_limit` | `registerTabIndentation` INDENT handler, `$defaultCanIndent` | packages/lexical-extension/src/TabIndentationExtension.ts:102, :72 | N | Macro has its own (`apps/web/.../tab-indentation/tabIndentationPlugin.ts:35`) |

### 1a.17 Not ported (DOM / view / JS glue)

- `QuoteNode.createDOM`/`updateDOM` — packages/lexical-rich-text/src/index.ts:144, :149
- `QuoteNode.importDOM`, `$convertBlockquoteElement` — packages/lexical-rich-text/src/index.ts:153, :441
- `QuoteNode.exportDOM` (moves to `lexical_html`) — packages/lexical-rich-text/src/index.ts:162
- `HeadingNode.createDOM`/`updateDOM` — packages/lexical-rich-text/src/index.ts:260, :272
- `HeadingNode.importDOM`, `isGoogleDocsTitle`, `$convertHeadingElement` — packages/lexical-rich-text/src/index.ts:276, :415, :422
- `HeadingNode.exportDOM` (moves to `lexical_html`) — packages/lexical-rich-text/src/index.ts:330
- `onPasteForRichText` — packages/lexical-rich-text/src/index.ts:461
- `onCutForRichText` clipboard write — packages/lexical-rich-text/src/index.ts:484
- `eventFiles` — packages/lexical-rich-text/src/index.ts:505
- `$isTargetWithinDecorator` — packages/lexical-rich-text/src/index.ts:526
- `registerRichText` command registration itself, KEY_ESCAPE, DRAGSTART, DRAGOVER, COPY, CUT, PASTE handlers — packages/lexical-rich-text/src/index.ts:651, :1090, :1138, :1166, :1198, :1209, :1217
- `DRAG_DROP_PASTE` command — packages/lexical-rich-text/src/index.ts:126
- `RichTextExtension` (signals, Dragon dependency) — packages/lexical-rich-text/src/LexicalRichTextExtension.ts:100
- `RichTextImportExtension`, `RichTextImportRules` — packages/lexical-rich-text/src/RichTextImportExtension.ts:107, :122
- `ListNode.createDOM`/`updateDOM`, `$setListThemeClassNames` — packages/lexical-list/src/LexicalListNode.ts:126, :140, :233
- `ListNode.exportDOM` (moves to `lexical_html`) — packages/lexical-list/src/LexicalListNode.ts:164
- `ListNode` importDOM, `$normalizeChildren`, `isDomChecklist`, `$convertListNode` — packages/lexical-list/src/LexicalListNode.ts:71, :298, :324, :347
- `ListItemNode.createDOM`/`updateListItemDOM`/`updateDOM`, `applyMarkerStyles`, `$setListItemThemeClassNames`, `updateListItemChecked` — packages/lexical-list/src/LexicalListItemNode.ts:168, :175, :193, :65, :557, :613
- `ListItemNode.exportDOM` (moves to `lexical_html`) — packages/lexical-list/src/LexicalListItemNode.ts:213
- `ListItemNode` importDOM, `$convertListItemElement`, `$convertCheckboxInput`, `setFormatFromChildren` — packages/lexical-list/src/LexicalListItemNode.ts:143, :638, :678, :688
- `ListItemNode.canInsertAfter`/`canReplaceWith` (deprecated) — packages/lexical-list/src/LexicalListItemNode.ts:516, :521
- `ListImportExtension`, `ListImportRules`, `ListSchema` — packages/lexical-list/src/ListImportExtension.ts:231, :215, :198
- `registerCheckList` event wiring, `handleCheckItemEvent`, `handleClick`, `handleSelectDefaults`, `getActiveCheckListItem`, KEY_ESCAPE handler — packages/lexical-list/src/checkList.ts:51, :270, :343, :377, :390, :137
- `CheckListExtension` — packages/lexical-list/src/LexicalListExtension.ts:67
- Command constants `INSERT_ORDERED/UNORDERED_LIST_COMMAND`, `REMOVE_LIST_COMMAND`, `UPDATE_LIST_START_COMMAND`, `INSERT_CHECK_LIST_COMMAND` — packages/lexical-list/src/registerList.ts:33-44, packages/lexical-list/src/checkList.ts:41
- Deprecated `insertList(editor, ..)`, `removeList(editor)` — packages/lexical-list/src/index.ts:83, :96
- `LinkNode.createDOM`/`updateLinkDOM`/`updateDOM`, `AutoLinkNode.createDOM`/`updateDOM` — packages/lexical-link/src/LexicalLinkNode.ts:123, :130, :153, :528, :536
- `LinkNode.importDOM`, `$convertAnchorElement`, `AutoLinkNode.importDOM` — packages/lexical-link/src/LexicalLinkNode.ts:162, :427, :559
- `TOGGLE_LINK_COMMAND` constant — packages/lexical-link/src/LexicalLinkNode.ts:611
- Deprecated `toggleLink` alias — packages/lexical-link/src/index.ts:43
- `ClickableLinkExtension`, `registerClickableLink`, `findMatchingDOM` — packages/lexical-link/src/ClickableLinkExtension.ts:132, :47, :26
- `LinkImportExtension`, `LinkImportRules` — packages/lexical-link/src/LinkImportExtension.ts:61, :51
- `AutoLinkExtension` signals wrapper (logic ported as `register_auto_link`) — packages/lexical-link/src/LexicalAutoLinkExtension.ts:623
- `HashtagNode.createDOM` — packages/lexical-hashtag/src/LexicalHashtagNode.ts:24
- `OverflowNode.createDOM`/`updateDOM`, `OverflowExtension` — packages/lexical-overflow/src/index.ts:34, :43, :73
- `registerTabIndentation` KEY_TAB handler, `TabIndentationExtension` — packages/lexical-extension/src/TabIndentationExtension.ts:84, :149
- Macro `TaskListNode.createDOM`/`exportDOM`/`getDOMSlot`/`importDOM` — packages/lexical-core/nodes/TaskListNode.ts:81, :95, :106, :77
- Character limit model (`useCharacterLimit`: `$wrapOverflowedNodes`, `$mergePrevious`, `findOffset`, the LOW DELETE_CHARACTER override, UTF-8 charset; OVF-04..OVF-11) — packages/lexical-react/src/shared/useCharacterLimit.ts. React-only and unused by Macro; `OverflowNode` alone is ported (Tier B conformance only, Q14).
- `@lexical/extension` built-ins other than TabIndentation, ClearEditor (`clear_editor`, §1a.4), NormalizeTripleClickSelection (§1a.18) and ClickAfterLastBlock's model half (§1a.19): `NormalizeInlineElementsExtension` (XB-17, the PlainTextExtension dependency), upstream `HorizontalRuleNode` + `INSERT_HORIZONTAL_RULE_COMMAND` (XB-07/08; Macro's HR is §4.1b), `DecoratorTextNode` + `applyFormatFromStyle` (XB-22/23). Macro never imports `@lexical/extension`; Tier B runs these from upstream JS.
- `PlainTextExtension` — packages/lexical-plain-text/src/index.ts (extension wrapper; the command model is §1a.4b)
### 1a.18 `normalize_triple_click` (R2.1)

Model half of `@lexical/extension` `NormalizeTripleClickSelectionExtension` (S1 §14.4). The
`$fixFocusOverselection` body is core: `Transaction::fix_focus_overselection` (S1 §9.2). The
triple-click tracking (`mousedown`/`mouseup` `detail === 3`, `thresholdMsec`, `dateNow`) is S12
web-view, which sets `SelectionChangeContext::triple_click`.

```rust
/// A `Plugin` with one listener: SELECTION_CHANGE at `Critical`/`Before`. When
/// `tx.selection_change_context()` has `triple_click`, it calls `tx.fix_focus_overselection()`
/// and returns `Handled::No` (upstream's listener returns false). `disabled` = not registering it.
pub fn register_normalize_triple_click(b: EditorBuilder) -> EditorBuilder;
```

Macro's `normalize-triple-click` plugin (S12 §1.14) maps to it. Tests: upstream's
`NormalizeTripleClickSelectionExtension` tests against `fix_focus_overselection` (S4).

### 1a.19 `click_after_last_block` (R2.1)

Model half of `ClickAfterLastBlockExtension` (S1 §14.4). The claim test (`event.target ===
rootElement`, `clientY` below the last block's `getBoundingClientRect().bottom`) and the
`mousedown` `preventDefault` are DOM geometry and stay in S12 web-view (Macro's
`trailing-paragraph` view part), which dispatches the command.

```rust
/// `$defaultShouldInsertAfter`: the node is a decorator, or an element with `is_shadow_root`.
pub fn default_should_insert_after(view: StateRef<'_>, key: NodeKey) -> bool;
/// ExtensionState; `should_insert_after` defaults to `default_should_insert_after`.
#[derive(Clone, Copy, Debug)]
pub struct ClickAfterLastBlockConfig { pub should_insert_after: fn(StateRef<'_>, NodeKey) -> bool }
pub static INSERT_AFTER_LAST_BLOCK: CommandKey<()> = CommandKey::new("click_after_last_block.insert");
/// Registers the config and the handler: re-read the root's last child; if the predicate holds,
/// append an empty paragraph after it, select its start, return `Handled::Yes`.
pub fn register_click_after_last_block(b: EditorBuilder, config: ClickAfterLastBlockConfig) -> EditorBuilder;
```

Not P0 for Macro (no Macro caller today).

## 1b. lexical_rich_nodes::table (model half of @lexical/table)

Ports the model half of `packages/lexical-table/src` (v0.45.0): the three nodes, the span
map, every `$`-util in `LexicalTableUtils.ts`, `TableSelection`, the integrity transforms and
the model actions behind the table command handlers. Pointer drag, highlight classes, DOM
selection and rect measurement stay in the JS view. The JS view gets a model-derived
`TableGrid` from Rust in place of the DOM-scanned `TableDOMTable`.

Upstream paths below are relative to the Lexical repo root
(`packages/lexical-table/src/...`). Macro paths are relative to the Macro worktree root.

### 1b.0 Conventions specific to this module

- **Span reads follow JS object identity (live-cell rule, normative).** Upstream's map holds the
  node object that `getChildren()` returned when the map was built, and every op reads
  `cell.__rowSpan` / `__colSpan` / `__headerState` from that object after writing through
  `cell.setRowSpan(..)` / `setColSpan(..)`. `getWritable()` returns the same object when the cell is
  already writable in this update (created or cloned earlier in the same `editor.update`), so the
  write is visible to every later read through the map; otherwise it clones, and the map keeps the
  frozen object, so later reads see the value from map time. Rust reproduces both cases exactly,
  because the result is stored `rowSpan`/`colSpan` JSON:
  - `compute_table_map*` records, per value, `live = tx.is_writable(cell)` (CR-19) at map time.
  - `span(v)` / `header(v)` read the cell's **current** field through `tx` when `v.live`, else the
    snapshot stored in `v`. Every span/header read in §1b.3-§1b.4 goes through these two helpers.
  - Writes always go through `tx`. A frozen cell becomes writable on its first write, but `v.live`
    stays as recorded, because the JS map still holds the frozen object.
  Consequences that Rust must reproduce when `live` is true (the "already writable" case: two
  span-changing ops in one transaction, merge then insert, insert then delete):
  insert-row next to a colSpan=k cell crossing the boundary grows rowSpan by k, not 1;
  delete-row trims a cell spanning several deleted rows once per visited row, and the trimmed
  value feeds the move-down test (`:668`), so the cell can be deleted with its row instead of
  moved; delete-column's overflow `set_col_span` runs once per spanned row and subtracts
  repeatedly. The repeated per-row trims are idempotent only under snapshot reads. Macro's table
  plugins dispatch one op per update, so Macro normally hits the snapshot case; §6.3 adds a
  fixture with two span-changing ops in one transaction, compared with upstream.
- **Identity.** Upstream `a.is(b)` / `===` on nodes becomes `NodeKey` equality.
- **Invariants.** Every upstream `invariant(...)` / `throw new Error(...)` becomes
  `Err(Error::invariant("<upstream message>"))`. This assumes core exposes a constructor with
  that shape. If it does not, use whatever core's invariant variant is; keep the upstream
  message text.
- **Commands.** Model actions are free functions. When upstream dispatches a command from
  inside a model action (`INSERT_PARAGRAPH_COMMAND`, `SELECTION_CHANGE_COMMAND`), the Rust
  function returns an outcome value and the JS view dispatches the command. The DOM command
  bus stays in JS.
- **JS numbers.** `colWidths`, `width` and `height` are JS numbers and can be fractional.
  Store them as `JsNumber(f64)`, which serializes integral values with no `.0`
  (`100` stays `100`, `92.5` stays `92.5`). If core already has such a type, use it.

### 1b.1 Module layout

```
crates/client/lexical/lexical_rich_nodes/src/table/
  mod.rs          re-exports; TableConfig; register_table(builder, &TableConfig)
  nodes.rs        TableNode, TableRowNode, TableCellNode, TableCellHeaderState, JsNumber
  map.rs          TableMap/TableMapValue, compute_table_map(_skip_cell_check), get_node_triplet,
                  rect boundary/spans, get_table_cell_node_rect, lookups (find_*, *_index_*)
  ops.rs          create_table_node_with_dimensions, insert/delete row/column (+deprecated),
                  merge_cells, unmerge_cell(_node), move_table_column, is_simple_table
  selection.rs    TableSelection behaviour (TableSelectionExt), create_table_selection_from,
                  visit_recursively, TableSelectionHooksImpl (core hook)
  transforms.rs   table/row/cell integrity transforms, unmerge transform, bg-colour transform
  commands.rs     insert_table, select_all_in_table, select_block_in_cell (triple click),
                  insert_clipboard_nodes_in_table, insert_table_into_grid
  observer.rs     model halves of TableObserver: clear_text, format_cells, select_cells
  grid.rs         TableGrid (model replacement for TableDOMTable) + view queries
  handlers.rs     model halves of applyTableHandlers, $handleArrowKey, selection-change fixups
```

### 1b.2 Nodes (`nodes.rs`)

```rust
/// A JS number. Integral values serialize as JSON integers.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
pub struct JsNumber(pub f64);
impl Serialize for JsNumber { /* integral && |v| < 2^53 => i64, else f64 */ }
impl<'de> Deserialize<'de> for JsNumber { /* any JSON number */ }

bitflags::bitflags! {
    /// `TableCellHeaderStates`. Serialized as a plain number.
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
    #[serde(transparent)]
    pub struct TableCellHeaderState: u8 {
        const NO_STATUS = 0;
        const ROW = 1;
        const COLUMN = 2;
        const BOTH = 3;
    }
}
```

#### TableNode (`"table"`)

```rust
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableNode {
    /// `colWidths`. Emitted when `Some` (including `[]`). null/missing -> None. An element can be
    /// `null` (written by an out-of-range column insert, §1b.4); `None` elements serialize as `null`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col_widths: Option<Vec<Option<JsNumber>>>,
    /// `frozenColumnCount`. Deserialize `x || 0`; omitted when 0.
    #[serde(default, deserialize_with = "falsy_as_default", skip_serializing_if = "is_zero")]
    pub frozen_column_count: u32,
    /// `frozenRowCount`. Same rules.
    #[serde(default, deserialize_with = "falsy_as_default", skip_serializing_if = "is_zero")]
    pub frozen_row_count: u32,
    /// `rowStriping`. Deserialize `x || false`; omitted when false.
    #[serde(default, deserialize_with = "falsy_as_default", skip_serializing_if = "is_false")]
    pub row_striping: bool,
}
impl TableNode { pub const TYPE: &'static str = "table"; }

impl ElementNode for TableNode {
    fn is_shadow_root(&self, _: ElementView<'_>) -> bool { true }
    fn can_be_empty(&self, _: ElementView<'_>) -> bool { false }
    fn can_indent(&self, _: ElementView<'_>) -> bool { false }
    fn extract_with_child(&self, _: ElementView<'_>, _child: NodeKey, _sel: Option<&Selection>,
                          dest: CopyDestination) -> bool { dest == CopyDestination::Html }
}
/// `canSelectBefore` is not a core hook (S1 §3.2, CR-18). The table package defines
/// `trait CanSelectBefore { fn can_select_before(&self) -> bool; }`, implements it for TableNode
/// (`true`), registers it with `EditorBuilder::node_trait::<TableNode, dyn CanSelectBefore>`, and
/// its callers read `st.get_dyn::<dyn CanSelectBefore>(k).is_some_and(|n| n.can_select_before())`.

impl TableNode {
    /// `getColumnCount`: sum of `colSpan` over the first row's TableCellNode children;
    /// 0 when there is no first child.
    pub fn column_count(state: &EditorState, table: Id<TableNode>) -> u32;
}
```

JSON: `{children, direction, format, indent, type:"table", version:1, [NodeState keys],
colWidths?, frozenColumnCount?, frozenRowCount?, rowStriping?}`, in that order.
`textFormat`/`textStyle` are never emitted for any of the three table nodes, because they are
shadow roots (`packages/lexical/src/nodes/LexicalElementNode.ts:654`). The element `__style`
is not serialized. Getters and setters are plain field access on `tx.get_mut`. Upstream
`setColWidths` freezes the array in dev, which needs no Rust equivalent.

#### TableRowNode (`"tablerow"`)

```rust
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct TableRowNode {
    /// `height`. Emitted iff Some. Deserialized as-is (0 stays 0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<JsNumber>,
}
impl TableRowNode { pub const TYPE: &'static str = "tablerow"; }

impl ElementNode for TableRowNode {
    fn is_shadow_root(&self) -> bool { true }
    fn can_be_empty(&self) -> bool { false }
    fn can_indent(&self) -> bool { false }
    fn extract_with_child(&self, _c: NodeKey, _s: Option<&Selection>,
                          dest: CopyDestination) -> bool { dest == CopyDestination::Html }
}
```

Known deviation: upstream keeps an explicit `"height": null` (`setHeight(null)`, and
`exportJSON` only drops `undefined`). Rust reads null as None and drops the key.

#### TableCellNode (`"tablecell"`)

Field order equals JSON key order (`LexicalTableCellNode.ts:197`).

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCellNode {
    /// Stored raw (`x || undefined`). Serialized only when "middle" | "bottom".
    #[serde(default, deserialize_with = "empty_as_none",
            skip_serializing_if = "not_valid_vertical_align")]
    pub vertical_align: Option<String>,
    /// Always serialized; None => `null`. Deserialize `x || null` ("" -> None).
    #[serde(default, deserialize_with = "empty_as_none")]
    pub background_color: Option<String>,
    /// Always serialized. Deserialize `x || 1` (missing/null/0 -> 1).
    #[serde(default = "one", deserialize_with = "falsy_as_one")]
    pub col_span: u32,
    /// Always serialized. Deserialize via setHeaderStyles(x, BOTH) => `x & 3` (missing -> 0).
    #[serde(default, deserialize_with = "header_state_masked")]
    pub header_state: TableCellHeaderState,
    /// Always serialized. Deserialize `x || 1`.
    #[serde(default = "one", deserialize_with = "falsy_as_one")]
    pub row_span: u32,
    /// Omitted when None. Deserialize `x || undefined` (0/null -> None).
    #[serde(default, deserialize_with = "falsy_as_none", skip_serializing_if = "Option::is_none")]
    pub width: Option<JsNumber>,
}
impl TableCellNode {
    pub const TYPE: &'static str = "tablecell";
    pub fn new(header_state: TableCellHeaderState, col_span: u32, width: Option<JsNumber>) -> Self;
    /// `setHeaderStyles(h, mask)`: `(h & mask) | (self & !mask)`.
    pub fn set_header_styles(&mut self, h: TableCellHeaderState, mask: TableCellHeaderState);
    /// `toggleHeaderStyle`: subtracts the bits if all are set, else adds them.
    /// Arithmetic, not xor: toggling BOTH when only ROW is set yields 1+3 = 4 upstream.
    /// Rust: compute in u8 and truncate with from_bits_retain to keep that behaviour.
    pub fn toggle_header_style(&mut self, h: TableCellHeaderState);
    /// `(header & h) == h`.
    pub fn has_header_state(&self, h: TableCellHeaderState) -> bool;
    /// `header != NO_STATUS`.
    pub fn has_header(&self) -> bool;
    /// `setVerticalAlign(x)` stores `x || undefined`.
    pub fn set_vertical_align(&mut self, v: Option<String>);
}
impl Default for TableCellNode { /* NO_STATUS, colSpan 1, rowSpan 1, all None */ }

impl ElementNode for TableCellNode {
    fn is_shadow_root(&self) -> bool { true }
    fn collapse_at_start(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot)
        -> Result<bool, Error> { Ok(true) }
    fn can_be_empty(&self) -> bool { false }
    fn can_indent(&self) -> bool { false }
}
```

Deviations: upstream keeps negative or fractional spans as-is (`-1 || 1 === -1`). `u32`
deserialization rejects them with `Err`. `getTag()` (`th` if `hasHeader()`, else `td`) is used
only by the view and by `lexical_html`.

### 1b.3 Table map (`map.rs`)

```rust
/// `TableMapValueType` plus a span snapshot taken when the map is computed, and whether the cell
/// was already writable then (live-cell rule, §1b.0).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TableMapValue {
    pub cell: Id<TableCellNode>,
    pub start_row: u32,
    pub start_column: u32,
    pub row_span: u32,
    pub col_span: u32,
    pub header_state: TableCellHeaderState,
    /// `tx.is_writable(cell)` at map time (CR-19). Read-only callers on `&EditorState` set false.
    pub live: bool,
}
impl TableMapValue {
    /// Live-cell reads: current field through `st` when `self.live`, else the snapshot.
    pub fn row_span(&self, st: &EditorState) -> u32;
    pub fn col_span(&self, st: &EditorState) -> u32;
    pub fn header_state(&self, st: &EditorState) -> TableCellHeaderState;
    pub fn end_row(&self, st: &EditorState) -> u32 { self.start_row + self.row_span(st) - 1 }
    pub fn end_column(&self, st: &EditorState) -> u32 { self.start_column + self.col_span(st) - 1 }
}

/// `TableMapType`: `rows[r][c]`, with every slot a span covers pointing at the same value.
/// Rows can be ragged and can have holes (None) when a row has too few cells under a
/// rowSpan from above.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct TableMap { pub rows: Vec<Vec<Option<TableMapValue>>> }
impl TableMap {
    pub fn get(&self, row: u32, col: u32) -> Option<&TableMapValue>;
    pub fn row_count(&self) -> u32;               // rows.len()
    /// `gridMap[0].length`: width of row 0, as used by every upstream caller.
    pub fn column_count(&self) -> u32;
}

pub fn compute_table_map_skip_cell_check(
    state: &EditorState, table: Id<TableNode>,
    cell_a: Option<Id<TableCellNode>>, cell_b: Option<Id<TableCellNode>>,
) -> Result<(TableMap, Option<TableMapValue>, Option<TableMapValue>)>;

pub fn compute_table_map(
    state: &EditorState, table: Id<TableNode>,
    cell_a: Id<TableCellNode>, cell_b: Id<TableCellNode>,
) -> Result<(TableMap, TableMapValue, TableMapValue)>;
```

`compute_table_map_skip_cell_check` (`LexicalTableUtils.ts:1040`):

1. For each child `row` of the table at index `r`, the child must be a TableRowNode, else
   `Err("Expected TableNode children to be TableRowNode")`. Make sure `rows[r]` exists.
2. Set `col = 0`. For each child `cell` of the row: it must be a TableCellNode, else Err.
   Advance `col` while `rows[r][col]` is occupied.
3. Build `value = {cell, start_row: r, start_column: col, spans...}`. For `j` in
   `0..row_span`, stop if `r + j >= row_count`, because a rowSpan below the last row is
   truncated (upstream #6584). Otherwise write `value` into `rows[r+j][col..col+col_span]`.
   Extend the row with None as needed.
4. Record the first value whose cell equals `cell_a` or `cell_b`.

Note: `col` does not advance by `col_span` after placing a cell. The skip loop in step 2 does
it on the next iteration. Port it the same way.

`compute_table_map` (`:1025`) wraps the above. It returns `Err("Anchor not found in Table")`
or `Err("Focus not found in Table")` when a cell is missing.

```rust
/// `$getNodeTriplet`: the nearest TableCellNode ancestor-or-self of `source`, its row and table.
pub enum TripletSource { Node(NodeKey), Point(Point) }
pub fn get_node_triplet(state: &EditorState, source: TripletSource)
    -> Result<(Id<TableCellNode>, Id<TableRowNode>, Id<TableNode>)>;

pub struct TableCellRectBoundary { pub min_column: u32, pub min_row: u32,
                                   pub max_column: u32, pub max_row: u32 }
pub struct TableCellRectSpans { pub top_span: u32, pub left_span: u32,
                                pub right_span: u32, pub bottom_span: u32 }

pub fn compute_table_cell_rect_boundary(map: &TableMap, a: &TableMapValue, b: &TableMapValue)
    -> TableCellRectBoundary;
pub fn compute_table_cell_rect_spans(map: &TableMap, b: &TableCellRectBoundary)
    -> Result<TableCellRectSpans>;

pub struct TableCellNodeRect { pub row_index: u32, pub column_index: u32,
                               pub row_span: u32, pub col_span: u32 }
pub fn get_table_cell_node_rect(state: &EditorState, cell: Id<TableCellNode>)
    -> Result<Option<TableCellNodeRect>>;
```

- `compute_table_cell_rect_boundary` (`:1183`): start from the bounding box of both cells,
  using their spans. Repeat until nothing changes: for every slot `(row in 0..rows,
  col in 0..rows[0].len)`, skipping holes, if the slot's cell rectangle intersects the
  current box on both axes, grow the box to include that whole cell.
- `compute_table_cell_rect_spans` (`:1161`): `top`/`bottom` = max rowSpan across
  `min_column..=max_column` in rows `min_row`/`max_row`. `left`/`right` = max colSpan across
  rows in columns `min_column`/`max_column`. All start at 1. A hole is `Err`, where upstream
  would hit a TypeError.
- `get_table_cell_node_rect` (`:1332`): an independent matrix walk sized
  `row_count x (first row child count)`. Rust uses a growable matrix instead of a fixed one;
  out-of-range writes are a no-op upstream. Skip occupied slots, place the cell, and return
  its `(row, column, rowSpan||1, colSpan||1)` when it is `cell`. Return None if it is not
  found.

Lookups (`LexicalTableUtils.ts`, `LexicalTableSelectionHelpers.ts`):

```rust
/// `$getTableCellNodeFromLexicalNode` / `$findCellNode`: nearest ancestor-or-self cell.
pub fn find_cell_node(state: &EditorState, node: NodeKey) -> Option<Id<TableCellNode>>;
/// `$findTableNode`: nearest ancestor-or-self table.
pub fn find_table_node(state: &EditorState, node: NodeKey) -> Option<Id<TableNode>>;
/// `$getTableRowNodeFromTableCellNodeOrThrow`.
pub fn get_table_row_node_from_table_cell_node(state: &EditorState, node: NodeKey)
    -> Result<Id<TableRowNode>>;   // Err("Expected table cell to be inside of table row.")
/// `$getTableNodeFromLexicalNodeOrThrow`.
pub fn get_table_node_from_lexical_node(state: &EditorState, node: NodeKey)
    -> Result<Id<TableNode>>;     // Err("Expected table cell to be inside of table.")
/// `$getTableRowIndexFromTableCellNode`: index of the cell's row among the table's children.
pub fn get_table_row_index_from_table_cell_node(state: &EditorState, cell: Id<TableCellNode>)
    -> Result<i32>;               // -1 if not found (findIndex)
/// `$getTableColumnIndexFromTableCellNode`: child index in its row (NOT span-aware).
pub fn get_table_column_index_from_table_cell_node(state: &EditorState, cell: Id<TableCellNode>)
    -> Result<i32>;
/// `$findParentTableCellNodeInTable`: walk up from `node`; return the last cell seen
/// before reaching `table` (the cell directly in `table`). None if `table` is not an ancestor.
pub fn find_parent_table_cell_node_in_table(state: &EditorState, table: NodeKey,
                                            node: Option<NodeKey>) -> Option<Id<TableCellNode>>;
/// `$isSelectionInTable`: Range or Table selection whose anchor AND focus nodes are strict
/// descendants of `table` (`isParentOf`).
pub fn is_selection_in_table(state: &EditorState, sel: Option<&Selection>, table: NodeKey) -> bool;
/// `$isFullTableSelection`: TableSelection whose anchor is map[0][0] and focus is the last
/// entry of the last map row.
pub fn is_full_table_selection(state: &EditorState, sel: Option<&Selection>, table: Id<TableNode>)
    -> Result<bool>;
```

### 1b.4 Table operations (`ops.rs`)

Every function takes `tx: &mut Transaction`. "Cell with paragraph" means
`TableCellNode::new(h, 1, None)` with one empty `ParagraphNode` child.

```rust
pub enum IncludeHeaders { All(bool), Some { rows: bool, columns: bool } }  // default All(true)

pub fn create_table_node_with_dimensions(tx: &mut Transaction, rows: u32, columns: u32,
                                         include_headers: IncludeHeaders) -> Result<Id<TableNode>>;
```
`:40`. Creates a detached table with `rows` rows and `columns` cells per row. Header state:
- `Some{rows, columns}`: `ROW` on row 0 if `rows`, and `COLUMN` on column 0 if `columns`.
- `All(true)`: `ROW` on row 0 and `COLUMN` on column 0.
- `All(false)`: none.

Each cell gets one paragraph with **one empty TextNode** (upstream keeps it, and
`insert_table` selects it). Only `$clearText` is patched by Macro; keep this one.

```rust
pub fn remove_table_row_at_index(tx: &mut Transaction, table: Id<TableNode>, index: u32)
    -> Result<Id<TableNode>>;
```
`:154`. `Err` if out of range, using upstream's message "Expected table cell to be inside of
table row.". Otherwise removes `children[index]`.

```rust
/// Deprecated upstream (no merged-cell support). Ported for API completeness; Macro unused.
pub fn insert_table_row(tx: &mut Transaction, table: Id<TableNode>, target_index: u32,
                        insert_after: bool, row_count: u32, grid: &TableGrid) -> Result<Id<TableNode>>;
pub fn insert_table_column(tx: &mut Transaction, table: Id<TableNode>, target_index: u32,
                           insert_after: bool, column_count: u32, grid: &TableGrid)
    -> Result<Id<TableNode>>;
pub fn delete_table_column(tx: &mut Transaction, table: Id<TableNode>, target_index: u32)
    -> Result<Id<TableNode>>;
```
- `insert_table_row` (`:172`). Upstream takes the DOM grid. Rust takes `TableGrid`, whose
  physical coordinates match the DOM grid. Target row = `children[target_index]` (Err if out
  of range or not a row). Repeat `row_count` times, building one new row each time:
  - For each child cell `c` of the target row, find its physical coords `(x, y)` and the
    cells above `(x, y-1)` and below `(x, y+1)`, using `TableGrid::cell_at` clamp semantics.
    This is `$getTableCellSiblingsFromTableCellNode` (`:140`).
  - width = `above.width || below.width || None`.
  - header = `COLUMN` if above or below `has_header_state(COLUMN)`, else `NO_STATUS`.
  - New cell = `TableCellNode::new(header, 1, width)` + paragraph.
  - Insert the new row after the target if `insert_after`, else before it.

  Each iteration inserts adjacent to the target, so with `insert_after` the rows end up in
  reverse insertion order. That matches upstream.
- `insert_table_column` (`:376`). For each row, repeated `column_count` times: target cell =
  `children[target_index]` (Err if out of range). Header = `ROW` if the left or right
  physical neighbour `has_header_state(ROW)`. Collect all `(new, target)` pairs first, then
  insert each new cell after or before its target.
- `delete_table_column` (`:585`). Removes `children[target_index]` of every row. Err if out
  of range for any row; the rows before it are already removed when this happens, which
  matches upstream.

```rust
/// `getHeaderState(current, possible)`: `possible` if current is BOTH or == possible, else NO_STATUS.
fn header_state_for_insert(current: TableCellHeaderState, possible: TableCellHeaderState)
    -> TableCellHeaderState;                                                 // :239

pub fn insert_table_row_at_node(tx: &mut Transaction, cell: Id<TableCellNode>, insert_after: bool)
    -> Result<Option<Id<TableRowNode>>>;                                     // :302
pub fn insert_table_row_at_selection(tx: &mut Transaction, insert_after: bool)
    -> Result<Option<Id<TableRowNode>>>;                                     // :257
#[deprecated] pub use insert_table_row_at_selection as insert_table_row__experimental; // :295
```
`insert_table_row_at_node`: `(map, cv) = compute_table_map(table, cell, cell)` and
`cols = map.column_count()`.
- **After.** `end = cv.start_row + cv.row_span - 1`. For `i in 0..cols`, take
  `v = map[end][i]`:
  - If `v.end_row() <= end`, append to the new row a cell with paragraph and header
    `header_state_for_insert(v.header_state, COLUMN)`.
  - Otherwise set `v.cell.row_span = v.row_span + 1`.

  This runs once per covered column, so a cell with colSpan > 1 is bumped once per slot, each
  time reading `row_span` by the live-cell rule. Frozen cell: `+1`. Already-writable cell:
  `+colSpan` (JS mutates in place). Do not dedupe.
  Insert the new row after `table.children[end]` (Err if that is not a row).
- **Before.** `start = cv.start_row`. For each column, take `v = map[start][i]`:
  - If `v.start_row == start`, append a new cell with the same header rule.
  - Otherwise `row_span + 1`.

  Insert before `table.children[start]`.
- Returns the new row. Does not move the selection.

`insert_table_row_at_selection`: the selection must be Range or Table, else
`Err("Expected a RangeSelection or TableSelection")`. `anchor_cell` and `focus_cell` come
from `get_node_triplet(anchor/focus node)`. `(map, fv, av) = compute_table_map(table,
focus_cell, anchor_cell)`.
- `insert_after`: call `_at_node(anchor_cell if av.start_row + av.row_span >
  fv.start_row + fv.row_span else focus_cell, true)`.
- Otherwise call `_at_node(focus_cell if fv.start_row < av.start_row else anchor_cell, false)`.

```rust
pub fn insert_table_column_at_node(tx: &mut Transaction, cell: Id<TableCellNode>,
                                   insert_after: bool, should_set_selection: bool)
    -> Result<Option<Id<TableCellNode>>>;                                    // :485
pub fn insert_table_column_at_selection(tx: &mut Transaction, insert_after: bool)
    -> Result<Option<Id<TableCellNode>>>;                                    // :440
#[deprecated] pub use insert_table_column_at_selection as insert_table_column__experimental; // :478
```
`insert_table_column_at_node`: `(map, cv)` as above.
`ia = insert_after ? cv.start_column + cv.col_span - 1 : cv.start_column - 1`, kept as i64
because it can be -1. The first table child must be a row, else Err. Walk the rows `i` by
next sibling (Err if a sibling is not a row). For each row:
- `h = header_state_for_insert(map[i][max(ia,0)].header_state, ROW)`.
- If `ia < 0`: insert a new cell with header `h` as the row's first child, then continue.
- Otherwise `v = map[i][ia]`:
  - If `v.end_column() <= ia`, the column boundary falls after `v`. Find the insert anchor:
    `after = v.cell`, `after_start = v.start_row`, `prev = ia`. While
    `after_start != i && after_row_span > 1`:
    - `prev -= v.col_span`. This uses the original `v`'s colSpan on every iteration
      (upstream quirk; keep it).
    - If `prev >= 0`, set `(after, after_start) = map[i][prev]`.
    - Otherwise append the new cell to the row and continue to the next row.

    Then insert the new cell after `after`.
  - Otherwise the column falls inside `v`'s span: set `v.cell.col_span = v.col_span + 1`, reading
    `col_span` by the live-cell rule. This runs once per row the span covers: `+1` for a frozen
    cell, `+rowSpan` for an already-writable one, as in JS.

The first created cell is remembered. If `should_set_selection` and it exists, call
`move_selection_to_cell(first)`. If `col_widths` is `Some(w)`: `idx = max(ia, 0)`; insert
`w.get(idx).copied().flatten()` at `min(idx, w.len())` (JS `splice` clamps the index and inserts
`undefined` when `w[idx]` is out of range; `JSON.stringify` writes that slot as `null`). The array
always grows by one. Set `col_widths`. Return the first cell.

`insert_table_column_at_selection` mirrors the row version with `start_column`/`col_span`.

```rust
pub fn delete_table_row_at_selection(tx: &mut Transaction) -> Result<()>;   // :608
#[deprecated] pub use delete_table_row_at_selection as delete_table_row__experimental; // :713
```
The selection must be Range or Table. If `is_backward`, swap the anchor and focus nodes.
`(anchor_cell, _, table)` from the anchor, `focus_cell` from the focus.
`(map, av, fv) = compute_table_map(table, anchor_cell, focus_cell)`. `top = av.start_row`,
`bottom = fv.start_row + fv.row_span - 1`.
- If `map.row_count() == bottom - top + 1`, remove the table and return. This does not move
  the selection; core's remove-time selection fixup applies.
- `cols = map.column_count()`, `next_row = map.rows.get(bottom+1)`,
  `next_row_node = table.children[bottom+1]`.
- For `row` from `bottom` down to `top`, and `col` from `cols-1` down to 0, take
  `v = map[row][col]`. Skip if `v.start_column != col`. Then:
  - **Trim.** If `v.start_row < top || v.end_row() > bottom`, set
    `v.cell.row_span = v.row_span - overlap`, where
    `overlap = max(0, min(v.end_row(), bottom) - max(v.start_row, top) + 1)`. Every `row_span` /
    `end_row` here and in the move-down test is a live-cell read (§1b.0): a frozen cell is trimmed
    from its map-time value each visit (same result every time); an already-writable cell is trimmed
    cumulatively, once per visited row, as in JS.
  - **Move down.** If `v.start_row >= top && v.end_row() > bottom && row == bottom`, the
    cell starts in the deleted range and continues below it, so move it into the next row
    (`next_row_node` must exist, else Err):
    1. Scan `ci in 0..col` of `next_row`. If `next_row[ci].start_row == row+1`, set
       `after = that cell`. Then advance `ci` by that cell's `col_span - 1`.
    2. Move `v.cell` to after `after`, or to the first child of `next_row_node` if there
       is no `after`.
  - Then remove the row node `table.children[row]`. Err if it is not a row.
- Selection: if `next_row` exists, `move_selection_to_cell(next_row[0].cell)`. Otherwise
  `move_selection_to_cell(map[top-1][0].cell)`.

```rust
pub fn delete_table_column_at_selection(tx: &mut Transaction) -> Result<()>; // :715
#[deprecated] pub use delete_table_column_at_selection as delete_table_column__experimental; // :797
```
No backward swap. `start = min(av.start_column, fv.start_column)` and
`end = max(av.end_column(), fv.end_column())`. `n = end - start + 1`.
- If `map.column_count() == n`: `table.select_previous()`, remove the table, and return.
- For each row and each `col in start..=end`, take `v = map[row][col]`:
  - If `v.start_column < start`: only when `col == start`, set
    `col_span = v.col_span - min(n, v.col_span - (start - v.start_column))`.
  - Else if `v.end_column() > end`: only when `col == end`, set
    `col_span = v.col_span - (end - v.start_column + 1)`.
  - These run once per row the cell spans (the `col` guard does not dedupe rows); `col_span`,
    `start_column`-relative `end_column` are live-cell reads, so an already-writable cell is reduced
    repeatedly, as in JS.
  - Else remove `v.cell`. This can run more than once for the same cell when it spans rows
    or columns, and removing an already-detached node is a no-op. Rust must make a repeated
    `tx.remove` of a detached node a no-op as well.
- `frow = map[fv.start_row]`. `next = av.start_column > fv.start_column ?
  frow[av.start_column + av.col_span] : frow[fv.start_column + fv.col_span]`. If `next`
  exists, `move_selection_to_cell(next.cell)`. Otherwise use
  `frow[(fv.start_column < av.start_column ? fv.start_column : av.start_column) - 1]`.
  That index can be -1 upstream (TypeError); Rust returns Err.
- If `col_widths` is set, splice out `start..start+n`.

```rust
/// `$moveSelectionToCell`: select start of the parent of the cell's first descendant, or the
/// cell itself when it has no descendant.
fn move_selection_to_cell(tx: &mut Transaction, cell: Id<TableCellNode>) -> Result<()>; // :799
/// `$insertFirst`: insert before the first child, or append when empty.
fn insert_first(tx: &mut Transaction, parent: NodeKey, node: NodeKey) -> Result<()>;   // :808

pub fn merge_cells(tx: &mut Transaction, cells: &[Id<TableCellNode>])
    -> Result<Option<Id<TableCellNode>>>;                                    // :817
```
`merge_cells`:
- Return None when `cells` is empty.
- `table = get_table_node_from_lexical_node(cells[0])`; `map = skip_cell_check(None, None)`.
- **Pass 1.** For each map slot whose cell is in `cells` (first visit per key), grow the
  min/max row and column with `start + span - 1`. If nothing matched, return None.
- `target = map[min_row][min_col].cell`. Set its `col_span = max_col-min_col+1` and
  `row_span = max_row-min_row+1`.
- **Pass 2.** Row-major over the box, first visit per key, excluding the target. The
  current cell's content counts as "empty" when it is exactly one child that is a
  ParagraphNode with `is_empty()`. If not empty, append all its children to the target.
  Then remove the cell. The box covers every slot, so cells **not** in `cells` that fall
  inside it are also merged and removed (upstream behaviour).
- If the target has no children, append a paragraph. Return the target.

```rust
pub fn unmerge_cell(tx: &mut Transaction) -> Result<()>;                     // :926
pub fn unmerge_cell_node(tx: &mut Transaction, cell: Id<TableCellNode>) -> Result<()>; // :941
```
`unmerge_cell`: the selection must be Range or Table. Cell = nearest cell of the **anchor**
node, else Err. Calls `unmerge_cell_node`.

`unmerge_cell_node`:
- Return if both spans are 1. `(map, cv) = compute_table_map(table, cell, cell)`.
- **Header heuristic.**
  - `col_styles[i]` for `i in 0..col_span` starts at `cv.header & COLUMN`, then ANDs in
    `map[r][start_col+i].header_state` for every row `r` (stopping early once it is 0).
  - `row_styles[i]` for `i in 0..row_span` starts at `cv.header & ROW`, then ANDs in every
    `map[start_row+i][c].header_state` for `c in 0..map[0].len`.
- If `col_span > 1`: for `i in 1..col_span`, insert after `cell` a new cell with paragraph
  and header `col_styles[i] | row_styles[0]`. Each insert goes directly after `cell`, so
  the new cells end up in reverse order; all are identical in shape. Then set
  `col_span = 1`.
- If `row_span > 1`: for `i in 1..row_span`:
  1. `current_row = start_row + i`. The row node is the next sibling of the previous one,
     starting from `cell`'s row; Err if it is not a row.
  2. `after = last cell c in map[current_row][0..start_col]` with
     `c.start_row == current_row`. Skip ahead by `col_span - 1` after each.
  3. Insert `col_span` new cells with headers `col_styles[j] | row_styles[i]` for `j` from
     `col_span-1` down to 0. Put each after `after`, or first in the row when there is no
     `after`. With repeated insert-after or insert-first, the final left-to-right order is
     `j = 0..col_span`.

  Then set `row_span = 1`.

```rust
pub fn is_simple_table(state: &EditorState, table: Id<TableNode>) -> bool;  // :1262
pub fn move_table_column(tx: &mut Transaction, table: Id<TableNode>, origin: u32, target: u32)
    -> Result<()>;                                                           // :1296
```
- `is_simple_table`: every child is a row, every row has the same child count as the first,
  and every child is a cell with spans 1/1. Also requires `column count > 0`.
- `move_table_column`: no-op if `origin == target`, if either index is outside
  `0..column_count`, or if the table is not simple. Otherwise, for each row, take its
  children, splice the cell out of `origin` into `target`, then `tx.splice(row, 0, len,
  reordered)`. If `col_widths.len() == column_count`, move the width the same way.

### 1b.5 TableSelection (`selection.rs`)

**Decided (S1 §9.1, CR-7): `Selection::Table(TableSelection)` as a core variant, with the data struct in
`lexical_model` and the behaviour supplied by this crate through a registered hook.**
Core must own the variant. The selection lives in `EditorState`, and core code clones it,
compares it (`is`), runs `is_backward`, remaps points on node removal, and matches it
exhaustively. Core cannot depend on table nodes, though. `get_nodes` needs the span map, and
`LexicalNode::is_selected`, clipboard export and `extract` call it. So core calls a hook
trait object installed at build time. This is the one core-API addition this section needs.

S1 R1 adopted this (S1 §9.1, §4.2); the core block is S1's, reproduced here:

```rust
// --- in lexical_model (core), S1 §9.1 ---
pub struct TableSelection { pub table: NodeKey, pub anchor: Point, pub focus: Point, dirty: bool }
impl TableSelection {
    pub fn new(table: NodeKey, anchor_cell: NodeKey, focus_cell: NodeKey) -> TableSelection;
    pub fn set(&mut self, table: NodeKey, anchor_cell: NodeKey, focus_cell: NodeKey);
    pub fn is_dirty(&self) -> bool;
    pub fn is_valid(&self, view: StateRef<'_>) -> bool;
}
pub enum Selection { Range(RangeSelection), Node(NodeSelection), Table(TableSelection) }

pub trait TableSelectionHooks: Send + Sync + 'static {
    fn nodes(&self, view: StateRef<'_>, selection: &TableSelection) -> Result<Vec<NodeKey>, Error>;
    fn text_content(&self, view: StateRef<'_>, selection: &TableSelection) -> Result<String, Error>;
    fn insert_nodes(&self, tx: &mut Transaction<'_>, slot: SelectionSlot, nodes: &[NodeKey]) -> Result<(), Error>;
}
// Editor::builder(mode).table_selection_hooks(&TableSelectionHooksImpl)   // &'static dyn
// With no hooks registered, a Selection::Table operation is Err(UnsupportedSelection).
```

Core-implemented semantics, which have no table dependency:
- `is_collapsed() == false`.
- `is_backward() = focus.is_before(anchor)`.
- `get_start_end_points() = (anchor, focus)`.
- `is(other)`: same variant, same `table`, anchor and focus `Point::is`.
- `insert_text` / `insert_raw_text`: no-op (`LexicalTableSelection.ts:213-219`).
- `extract() = get_nodes()`.
- `is_valid(state)`: `table`, `anchor.key` and `focus.key` are not `root`, both points are
  `Element`, and all three keys exist (`:139`).

Dropped: `_cachedNodes` (core memoizes `nodes` per write counter). `dirty` and `set()` are kept
(S1 §9.1; `dirty` feeds `editorStateHasDirtySelection`).

```rust
// --- in lexical_rich_nodes::table::selection ---
/// Typed wrapper over `TableSelection::new` (`$createTableSelection()` + `.set(table, anchor,
/// focus)`: element points, offset 0). A free fn: the type is foreign to this crate.
pub fn table_selection(table: Id<TableNode>, anchor: Id<TableCellNode>, focus: Id<TableCellNode>)
    -> TableSelection;
pub fn create_table_selection_from(tx: &Transaction, table: Id<TableNode>,
                                   anchor: Id<TableCellNode>, focus: Id<TableCellNode>)
    -> Result<TableSelection>;                                               // :398
pub fn is_table_selection(sel: Option<&Selection>) -> bool;                  // :383

/// `TableSelection: Copy` (CR-25), so every method takes `self` by value next to the view or
/// `&mut Transaction` (R2-47, R2-52; S1 §9.1).
pub trait TableSelectionExt {
    fn get_nodes(self, view: StateRef<'_>) -> Result<Vec<NodeKey>>;        // :295
    fn get_shape(self, view: StateRef<'_>) -> Result<TableSelectionShape>; // :256
    fn has_format(self, view: StateRef<'_>, f: TextFormatType) -> Result<bool>; // :228
    fn text_content(self, view: StateRef<'_>) -> Result<String>;          // :370
    fn insert_nodes(self, tx: &mut Transaction, nodes: &[NodeKey]) -> Result<()>; // :243
}
impl TableSelectionExt for TableSelection { .. }
pub struct TableSelectionHooksImpl;  // impl lexical_model::TableSelectionHooks by delegating

pub struct TableSelectionShape { pub from_x: u32, pub from_y: u32, pub to_x: u32, pub to_y: u32 }

/// `$visitRecursively`: explicit-stack DFS; visits `node`, then its children LAST-TO-FIRST
/// (pop from the end of each child array). If `visit` returns false, the node's children are skipped.
pub fn visit_recursively(state: &EditorState, node: NodeKey,
                         visit: &mut dyn FnMut(NodeKey) -> bool);            // :443
```

- `create_table_selection_from`. Upstream validates only in `__DEV__`; Rust always
  validates and returns Err:
  - The table must be attached.
  - `find_table_node(anchor) == table` and `find_table_node(focus) == table`.

  If the current selection is a TableSelection, clone it (keeping its point offsets) and
  replace the three keys. Otherwise use `TableSelection::new`. It does not set the selection.
- `$getCellNodes` (`:55`). For each of anchor/focus: nearest cell ancestor-or-self of the
  point node, else Err. Its parent must be a row and the row's parent a table, else Err.
  Then `anchor_table == focus_table`, else Err.
- `get_nodes`:
  1. Return `[]` if `!is_valid`.
  2. Get the cells.
  3. **Nested-table fix** (`:306`). Let `focus_grid` be the focus cell's grandparent
     (`getParents()[1]`). If `focus_grid != anchor_table`:
     - If `anchor_table` is not an ancestor of the focus cell: anchor key :=
       `anchor_table.parent`.
     - Otherwise: focus key := `focus_grid.parent`.

     Recurse. Upstream writes this into the live selection. Rust recomputes on a local copy,
     and `handlers::normalize_table_selection(tx)` persists the same rewrite. Call it from
     the selection-change path. Nested tables are off in Macro.
  4. `(map, a, f) = compute_table_map(anchor_table, anchor_cell, focus_cell)`, then
     `rect = boundary(map, a, f)`.
  5. Output, using an insertion-ordered set: the table key first. Then, row-major over
     `rect`: the cell's row key, added when the row differs from the previous slot's row
     (insertion order is kept, so the row key appears where first inserted). If the cell
     key is not yet present, add the cell's subtree via `visit_recursively`: the cell, then
     its children last-to-first, depth-first.
- `get_shape`: `get_table_cell_node_rect` for both cells (Err if None).
  `from_x = min(colA, colF)` and `to_x = max(colA+csA-1, colF+csF-1)`; the same for y. The
  final min/max swap upstream is redundant; keep the result identical.
- `has_format`: OR together `first_child.text_format` over every cell in `get_nodes` whose
  first child is a ParagraphNode. True if that has the bit.
- `text_content`: cells = `get_nodes` filtered to cells. For each cell `i`:
  `text(cell) + (parent(cells[i+1]) != parent(cell) ? "\n" : "\t")`. The last cell always
  gets `"\n"`.
- `insert_nodes`: the focus node must be an element, else Err. Build
  `RangeSelection = focus.select(0, children_len)`, run `normalize_selection` (core
  `$normalizeSelection__EXPERIMENTAL`), then core `insert_nodes(nodes)`.

### 1b.6 Transforms and registration (`transforms.rs`, `mod.rs`)

```rust
pub struct TableConfig {
    pub has_cell_merge: bool,            // default true;  false => register unmerge transform
    pub has_cell_background_color: bool, // default true;  false => register bg-strip transform
    pub has_nested_tables: bool,         // default false
    // has_tab_handler / has_horizontal_scroll are view-only: JS reads them.
}
pub fn register_table(builder: EditorBuilder, config: &TableConfig) -> EditorBuilder;
```
`register_table` registers TableNode, TableRowNode and TableCellNode, the three integrity
transforms, `TableSelectionHooksImpl`, the unmerge transform when `!has_cell_merge`, and the
bg-strip transform when `!has_cell_background_color` (`LexicalTableExtension.ts:56-103`).
Upstream toggles these at runtime through signals. Rust fixes them at build time; changing
config means building a new editor. Macro registers through `registerTablePlugin(editor)`
without options, so `has_nested_tables = false`, and passes `!hasCellMerge`,
`hasCellBackgroundColor` and `hasTabHandler` from its props (`apps/web/.../tables/tablePlugin.ts`).

```rust
fn table_transform(tx: &mut Transaction, node: Id<TableNode>) -> Result<()>;          // :130
fn table_row_transform(tx: &mut Transaction, node: Id<TableRowNode>) -> Result<()>;   // :120
fn table_cell_transform(tx: &mut Transaction, node: Id<TableCellNode>) -> Result<()>; // :110
pub fn table_cell_unmerge_transform(tx: &mut Transaction, node: Id<TableCellNode>) -> Result<()>; // :267
fn table_cell_background_strip_transform(tx: &mut Transaction, node: Id<TableCellNode>) -> Result<()>; // Ext :96
```
- `table_cell_transform`: if the parent is not a TableRowNode, remove the cell. Else if the
  cell is empty, append a paragraph.
- `table_row_transform`: if the parent is not a TableNode, remove the row. Otherwise call
  `lexical_rich_nodes::utils::unwrap_and_filter_descendants(row, is TableCellNode)`. That is a
  last-to-first DFS: each non-matching child is removed after its matching descendants are
  hoisted to after it.
- `table_transform`:
  1. `unwrap_and_filter_descendants(table, is TableRowNode)`.
  2. `map = skip_cell_check`. `max = max row length over map.rows`, where length is the Vec
     length including holes.
  3. For each map row `i` that has a row node, every row node must be a TableRowNode, else
     Err. `filled = count of Some slots in map.rows[i]`. Append `max - filled` new cells
     (NO_STATUS, with paragraph) to the row. The upstream TODO about header inheritance
     stays: new cells have no header.
  4. `cc = column_count()`. If `col_widths` is `Some(w)` and `w.len() != cc`:
     - If `cc < w.len()`, truncate to `cc`.
     - Else if `w` is non-empty, pad with the last width.
     - Else (empty with `cc > 0`), set None.
- `table_cell_unmerge_transform`: runs only when `col_span > 1 || row_span > 1`.
  1. `(map) = compute_table_map(table, node, node)`. `rows = map.row_count()`,
     `cols = map.column_count()`.
  2. Walk the row nodes in step with `i` (Err if a sibling is not a row). For each `j`,
     take `v = map[i][j]`:
     - If `(v.start_row, v.start_column) == (i, j)`, set `last = v.cell` and push `v.cell`
       onto the unmerge list.
     - Else if `v.col_span > 1 || v.row_span > 1`, create `TableCellNode::new(v.header_state,
       1, None)` with **no paragraph**; the cell transform adds it on the next pass. Insert
       it after `last`, or first in the row.
  3. Set every listed cell to 1/1.

  Note: `last` is not updated to the inserted cell, so several new cells in one row are
  each inserted directly after `last` (reverse order, all identical).
- `table_cell_background_strip_transform`: if `background_color.is_some()`, set None.

### 1b.7 Commands (`commands.rs`)

```rust
pub struct InsertTablePayload { pub rows: u32, pub columns: u32, pub include_headers: IncludeHeaders }
pub fn insert_table(tx: &mut Transaction, p: &InsertTablePayload, has_nested_tables: bool)
    -> Result<bool>;                                                        // PluginHelpers :81
```
`INSERT_TABLE_COMMAND` handler. Upstream's payload uses strings run through `Number()`;
parse them at the JS boundary. `NaN` gives zero rows upstream, so a JS caller passing
garbage gets `rows = 0`.
1. `sel = tx.selection() or tx.previous_selection()`. It must be Range, else return
   `Ok(false)`.
2. If `!has_nested_tables` and `find_table_node(anchor)` is Some, return `Ok(false)`.
3. Create the table with `create_table_node_with_dimensions` and insert it with
   `lexical_rich_nodes::utils::insert_node_to_nearest_root`.
4. If the table's first descendant is a TextNode, `select()` it.
5. Return `Ok(true)`.

```rust
pub fn select_all_in_table(tx: &mut Transaction) -> Result<bool>;          // :206
```
`SELECT_ALL_COMMAND` at LOW priority. Applies only when the selection is Range, the anchor
is in a table, that table's parent is root, and root has exactly one child. Builds
`skip_cell_check(None, None)`; returns false if the map is empty or row 0 is empty. Sets
`create_table_selection_from(table, map[0][0], last entry of last row)`.

```rust
pub fn select_block_in_cell(tx: &mut Transaction, start: NodeKey) -> Result<bool>; // :183
```
Triple-click (`CLICK_COMMAND`, `detail >= 3`). JS resolves `start` from the event target
with `$getNearestNodeFromDOMNode`. Find the nearest non-inline element ancestor-or-self. If
its parent is a TableCellNode, run `block.select(0, 0)` and return true.

```rust
pub fn insert_clipboard_nodes_in_table(tx: &mut Transaction, nodes: &[NodeKey],
                                       selection: SelectionSlot, has_nested_tables: bool)   // R2-07
    -> Result<bool>;                                                        // :449
fn insert_table_into_grid(tx: &mut Transaction, template: Id<TableNode>, selection: &Selection)
    -> Result<bool>;                                                        // :500
fn is_multi_cell_table_selection(state: &EditorState, sel: &Selection) -> bool; // :677
```
`SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler. JS checks
`editor === dispatchEditor` first.
1. Return false unless some node is a table or contains one (`$dfs`).
2. Inside-grid means: a Range selection whose anchor and focus both have cell ancestors,
   or any TableSelection. Return false otherwise.
3. If `nodes == [one TableNode]`, return `insert_table_into_grid`.
4. If the selection is Range, `has_nested_tables`, and not multi-cell, return false.
5. Otherwise return true. The paste is swallowed.

`is_multi_cell_table_selection`: a Table selection whose focus node is not its anchor node,
or a Range selection whose anchor node *is* a cell that differs from the focus node.

`insert_table_into_grid`:
- `(anchor_cell, anchor_row, grid) = triplet(anchor)`. `focus_cell` = nearest cell of the
  focus. `(init, av, fv) = compute_table_map(grid, anchor_cell, focus_cell)`.
  `tmpl = skip_cell_check(template)`.
- `start_row = av.start_row`, `start_col = av.start_column`. `rows_n = tmpl.row_count()`,
  `cols_n = tmpl.column_count()`. For a Table selection, clamp to its boundary instead:
  `start = (min_row, min_col)` and `n = min(n, boundary extent)`.
- **Step 1, unmerge.** For each slot in
  `[start_row, min(init_rows, start_row+rows_n)) x [start_col, min(init_cols, start_col+cols_n))`
  whose cell has span != 1/1 and was not yet handled, call `unmerge_cell_node` and set
  `did_merge`.
- **Step 2, grow.** Recompute `interim`. Do `rows_n - init_rows + start_row` times:
  `insert_table_row_at_node(interim[init_rows-1][0].cell, true)`. Do
  `cols_n - init_cols + start_col` times:
  `insert_table_column_at_node(interim[0][init_cols-1].cell, true, false)`. Both use the
  stale `interim` cell on purpose, so each insert lands after the previous one.
- **Step 3, merge and fill.** Recompute `interim`. For each template origin slot `(tr, tc)`:
  - If the template cell spans, merge `interim` cells over
    `[row, min(row+rs, start_row+rows_n)) x [col, min(col+cs, start_col+cols_n))` and set
    `did_merge`.
  - `cell = interim[row][col].cell`. This reuses the pre-merge interim map, which is the
    upstream behaviour.
  - Copy `background_color` if Some.
  - Move every template child into `cell`. A TextNode child is moved directly into the
    cell: upstream creates a wrapper paragraph, appends the text to it, then immediately
    re-appends the text to the cell (`:648-652`). The paragraph stays detached; Rust does
    not create it.
  - Remove the cell's original children.
- If the selection is Table and `did_merge`, recompute and `select_end()` the cell at
  `(av.start_row, av.start_column)`.
- Return true.

### 1b.8 TableObserver, model half (`observer.rs`)

`TableObserver` and `TableObservers` stay JS classes. They hold pointer and drag state
(`isSelecting`, `pointerType`, `nextFocus`, `shouldCheckSelectionForTable`), highlight
state (`isHighlightingCells`, `hasHijackedSelectionStyles`), `anchorX/Y`, `focusX/Y`, and
listener lifecycle (`AbortController`, `MutationObserver`). The `table` field becomes a
`TableGrid` fetched from Rust instead of `getTable(tableNode, tableElement)`. Its
`$`-methods become JS wrappers over the Rust functions below.

```rust
pub enum ClearText {
    /// Whole table selected: selected previous, removed table. JS must dispatch
    /// INSERT_PARAGRAPH_COMMAND iff `root_emptied`. No SELECTION_CHANGE dispatch upstream.
    TableRemoved { root_emptied: bool },
    /// Cells cleared, selection set to None. JS clears cell highlights
    /// ($updateDOMForSelection(grid, null)) and dispatches SELECTION_CHANGE_COMMAND.
    CellsCleared,
}
pub fn clear_text(tx: &mut Transaction, table: NodeKey) -> Result<ClearText>; // Observer :516
```
`clear_text` follows the Macro patch:
1. `table` must be a TableNode, else `Err("Expected TableNode.")`. The selection must be
   Table, else Err.
2. `cells` = `get_nodes()` filtered to cells, in get_nodes order (row-major first
   occurrence).
3. Whole-table check: `cells` is non-empty, the table's first and last children are rows,
   `cells[0] == first_row.first_child`, and `cells.last() == last_row.last_child`. If so:
   `table.select_previous()`, `parent = table.parent`, remove the table. Return
   `TableRemoved { root_emptied: parent is root && root is empty }`.
4. Otherwise, for each cell: create **one empty ParagraphNode with no TextNode child**,
   append it to the cell, then remove every other child of the cell.
5. `tx.set_selection(None)`. Return `CellsCleared`.

Patch, quoted from [table patch](../../../apps/web/patches/%40lexical%252Ftable%400.45.0.patch#L51-L59), which hunks
`src/LexicalTableObserver.ts` at `@@ -555,8 +555,6 @@`. The same two-line removal is applied to
all four `dist/` bundles:

```diff
     selectedNodes.forEach(cellNode => {
       if ($isElementNode(cellNode)) {
         const paragraphNode = $createParagraphNode();
-        const textNode = $createTextNode();
-        paragraphNode.append(textNode);
         cellNode.append(paragraphNode);
         cellNode.getChildren().forEach(child => {
           if (child !== paragraphNode) {
```

Upstream (before) at `LexicalTableObserver.ts:555-567` appended `$createTextNode()` to the
fresh paragraph. The Macro version (after) leaves the paragraph childless. Reason, per
notes-macro.md: the text normalizer removed that empty TextNode mid-transform, which threw
`"__first" is read-only` under the Loro collab layer and rolled back the update.

Guard test, verified at
`apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableClear.test.ts:135`:
`it('leaves each cleared cell with a childless paragraph (no empty TextNode)')`. It selects
cell (0,0) with `$createTableSelection().set(...)` and dispatches `KEY_DELETE_COMMAND`. It
asserts that `$getCell(0,0).getChildren()` has length 1, that the child is a ParagraphNode,
and that `getChildrenSize() === 0`. Siblings at `:78`, `:97` and `:116` (cut, Delete,
Backspace) assert the text grid after clearing. Port all four as Rust model tests by calling
`clear_text` directly with a TableSelection.

```rust
pub fn format_cells(tx: &mut Transaction, format: TextFormatType) -> Result<()>; // Observer :488
```
1. The selection must be Table, else Err. `cells` = get_nodes filtered to cells; must be
   non-empty, else `Err(Error::Invariant("No table cells present"))`.
2. `align = cells[0].first_child is ParagraphNode ? Some(toggle_text_format_type(p.text_format,
   format, None)) : None`. This is `getFormatFlags(type, null)`.
3. For each cell, build a detached RangeSelection `anchor = (cell, 0, Element)`,
   `focus = (cell, children_len, Element)`, put it in a detached slot
   (`slot = tx.detach_selection(Selection::Range(range))`) and call
   `tx.format_text_at(slot, format, align)` (S1 §7.6, §9.4). The range is never installed as the
   editor selection.
4. Re-install the original TableSelection with `tx.set_selection`. JS dispatches
   SELECTION_CHANGE_COMMAND.

```rust
/// Model effect of `$setFocusCellForSelection` once it decides to highlight:
/// `create_table_selection_from(table, anchor, focus)` + `tx.set_selection`. Returns the selection
/// so the JS observer can store it as `tableSelection`. JS then dispatches SELECTION_CHANGE_COMMAND
/// and repaints highlights.
pub fn select_cells(tx: &mut Transaction, table: Id<TableNode>, anchor: Id<TableCellNode>,
                    focus: Id<TableCellNode>) -> Result<TableSelection>;      // Observer :411-418
```

(R2.1) The observer's model handlers accept a view-made table selection: the view sends
`ViewSelection::Table { table, anchor_cell, focus_cell }` (S1 §9.2, S12 §1.12) and the core installs
`Selection::Table(TableSelection::new(..))`, keeping the model selection when it is invalid. The
model halves below (`select_cells`, `format_cells`, `clear_text`) read the installed selection with
`Selection::as_table()`, whichever path installed it.

How the observer methods split:

| Observer method | Source | Split |
| --- | --- | --- |
| `$setAnchorCellForSelection(cell)` | `LexicalTableObserver.ts:451` | JS state reset. The model part is `create_table_selection_from(table, cell, cell)`, stored in JS and **not** installed. The Rust grid gives the cell key directly; there is no `$getNearestTableCellInTableFromDOMNode`. |
| `$setFocusCellForSelection(cell, ignoreStart)` | `:354` | JS bookkeeping (highlight enable, same-cell early return). The model part is `select_cells`. The "coords fallback" (`:400`) becomes `grid.cell_at(x, y)`. |
| `$clearHighlight(setEmpty)` | `:274` | JS DOM. Model part: `tx.set_selection(None)` when `setEmpty` and the selection is non-null. JS then dispatches SELECTION_CHANGE. |
| `$updateTableTableSelection` | `:320` | JS only. Its key-mismatch invariant becomes a JS assert. |
| `$enable/$disableHighlightStyle`, `updateDOMSelection`, `trackTable`, `removeListeners`, `$lookup` | `:299/:311/:340/:228/:213/:221` | JS only. `trackTable`'s MutationObserver redraw becomes "re-fetch `table_grid` after each commit that touched this table's subtree". |
| `$getAnchorTableCell(OrThrow)`, `$getFocusTableCell(OrThrow)` | `:427-449` | `tx.get::<TableCellNode>(key)`. |
| `$formatCells` | `:488` | `format_cells`. |
| `$clearText` | `:516` | `clear_text`. |

### 1b.9 TableGrid, the model replacement for TableDOMTable (`grid.rs`)

Upstream `getTable(tableNode, tableElement)` (`LexicalTableSelectionHelpers.ts:1263`) walks
the DOM. It starts at the first `<tr>`, and each `<td>`/`<th>` gets
`TableDOMCell {elem, x, y, highlighted, hasBackgroundColor}`, where
- **`x` is the cell's DOM child index in its `<tr>` (NOT span-aware)**, and `y` is the
  `<tr>` index;
- `columns = (child count of the last <tr>)` (the final `x + 1`), and `rows = <tr> count`;
- the `<td>` gets a `_cell` expando pointing back to its TableDOMCell.

Navigation (`selectTableNodeInDirection`, `getCordsFromCellNode`, the deprecated
insert/delete helpers) runs in these *physical* coordinates. Span-aware logic uses
`$computeTableMap`. `TableGrid` carries both, computed from the model.

```rust
#[derive(Clone, Debug, PartialEq, Serialize)]   // Serialize for the wasm boundary
pub struct TableGrid {
    pub table: Id<TableNode>,
    /// Physical layout: `physical[y][x]` = key of the x-th cell child of the y-th row.
    pub physical: Vec<Vec<Id<TableCellNode>>>,
    /// `TableDOMTable.rows`: number of rows.
    pub rows: u32,
    /// `TableDOMTable.columns`: child count of the LAST row (upstream quirk, kept).
    pub columns: u32,
    /// Span-aware map (`$computeTableMapSkipCellCheck(table, null, null)`).
    pub map: TableMap,
}

pub fn table_grid(state: &EditorState, table: Id<TableNode>) -> Result<TableGrid>;

impl TableGrid {
    /// `getDOMCellFromCords` / `getCellNodeFromCords` (TableNode :493/:531): None if row y is
    /// missing (or y < 0); x >= row.len() clamps to the last cell; x < 0 => None.
    pub fn cell_at(&self, x: i64, y: i64) -> Option<Id<TableCellNode>>;
    /// `*OrThrow` variants: Err("Cell not found at cords.").
    pub fn cell_at_or_err(&self, x: i64, y: i64) -> Result<Id<TableCellNode>>;
    /// `getCordsFromCellNode` (TableNode :464): physical (x, y); Err("Cell not found in table.").
    pub fn coords_of(&self, cell: Id<TableCellNode>) -> Result<(u32, u32)>;
    /// Span-aware slot lookup.
    pub fn slot(&self, row: u32, col: u32) -> Option<&TableMapValue>;
    /// `$forEachTableCell` order (y then x over physical).
    pub fn cells(&self) -> impl Iterator<Item = (Id<TableCellNode>, u32, u32)> + '_;
}

pub enum CellMove {
    /// selectStart() if `from_start`, else selectEnd() on `cell`.
    Cell { cell: Id<TableCellNode>, from_start: bool },
    SelectPreviousOfTable,
    SelectNextOfTable,
}
/// `selectTableNodeInDirection` (:1456) decision, in physical coordinates:
/// - forward/backward: if x != (fwd ? columns-1 : 0) -> cell_at(x±1, y);
///   else if y != (fwd ? rows-1 : 0) -> cell_at(fwd ? 0 : columns-1, y±1);
///   else -> SelectNext/PreviousOfTable. `from_start = fwd`.
/// - up: y != 0 -> cell_at(x, y-1), from_start false; else SelectPreviousOfTable.
/// - down: y != rows-1 -> cell_at(x, y+1), from_start true; else SelectNextOfTable.
/// Cell lookups use `cell_at_or_err`.
pub fn next_cell_in_direction(grid: &TableGrid, x: u32, y: u32, dir: TableDirection)
    -> Result<CellMove>;
pub fn apply_cell_move(tx: &mut Transaction, table: Id<TableNode>, m: CellMove) -> Result<()>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TableDirection { Backward, Forward, Up, Down }

/// `$updateDOMForSelection` (:1339) model input: the key set from `selection.get_nodes()`
/// (Range or Table). JS marks a cell highlighted iff its key is in the set.
pub fn selected_node_keys(state: &EditorState, sel: Option<&Selection>) -> Result<HashSet<NodeKey>>;
```

The JS view keeps:
- `Map<NodeKey, HTMLTableCellElement>`, filled from `editor.getElementByKey(cellKey)` for
  every key in `grid.physical`. It replaces the `_cell` expando, and the reverse
  `elem -> key` map replaces `getDOMCellFromTarget` / `getDOMCellInTableFromTarget`.
- Per-cell `highlighted` (written only by the highlight helpers). `hasBackgroundColor` is
  written but never read upstream; drop it.
- Rect queries and hit-testing: `document.elementsFromPoint` on pointermove, plus the
  "caret on visual edge line" test in `$handleArrowKey`: `getBoundingClientRect` of the anchor
  DOM, or the DOM range for text points, compared with the first or last child block rect of
  the cell. JS answers it as a boolean through `TableView::caret_exits_cell` (1b.10).
- Highlight class toggling and `removeAllRanges`.

Consumers of the DOM grid in `LexicalTableSelectionHelpers.ts` and their model replacements:

| Upstream consumer | Source | Replacement |
| --- | --- | --- |
| `getTable(tableNode, dom)` | `:1263` | `table_grid(state, table)`, plus a JS key-to-element map |
| `$getElementForTableNode(editor, table)` | `LexicalTableNode.ts:620` | `table_grid` |
| `TableNode.getCordsFromCellNode(cell, grid)` | `LexicalTableNode.ts:464` | `grid.coords_of(cell)` |
| `TableNode.getDOMCellFromCords(OrThrow)` | `:493/:517` | `grid.cell_at(_or_err)`; JS maps key to element |
| `TableNode.getCellNodeFromCords(OrThrow)` | `:531/:551` | `grid.cell_at(_or_err)` |
| `$getObserverCellFromCellNodeOrThrow(observer, cell)` | `:2384` | identity: the cell key is the grid cell. JS looks up its element |
| `$getNearestTableCellInTableFromDOMNode(table, dom)` | `:2400` | JS `elem -> key`, then `find_parent_table_cell_node_in_table` |
| `$forEachTableCell(grid, cb)` | `:1361` | `grid.cells()` |
| `$updateDOMForSelection(editor, grid, sel)` | `:1339` | `selected_node_keys` + JS class toggle |
| `$addHighlightStyleToTable` / `$removeHighlightStyleToTable` | `:1397/:1408` | JS over `grid.cells()` |
| `$handleArrowKey` (cords, `getDOMCellFromCordsOrThrow`, `tableObserver.table = getTable(...)`) | `:1897` | `handle_arrow_key` + `TableView` (1b.10). The grid is always fresh, so the `observer.table` refresh goes away |
| `selectTableNodeInDirection` | `:1456` | `next_cell_in_direction` + `apply_cell_move` |
| `$adjustFocusInDirection` (`$getObserverCellFromCellNodeOrThrow`) | `:1633` | `adjust_focus_in_direction`, which returns cell keys |
| `$handleHorizontalArrowKeyRangeSelection` (`getDOMCellFromTarget(getElementByKey)`) | `:1788` | Rust caret logic. The DOM presence check becomes `TableView::has_cell_element(key)` |
| `$insertTableRow` / `$insertTableColumn` (deprecated; sibling lookup) | `LexicalTableUtils.ts:172/:376` | take `&TableGrid` |
| `$getTableCellSiblingsFromTableCellNode` | `LexicalTableUtils.ts:140` | `grid.coords_of` + `grid.cell_at` (private) |

### 1b.10 Handlers, model halves (`handlers.rs`)

JS registers the commands at the same priorities as upstream (HIGH unless noted) and calls
these functions. `stopEvent` stays JS.

```rust
/// What the JS view supplies for the DOM-dependent decisions in arrow handling.
pub trait TableView {
    /// `isTypeaheadMenuInView`: root has aria-controls="typeahead-menu".
    fn is_typeahead_open(&self) -> bool;
    /// The DOM element for `key` exists (getElementByKey != null, and for cells the observer
    /// knows it).
    fn has_cell_element(&self, key: NodeKey) -> bool;
    /// `$handleArrowKey` :2143-2181. Returns None when any DOM lookup fails (handler returns false).
    /// up:   edgeChildRect.top > caretRect.top - caretRect.height
    /// down: caretRect.bottom + caretRect.height > edgeChildRect.bottom
    /// caretRect is anchorDOM.getBoundingClientRect() for element points, else the DOM range's.
    fn caret_exits_cell(&self, anchor: &Point, edge_child: NodeKey, dir: TableDirection)
        -> Option<bool>;
}

pub enum ObserverEffect {
    None,
    /// JS: observer.$setAnchorCellForSelection(anchor); observer.$setFocusCellForSelection(focus, true)
    SelectCells { table: Id<TableNode>, anchor: Id<TableCellNode>, focus: Id<TableCellNode> },
    /// JS: observer.$updateTableTableSelection(current); $setAnchorCellForSelection(anchor);
    /// then optionally the SelectCells pair.
    ResyncFromTableSelection { anchor: Id<TableCellNode>,
                               then: Option<(Id<TableCellNode>, Id<TableCellNode>)> },
    /// JS: if $isScrollableTablesActive(editor) tableObservers.setShouldCheckSelectionForTable(table).
    CheckSelectionAfterDown { table: Id<TableNode> },
}
pub struct HandlerResult { pub handled: bool, pub stop_event: bool, pub effect: ObserverEffect }

pub fn handle_arrow_key(tx: &mut Transaction, table: Id<TableNode>, dir: TableDirection,
                        shift: bool, view: &dyn TableView) -> Result<HandlerResult>; // :1897
```

`handle_arrow_key` follows upstream line by line:
- **Typeahead.** For up/down with `view.is_typeahead_open()`, return not handled.
- **Selection not in `table`** (`:1915`). Range selection:
  - **Backward.** Return false if `focus.offset > 0`.
    `get_block_parent_if_first_node(focus)` (`:1767`) walks up while each element is the
    initial node or its parent's first child, and returns the first non-inline element.
    Its previous sibling must be a TableNode. Then `stop`:
    - shift: `focus = (sibling.parent, sibling.index, Element)`;
    - otherwise `sibling.select_end()`.

    Handled.
  - **Shift + up/down.**
    - **Unselect.** The selection is not collapsed and (up && forward or down && backward).
      `fp` = nearest TableNode ancestor of the focus. The dead `$isTableCellNode` re-check
      is kept as a no-op. `fp` must equal `table`. Take the sibling in the direction (none →
      false). Offset: for up with an element sibling, `children_len`. Focus node: for up
      with an element sibling, its last child or itself, and the offset becomes
      `text_size` for text, else 0. Set focus (Text or Element), `set_selection(clone)`,
      stop, handled.
    - **Root or shadow root focus.** `sel_node = up ? nodes.last : nodes[0]`. If
      `find_parent_table_cell_node_in_table(table, sel_node)` is Some, the first and last
      cells come from the triplets of the table's first and last descendants. Return
      handled with `SelectCells{first, last}` and **no stop**. Otherwise false.
    - **Otherwise.** `fp` = nearest non-inline element; if it is a cell, use its table. If
      the sibling in the direction is a TableNode whose key equals `table`, set focus to
      the first or last cell (`(first,0)` up, `(last, children_len)` down) as an Element
      point. Stop, handled.
  - **Fallthrough.** If dir is Down, return not handled with
    `CheckSelectionAfterDown{table}`. Otherwise not handled.
- **Range in table** (`:2091`):
  - **Backward/forward.** Call `handle_horizontal_arrow_key_range_selection(tx, sel,
    extend = shift, backward, table, view)` (`:1788`) using core carets:
    1. `initial = caret_from_point(focus, backward ? Previous : Next)`. If it is an
       extendable text point caret, return false.
    2. Iterate `extend_caret_to_range(initial).iter_node_carets(ShadowRoot)`. Every caret
       must be a sibling caret on an element, else false. Keep the last one.
    3. Its `parent_at_caret` must be a cell (`anchor_cell`), and that cell's table must
       equal `table`.
    4. `focus_caret = find_next_table_cell(sibling_caret(anchor_cell, dir))` (`:1877`):
       iterate root carets, skipping rows, until a child caret on a cell; None otherwise.
    5. `view.has_cell_element(anchor_cell)` must be true.
    6. Then:
       - No `focus_caret` and extend: `SelectCells{anchor_cell, anchor_cell}`.
       - No `focus_caret`, move: exit point =
         `get_table_exit_caret(sibling_caret(table, initial.dir))` (`:1870`), i.e. the
         adjacent child caret normalized, else the sibling caret. Set anchor and focus to
         it.
       - Extend: the focus cell must have an element (else false); `SelectCells{anchor_cell,
         focus_caret.origin}`.
       - Move: set both points to `normalize_caret(focus_caret)`.

       Stop, handled.
  - **Collapsed up/down.**
    1. The anchor and focus cells must be the same cell.
    2. If that cell's table is not `table`, recurse with that table. Upstream also keeps
       the outer observer; the effect then names the inner table, which is moot because
       Macro has no nested tables.
    3. `edge = up ? cell.first_child : cell.last_child`; return false if there is none.
    4. `exits = view.caret_exits_cell(anchor, edge, dir)`; return false if it is None.
    5. If `exits`: stop. `(x,y) = grid.coords_of(cell)`. With shift, return
       `SelectCells{cell, cell}` (handled). Otherwise `apply_cell_move(next_cell_in_direction)`,
       handled.
  - Otherwise not handled.
- **Table selection** (`:2212`):
  1. Return false if `sel.table != table`.
  2. The anchor and focus cells come from the points. `get_nodes()[0]` must be a
     TableNode, else Err.
  3. Stop.
  4. With shift: `(map, a, f) = compute_table_map(table, anchor, focus)`, then
     `adjust_focus_in_direction`. If it returns Some, the result is handled with
     `ResyncFromTableSelection{anchor, then: Some(pair)}`. If None, the result is not
     handled with `ResyncFromTableSelection{anchor, then: None}`, still stopped (upstream
     returns false after stopEvent).
  5. Without shift: `focus_cell.select_end()`, handled with
     `ResyncFromTableSelection{anchor, then: None}`.

```rust
/// `$adjustFocusInDirection` (:1633) model core: returns (final_anchor, final_focus) or None.
pub fn adjust_focus_in_direction(map: &TableMap, anchor: &TableMapValue, focus: &TableMapValue,
                                 dir: TableDirection) -> Result<Option<(Id<TableCellNode>, Id<TableCellNode>)>>;
```
1. `rect = boundary(anchor, focus)`, `spans = rect_spans(rect)`.
2. `anchor_corner = get_corner(rect, anchor)`, else Err (`getCornerOrThrow`).
   `get_corner` (`:1525`) picks the column side (minColumn if `start_column == min`, else
   maxColumn if `end_column == max`, else None) and the row side the same way.
3. The focus corner is the opposite corner. `fCol`/`fRow` move by direction:
   - forward: `+1` if at maxColumn, else `+left_span`;
   - backward: `-1` if at minColumn, else `-right_span`;
   - down: `+1` if at maxRow, else `+top_span`;
   - up: `-1` if at minRow, else `-bottom_span`.
4. Return None if the slot is missing.
5. `extract_rect_corners(map, anchor, new_focus)` (`:1598`): from `rect2 = boundary`:
   - if the anchor has a corner, return (cell at that corner, cell at the opposite corner);
   - else if the new focus has a corner, return (opposite of the focus corner, focus corner);
   - else return (minColumn/minRow, maxColumn/maxRow).

   `cell_at_corner` returns Err when a slot is missing.

Per-table handlers from `applyTableHandlers` (`:376`):

```rust
/// KEY_ESCAPE (:433): TableSelection -> focus cell (in this table) select_end; stop; true.
pub fn escape_table_selection(tx: &mut Transaction, table: Id<TableNode>) -> Result<bool>;

pub enum DeleteTextKind { Word, Line, Character }
pub enum DeleteOutcome { NotHandled, Handled, Cleared(ClearText) }
/// DELETE_WORD/LINE/CHARACTER (:456): not in table -> NotHandled. TableSelection -> clear_text.
/// Range: anchor must have a cell in this table; if exactly one of anchor/focus is inside the table
/// -> clear_text (note: clear_text then Errs, since selection is not Table; upstream throws the
/// same invariant). Then nearest element of anchor, and its top-level block in the cell; if either
/// is missing -> NotHandled. Line && block has no previous sibling -> Handled (swallowed, upstream TODO).
pub fn delete_text_in_table(tx: &mut Transaction, table: Id<TableNode>, kind: DeleteTextKind)
    -> Result<DeleteOutcome>;

/// KEY_BACKSPACE / KEY_DELETE `$deleteCellHandler` (:532):
/// 1. Selection must be Table or Range else NotHandled.
/// 2. If exactly one of anchor/focus is inside table: preserve the outer point; new selection =
///    table.select_previous() if the table point is before the outer point, else select_next();
///    set the outer point back on it; return NotHandled (base handler deletes).
/// 3. Not in table -> NotHandled. Table selection -> Cleared(clear_text) (JS preventDefault +
///    stopPropagation when an event exists). Else NotHandled.
pub fn delete_cell(tx: &mut Transaction, table: Id<TableNode>) -> Result<DeleteOutcome>;

/// CUT (:590). JS first runs copyToClipboard($getClipboardDataFromSelection(selection)), whose
/// model half is `crate::clipboard::get_clipboard_data_from_selection` (§1d); then: `r = delete_cell(..)`; if Range -> selection.remove_text(); Handled.
/// Else returns r. Non-null selection that is neither Range nor Table -> NotHandled.
pub fn cut_in_table(tx: &mut Transaction, table: Id<TableNode>) -> Result<DeleteOutcome>;

/// FORMAT_TEXT (:619): in table && TableSelection -> format_cells; true. Else false.
pub fn format_text_in_table(tx: &mut Transaction, table: Id<TableNode>, f: TextFormatType)
    -> Result<bool>;

/// FORMAT_ELEMENT (:650): TableSelection in table whose anchor and focus nodes ARE cells.
/// Full-table selection -> table.format = f; true. Otherwise for each distinct cell in the
/// [min,max] row/col box built from the two cells' spans (no boundary expansion): cell.format = f,
/// and every non-inline element child.format = f. True.
pub fn format_element_in_table(tx: &mut Transaction, table: Id<TableNode>, f: ElementFormat)
    -> Result<bool>;

pub enum TableEdge { First, Last }
/// `$getTableEdgeCursorPosition` (:2313), model half. JS passes `dom_anchor_beside_table`: the
/// native selection anchor is inside the table parent's DOM but not inside the <table>.
/// Requires: table has a parent; anchor has a cell whose table == `table`;
/// compute_table_map(table, cell, cell): First if cell origin == map[0][0] origin, else Last if ==
/// map[last][map[0].len-1] origin, else None.
pub fn table_edge_cursor_position(state: &EditorState, sel: &RangeSelection,
                                  table: Id<TableNode>, dom_anchor_beside_table: bool)
    -> Result<Option<TableEdge>>;
/// `$insertParagraphAtTableEdge` (:2298): new paragraph before (First) / after (Last) the table,
/// append `children`, select_end.
pub fn insert_paragraph_at_table_edge(tx: &mut Transaction, edge: TableEdge, table: Id<TableNode>,
                                      children: &[NodeKey]) -> Result<()>;

/// CONTROLLED_TEXT_INSERTION (:717). Not in table -> false. TableSelection -> JS $clearHighlight
/// (which sets selection None + dispatches SELECTION_CHANGE) and return false. Range with a cell
/// ancestor and string payload: if table_edge_cursor_position is Some -> insert a paragraph there
/// holding a TextNode(payload); true. Else false.
pub fn controlled_text_insertion_in_table(tx: &mut Transaction, table: Id<TableNode>, text: &str,
                                          dom_anchor_beside_table: bool) -> Result<bool>;

/// KEY_TAB (:762, only if hasTabHandler): collapsed Range in table whose cell's table == table ->
/// select_adjacent_cell(cell, shift ? Previous : Next); JS stopEvent; true.
pub fn tab_in_table(tx: &mut Transaction, table: Id<TableNode>, shift: bool) -> Result<bool>;
/// `$selectAdjacentCell` (:1424): element sibling cell -> select_end; else first element child
/// (next) / last element child (previous) of the next/previous rows -> select_end; else
/// table.select_next() / select_previous().
pub fn select_adjacent_cell(tx: &mut Transaction, cell: Id<TableCellNode>, forward: bool)
    -> Result<()>;

/// FOCUS (:797): returns table.is_selected().  INSERT_PARAGRAPH (:807): collapsed Range in table
/// and table_edge_cursor_position Some -> insert_paragraph_at_table_edge(edge, table, &[]); true.
pub fn insert_paragraph_in_table(tx: &mut Transaction, table: Id<TableNode>,
                                 dom_anchor_beside_table: bool) -> Result<bool>;
```

Selection-change pieces (`$handleTableSelectionChangeCommand`, `:838`). `nextFocus`
handling (`:845-884`) is JS drag state that calls `select_cells`. The rest:

```rust
/// :885-918 Firefox down-arrow fix, run when JS's shouldCheckSelectionForTable == Some(table):
/// prev and current Range, current collapsed, anchor in some cell, table.first_child is a row whose
/// first child is a cell, and walking up from the anchor cell reaches `table` before `first_cell`
/// (i.e. anchor not inside first_cell) -> first_cell.select_start(); true.
pub fn fix_selection_after_down_into_table(tx: &mut Transaction, table: Id<TableNode>) -> Result<bool>;

pub struct TouchState { pub is_touch: bool, pub is_selecting: bool }
pub enum RangeFix { None, Applied, ConvertToCells { table: Id<TableNode>,
                    anchor: Id<TableCellNode>, focus: Id<TableCellNode>, reset_pointer_type: bool } }
/// `$fixRangeSelectionForSelectedTable` (:947):
/// - shouldMoveFocus (focus in table T_f, and anchor in no table or T_a is ancestor of T_f):
///   focus := backward ? (map[0][0], 0) : (last cell, children_len), Element; set selection -> Applied.
/// - else shouldMoveAnchor (mirror): anchor := backward ? (last, len) : (first, 0) -> Applied.
/// - else same table: anchor cell != focus cell -> ConvertToCells{anchor, focus}.
///   Else if touch.is_touch && touch.is_selecting && collapsed && prev Range collapsed and prev
///   anchor cell != focus cell -> ConvertToCells{prev_anchor_cell, focus, reset_pointer_type: true}.
/// JS looks up the observer for `table` (invariant if missing) and applies via
/// $setAnchorCellForSelection + $setFocusCellForSelection(.., true).
pub fn fix_range_selection_for_tables(tx: &mut Transaction, touch_for: &dyn Fn(NodeKey) -> TouchState)
    -> Result<RangeFix>;

/// Persists the nested-table rewrite that upstream `TableSelection.getNodes` does in place (:306).
pub fn normalize_table_selection(tx: &mut Transaction) -> Result<()>;
```

`$fixTableSelectionForSelectedTable` (`:1070`) is DOM-driven. JS builds the range from
`$createRangeSelectionFromDom`; the model step sets `anchor = (table, backward ?
children_len : 0, Element)` and installs it. That is plain core API and needs no helper.
`$syncTableSelectionState` (`:1105`) is JS (observer and highlight).

### 1b.11 Mapping

Macro column: number of files under `apps/`, `packages/` and `services/` of the Macro worktree
(excluding node_modules/dist) that import the symbol from `@lexical/table`. 33 distinct
symbols, which matches notes-macro.md. "-" means the symbol is not imported.

| Rust item | Ports | Source (file:line) | Macro | Notes |
| --- | --- | --- | --- | --- |
| `TableCellHeaderState` | `TableCellHeaderStates` | `packages/lexical-table/src/LexicalTableCellNode.ts:36` | 9 | bitflags u8 |
| `TableCellNode` | `TableCellNode`, `SerializedTableCellNode` | `.../LexicalTableCellNode.ts:59`, `:46` | 13 | JSON order `:197` |
| `TableCellNode::new` / `tx.create` | `$createTableCellNode` | `.../LexicalTableCellNode.ts:467` | 7 | node replacement via builder |
| `tx.get::<TableCellNode>` | `$isTableCellNode` | `.../LexicalTableCellNode.ts:475` | 22 | |
| `TableCellNode::set_header_styles` | `setHeaderStyles` | `.../LexicalTableCellNode.ts:235` | - | |
| `TableCellNode::toggle_header_style` | `toggleHeaderStyle` | `.../LexicalTableCellNode.ts:278` | - | arithmetic toggle |
| `TableCellNode::has_header_state` / `has_header` | same | `.../LexicalTableCellNode.ts:290`, `:294` | - | |
| `TableCellNode::set_vertical_align` | `setVerticalAlign` | `.../LexicalTableCellNode.ts:272` | - | export filter `:326` |
| `TableRowNode` | `TableRowNode`, `SerializedTableRowNode` | `.../LexicalTableRowNode.ts:34`, `:26` | 6 | |
| `TableRowNode` create | `$createTableRowNode` | `.../LexicalTableRowNode.ts:146` | 10 | |
| `tx.get::<TableRowNode>` | `$isTableRowNode` | `.../LexicalTableRowNode.ts:150` | 13 | |
| `TableNode` | `TableNode`, `SerializedTableNode` | `.../LexicalTableNode.ts:177`, `:56` | 16 | |
| `TableNode` create | `$createTableNode` | `.../LexicalTableNode.ts:670` | 9 | |
| `tx.get::<TableNode>` | `$isTableNode` | `.../LexicalTableNode.ts:674` | 13 | |
| `TableNode::column_count` | `getColumnCount` | `.../LexicalTableNode.ts:603` | - | |
| `TableGrid::coords_of` | `getCordsFromCellNode` | `.../LexicalTableNode.ts:464` | - | physical coords |
| `TableGrid::cell_at(_or_err)` | `getDOMCellFromCords(OrThrow)`, `getCellNodeFromCords(OrThrow)` | `.../LexicalTableNode.ts:493`, `:517`, `:531`, `:551` | - | clamp semantics |
| `table_grid` | `$getElementForTableNode`, `getTable` | `.../LexicalTableNode.ts:620`, `.../LexicalTableSelectionHelpers.ts:1263` | - | model-derived |
| `TableGrid` | `TableDOMTable`, `TableDOMRows`, `TableDOMCell` | `.../LexicalTableObserver.ts:59`, `:57`, `:49` | 1 (`TableDOMCell`) | JS keeps elements |
| `TableMapValue` / `TableMap` | `TableMapValueType` / `TableMapType` | `.../LexicalTableSelection.ts:48`, `:53` | - | span snapshot added |
| `create_table_node_with_dimensions` | `$createTableNodeWithDimensions` | `.../LexicalTableUtils.ts:40` | - | keeps empty TextNode |
| `find_cell_node` | `$getTableCellNodeFromLexicalNode`, `$findCellNode` | `.../LexicalTableUtils.ts:82`, `.../LexicalTableSelectionHelpers.ts:1757` | 5 | |
| `get_table_row_node_from_table_cell_node` | `$getTableRowNodeFromTableCellNodeOrThrow` | `.../LexicalTableUtils.ts:94` | - | |
| `get_table_node_from_lexical_node` | `$getTableNodeFromLexicalNodeOrThrow` | `.../LexicalTableUtils.ts:106` | 6 | |
| `get_table_row_index_from_table_cell_node` | `$getTableRowIndexFromTableCellNode` | `.../LexicalTableUtils.ts:118` | - | |
| `get_table_column_index_from_table_cell_node` | `$getTableColumnIndexFromTableCellNode` | `.../LexicalTableUtils.ts:126` | - | not span-aware |
| (private, grid) | `$getTableCellSiblingsFromTableCellNode`, `TableCellSiblings` | `.../LexicalTableUtils.ts:140`, `:133` | - | |
| `remove_table_row_at_index` | `$removeTableRowAtIndex` | `.../LexicalTableUtils.ts:154` | - | |
| `insert_table_row` | `$insertTableRow` (deprecated) | `.../LexicalTableUtils.ts:172` | - | takes `&TableGrid` |
| `header_state_for_insert` | `getHeaderState` | `.../LexicalTableUtils.ts:239` | - | private |
| `insert_table_row_at_selection` (+ `__experimental`) | `$insertTableRowAtSelection`, `$insertTableRow__EXPERIMENTAL` | `.../LexicalTableUtils.ts:257`, `:295` | 3 | |
| `insert_table_row_at_node` | `$insertTableRowAtNode` | `.../LexicalTableUtils.ts:302` | - | not in upstream index |
| `insert_table_column` | `$insertTableColumn` (deprecated) | `.../LexicalTableUtils.ts:376` | - | takes `&TableGrid` |
| `insert_table_column_at_selection` (+ `__experimental`) | `$insertTableColumnAtSelection`, `$insertTableColumn__EXPERIMENTAL` | `.../LexicalTableUtils.ts:440`, `:478` | 2 | |
| `insert_table_column_at_node` | `$insertTableColumnAtNode` | `.../LexicalTableUtils.ts:485` | - | not in upstream index |
| `delete_table_column` | `$deleteTableColumn` (deprecated) | `.../LexicalTableUtils.ts:585` | - | |
| `delete_table_row_at_selection` (+ `__experimental`) | `$deleteTableRowAtSelection`, `$deleteTableRow__EXPERIMENTAL` | `.../LexicalTableUtils.ts:608`, `:713` | 2 | snapshot spans |
| `delete_table_column_at_selection` (+ `__experimental`) | `$deleteTableColumnAtSelection`, `$deleteTableColumn__EXPERIMENTAL` | `.../LexicalTableUtils.ts:715`, `:797` | 2 | |
| `move_selection_to_cell` | `$moveSelectionToCell` | `.../LexicalTableUtils.ts:799` | - | private |
| `insert_first` | `$insertFirst` | `.../LexicalTableUtils.ts:808` | - | private; `crate::utils` has the same |
| `merge_cells` | `$mergeCells` | `.../LexicalTableUtils.ts:817` | 2 | |
| (private) | `$cellContainsEmptyParagraph` | `.../LexicalTableUtils.ts:915` | - | |
| `unmerge_cell` | `$unmergeCell` | `.../LexicalTableUtils.ts:926` | 3 | |
| `unmerge_cell_node` | `$unmergeCellNode` | `.../LexicalTableUtils.ts:941` | - | not in upstream index |
| `compute_table_map` | `$computeTableMap` | `.../LexicalTableUtils.ts:1025` | 3 | |
| `compute_table_map_skip_cell_check` | `$computeTableMapSkipCellCheck` | `.../LexicalTableUtils.ts:1040` | 4 | |
| `get_node_triplet` | `$getNodeTriplet` | `.../LexicalTableUtils.ts:1113` | - | |
| `TableCellRectBoundary` / `TableCellRectSpans` | same | `.../LexicalTableUtils.ts:1147`, `:1154` | - | |
| `compute_table_cell_rect_spans` | `$computeTableCellRectSpans` | `.../LexicalTableUtils.ts:1161` | - | |
| `compute_table_cell_rect_boundary` | `$computeTableCellRectBoundary` | `.../LexicalTableUtils.ts:1183` | - | |
| `is_simple_table` | `$isSimpleTable` | `.../LexicalTableUtils.ts:1262` | - | |
| `move_table_column` | `$moveTableColumn` | `.../LexicalTableUtils.ts:1296` | - | |
| `get_table_cell_node_rect` | `$getTableCellNodeRect` | `.../LexicalTableUtils.ts:1332` | - | |
| `lexical_model::TableSelection` + `TableSelectionExt` | `TableSelection` | `.../LexicalTableSelection.ts:111` | 2 | core variant + hook |
| `TableSelectionShape` / `get_shape` | `TableSelectionShape`, `getShape` | `.../LexicalTableSelection.ts:41`, `:256` | - | |
| `TableSelectionExt::get_nodes` | `getNodes`, `$getCellNodes` | `.../LexicalTableSelection.ts:295`, `:55` | - | nested fix `:306` |
| `TableSelectionExt::has_format` | `hasFormat` | `.../LexicalTableSelection.ts:228` | - | |
| `TableSelectionExt::insert_nodes` | `insertNodes` | `.../LexicalTableSelection.ts:243` | - | |
| `TableSelectionExt::text_content` | `getTextContent` | `.../LexicalTableSelection.ts:370` | - | |
| core `Selection::Table` methods | `isValid`, `isBackward`, `is`, `clone`, `isCollapsed`, `extract`, `insertText`, `insertRawText`, `getStartEndPoints` | `.../LexicalTableSelection.ts:139`, `:163`, `:175`, `:197`, `:205`, `:209`, `:217`, `:213`, `:128` | - | |
| `is_table_selection` | `$isTableSelection` | `.../LexicalTableSelection.ts:383` | 9 | |
| `TableSelection::new` | `$createTableSelection` + `.set` | `.../LexicalTableSelection.ts:387`, `:184` | 4 | no root placeholder |
| `create_table_selection_from` | `$createTableSelectionFrom` | `.../LexicalTableSelection.ts:398` | 2 | always validates |
| `visit_recursively` | `$visitRecursively` | `.../LexicalTableSelection.ts:443` | - | last-to-first |
| `insert_table`, `InsertTablePayload`, `IncludeHeaders` | `$insertTable`, `INSERT_TABLE_COMMAND`, `InsertTableCommandPayload(Headers)` | `.../LexicalTablePluginHelpers.ts:81`, `.../LexicalTableCommands.ts:26`, `:20`, `:13` | 3 (`INSERT_TABLE_COMMAND`) | JS dispatches |
| `table_cell_transform` | `$tableCellTransform` | `.../LexicalTablePluginHelpers.ts:110` | - | |
| `table_row_transform` | `$tableRowTransform` | `.../LexicalTablePluginHelpers.ts:120` | - | |
| `table_transform` | `$tableTransform` | `.../LexicalTablePluginHelpers.ts:130` | - | |
| `select_block_in_cell` | `$tableClickCommand` | `.../LexicalTablePluginHelpers.ts:183` | - | |
| `select_all_in_table` | `$tableSelectAllCommand` | `.../LexicalTablePluginHelpers.ts:206` | - | Macro also has `tableSelectAll.ts` |
| `table_cell_unmerge_transform` | `registerTableCellUnmergeTransform` | `.../LexicalTablePluginHelpers.ts:267` | 1 | |
| `register_table` | `registerTablePlugin` (+ transforms part of `TableExtension`) | `.../LexicalTablePluginHelpers.ts:402`, `.../LexicalTableExtension.ts:56` | 1 | |
| `TableConfig` | `TableConfig` | `.../LexicalTableExtension.ts:26` | - | build-time |
| `table_cell_background_strip_transform` | inline transform | `.../LexicalTableExtension.ts:96` | - | Macro has a copy in tablePlugin.ts |
| `insert_clipboard_nodes_in_table` | `$tableSelectionInsertClipboardNodesCommand` | `.../LexicalTablePluginHelpers.ts:449` | - | |
| `insert_table_into_grid` | `$insertTableIntoGrid` | `.../LexicalTablePluginHelpers.ts:500` | - | |
| `is_multi_cell_table_selection` | `$isMultiCellTableSelection` | `.../LexicalTablePluginHelpers.ts:677` | - | |
| `clear_text`, `ClearText` | `TableObserver.$clearText` | `.../LexicalTableObserver.ts:516` | - | Macro patch |
| `format_cells` | `TableObserver.$formatCells` | `.../LexicalTableObserver.ts:488` | - | |
| `select_cells` | `$setFocusCellForSelection` (model part) | `.../LexicalTableObserver.ts:411` | - | |
| `find_parent_table_cell_node_in_table` | `$findParentTableCellNodeInTable` | `.../LexicalTableSelectionHelpers.ts:145` | - | |
| `find_table_node` | `$findTableNode` | `.../LexicalTableSelectionHelpers.ts:1762` | - | |
| `is_selection_in_table` | `$isSelectionInTable` | `.../LexicalTableSelectionHelpers.ts:1689` | - | |
| `is_full_table_selection` | `$isFullTableSelection` | `.../LexicalTableSelectionHelpers.ts:1706` | - | |
| `select_adjacent_cell`, `tab_in_table` | `$selectAdjacentCell`, KEY_TAB handler | `.../LexicalTableSelectionHelpers.ts:1424`, `:762` | - | |
| `next_cell_in_direction`, `apply_cell_move` | `selectTableNodeInDirection`, `selectTableCellNode` | `.../LexicalTableSelectionHelpers.ts:1456`, `:1724` | - | |
| (private) | `getCorner`, `getCornerOrThrow`, `oppositeCorner`, `cellAtCornerOrThrow`, `$extractRectCorners` | `.../LexicalTableSelectionHelpers.ts:1525`, `:1554`, `:1567`, `:1574`, `:1598` | - | |
| `adjust_focus_in_direction` | `$adjustFocusInDirection` | `.../LexicalTableSelectionHelpers.ts:1633` | - | |
| (private) | `$getBlockParentIfFirstNode` | `.../LexicalTableSelectionHelpers.ts:1767` | - | |
| (private) | `$handleHorizontalArrowKeyRangeSelection`, `$getTableExitCaret`, `$findNextTableCell` | `.../LexicalTableSelectionHelpers.ts:1788`, `:1870`, `:1877` | - | core carets |
| `handle_arrow_key`, `TableView`, `HandlerResult`, `ObserverEffect` | `$handleArrowKey` | `.../LexicalTableSelectionHelpers.ts:1897` | - | |
| `escape_table_selection` | KEY_ESCAPE handler | `.../LexicalTableSelectionHelpers.ts:433` | - | |
| `delete_text_in_table` | `deleteTextHandler` | `.../LexicalTableSelectionHelpers.ts:456` | - | |
| `delete_cell` | `$deleteCellHandler` | `.../LexicalTableSelectionHelpers.ts:532` | - | |
| `cut_in_table` | CUT handler | `.../LexicalTableSelectionHelpers.ts:590` | - | copy stays JS |
| `format_text_in_table` | FORMAT_TEXT handler | `.../LexicalTableSelectionHelpers.ts:619` | - | |
| `format_element_in_table` | FORMAT_ELEMENT handler | `.../LexicalTableSelectionHelpers.ts:650` | - | |
| `controlled_text_insertion_in_table` | CONTROLLED_TEXT_INSERTION handler | `.../LexicalTableSelectionHelpers.ts:717` | - | |
| `insert_paragraph_in_table` | INSERT_PARAGRAPH / FOCUS handlers | `.../LexicalTableSelectionHelpers.ts:807`, `:797` | - | |
| `table_edge_cursor_position`, `TableEdge` | `$getTableEdgeCursorPosition` | `.../LexicalTableSelectionHelpers.ts:2313` | - | DOM gate as bool |
| `insert_paragraph_at_table_edge` | `$insertParagraphAtTableEdge` | `.../LexicalTableSelectionHelpers.ts:2298` | - | |
| `fix_selection_after_down_into_table` | `$handleTableSelectionChangeCommand` `:885-918` | `.../LexicalTableSelectionHelpers.ts:838` | - | |
| `fix_range_selection_for_tables`, `RangeFix` | `$fixRangeSelectionForSelectedTable` | `.../LexicalTableSelectionHelpers.ts:947` | - | |
| `selected_node_keys` | `$updateDOMForSelection` (model input) | `.../LexicalTableSelectionHelpers.ts:1339` | - | |
| `TableGrid::cells` | `$forEachTableCell` | `.../LexicalTableSelectionHelpers.ts:1361` | - | |

Macro symbols that are view-only and stay in JS: `getDOMCellFromTarget` (6), `getTableElement` (1),
`getTableObserverFromTableElement` (1), `registerTableSelectionObserver` (1), and
`setScrollableTablesActive` (1). They are re-pointed at the Rust grid as described in 1b.9.
Macro's own cell-children whitelist transform (`apps/web/.../tables/tablePlugin.ts`, the
`allowedNodesInTableCellNode` block) is Macro plugin code and belongs to the Macro-plugins
section, not here.

### 1b.12 Not ported (DOM/view, or other crates)

- `PIXEL_VALUE_REG_EXP`, `COLUMN_WIDTH`: `packages/lexical-table/src/constants.ts:9`, `:13`. Moved to `lexical_html`.
- `TableCellNode.importDOM` / `$convertTableCellNodeElement`: `.../LexicalTableCellNode.ts:96`, `:332`. Moved to `lexical_html`.
- `TableCellNode.createDOM` / `updateDOM` / `getTag`: `.../LexicalTableCellNode.ts:141`, `:298`, `:231`. View.
- `TableCellNode.exportDOM`: `.../LexicalTableCellNode.ts:169`. Moved to `lexical_html`.
- `TableRowNode.importDOM` / `$convertTableRowElement`: `.../LexicalTableRowNode.ts:51`, `:132`. Moved to `lexical_html`.
- `TableRowNode.createDOM` / `updateDOM`: `.../LexicalTableRowNode.ts:85`, `:119`. View.
- `updateColgroup`, `setRowStriping` (fn), `setFrozenColumns` (fn), `setFrozenRows` (fn), `alignTableElement`: `.../LexicalTableNode.ts:66`, `:87`, `:101`, `:116`, `:131`. View.
- `$isScrollableTablesActive`, `setScrollableTablesActive`: `.../LexicalTableNode.ts:154`, `:160`. View config (WeakSet per editor).
- `TableNode.getDOMSlot`, `createDOM`, `updateTableWrapper`, `updateTableElement`, `updateDOM`, `scaleDOMColWidths`: `.../LexicalTableNode.ts:263`, `:277`, `:302`, `:323`, `:349`, `:361`. View.
- `TableNode.exportDOM`: `.../LexicalTableNode.ts:374`. Moved to `lexical_html`; it needs `compute_table_map_skip_cell_check` from this crate.
- `TableNode.importDOM` / `$convertTableElement`: `.../LexicalTableNode.ts:213`, `:632`. Moved to `lexical_html`.
- `TableImportExtension`, `TableImportRules`, `TableSchema`, `TableRowSchema`, `cellTextFormatMask`, `$packageCellChildren`: `.../TableImportExtension.ts:295`, `:287`, `:260`, `:276`, `:58`, `:82`. Moved to `lexical_html`'s import rules.
- `TableExtension` signal/effect wiring and `$fullReconcile` on the scroll toggle: `.../LexicalTableExtension.ts:57-91`. View; config is build-time in Rust.
- `$getTableAndElementByKey`: `.../LexicalTableObserver.ts:65`. View.
- `TableObservers` and `TableNextFocus`: `.../LexicalTableObserver.ts:99`, `:90`. JS drag state.
- `TableObserver` (DOM and interaction half): `.../LexicalTableObserver.ts:161`. JS; see 1b.8.
- `registerTableSelectionObserver`: `.../LexicalTablePluginHelpers.ts:322`. JS (mutation listener and observer lifecycle).
- `isPointerDownOnEvent`, `isHTMLTableElement`, `getTableElement`, `getEditorWindow`: `.../LexicalTableSelectionHelpers.ts:113`, `:117`, `:121`, `:141`. View.
- `registerTableWindowHandlers`, `$handleTableClick`: `.../LexicalTableSelectionHelpers.ts:179`, `:239`. Pointer events; JS. They call `select_cells`.
- `applyTableHandlers`: `.../LexicalTableSelectionHelpers.ts:376`. JS registration shell; bodies map to 1b.10.
- `$handleTableSelectionChangeCommand` (orchestration and `nextFocus`): `.../LexicalTableSelectionHelpers.ts:838`. JS; model pieces in 1b.10.
- `$fixTableSelectionForSelectedTable`: `.../LexicalTableSelectionHelpers.ts:1070`. DOM selection.
- `$syncTableSelectionState`: `.../LexicalTableSelectionHelpers.ts:1105`. View highlight.
- `attach/detach/getTableObserverFromTableElement`, `getTableObserverFromCellNode`: `.../LexicalTableSelectionHelpers.ts:1156`, `:1147`, `:1167`, `:1173`. DOM expando.
- `getDOMCellFromTarget`, `getDOMCellInTableFromTarget`, `doesTargetContainText`: `.../LexicalTableSelectionHelpers.ts:1202`, `:1225`, `:1250`. DOM.
- `$addHighlightStyleToTable`, `$removeHighlightStyleToTable`, `$addHighlightToDOM`, `$removeHighlightFromDOM`: `.../LexicalTableSelectionHelpers.ts:1397`, `:1408`, `:1732`, `:1743`. DOM classes.
- `stopEvent`, `isTypeaheadMenuInView`: `.../LexicalTableSelectionHelpers.ts:2279`, `:2285`. DOM (the latter through `TableView`).
- `$getObserverCellFromCellNodeOrThrow`, `$getNearestTableCellInTableFromDOMNode`: `.../LexicalTableSelectionHelpers.ts:2384`, `:2400`. Replaced by grid keys.
- Unit tests `packages/lexical-table/src/__tests__/unit/*`: `LexicalTableUtils.test.ts` (12) and the model asserts in `LexicalTableExtension.test.ts` / `LexicalTableSelection.test.tsx` port as Rust tests. The `createDOM` / HTML-export asserts in `LexicalTableNode.test.tsx` and `LexicalTableCellNode.test.ts` stay JS or move to `lexical_html`.

### 1b.13 Core points (all closed by S1 R1)

- `Selection::Table(TableSelection)` and `EditorBuilder::table_selection_hooks` (1b.5): S1 §9.1, §4.2 (CR-7).
- `tx.previous_selection()` (`$getPreviousSelection`), needed by `insert_table` and the
  selection-change fixups: S1 §5.2 (CR-8).
- A repeated `tx.remove` on an already-detached node is a no-op
  (`delete_table_column_at_selection`): S1 §7.4 (CR-9).
- Formatting a detached range that is not the editor selection (`format_cells`): put the range in
  a detached slot (`tx.detach_selection`) and call `tx.format_text_at(slot, ..)` (S1 §7.6, §9.4; CR-9).
- `tx.is_writable(cell)` for live cell reads: S1 §7.2 (CR-19).
## 1c. lexical_rich_nodes: code, mark, selection, utils, text, offset

Crate `crates/client/lexical/lexical_rich_nodes` (one crate, per SCOPE). This section covers six
modules: `code` (`@lexical/code-core`, plus the pure parts of `@lexical/code-prism`), `mark`,
`selection`, `utils`, `text` and `offset`. All offsets are `Utf16Offset`. All text indexing in
this section (`text[i]`, `.length`, `.slice`) is in UTF-16 code units, exactly as upstream.

### 1c.0 What this section needs from `lexical_model`

S1 (Revision R1) is the source of truth for these names; §1a.0 lists the shared conventions.

- **R1 Subclass projection** (CR-2, CR-3). `.node::<Sub>()` and `.replace::<Base, Sub>(Sub::from)`
  with `type Parent = Base` on `Sub` (S1 §3.2, §4.2). `tx.is::<Base>(k)`, `tx.get::<Base>(k)` and
  `tx.get_mut::<Base>(k)` succeed for any `Sub` and return the base part (through `as_parent`),
  so upstream `instanceof Base` works. Macro relies on this for `CustomCodeNode` (`Parent =
  CodeNode`), `CommentNode` and `SearchMatchNode` (`Parent = MarkNode`). A subclass struct holds
  its base as `#[serde(flatten)] pub code: CodeNode` (or `mark: MarkNode`). Its own fields
  serialize after the base fields, which matches JS `{...super.exportJSON(), own}`.
- **R2 Override delegation.** A subclass inherits every override it does not redefine, because
  each S1 hook default delegates to `Parent`. A redefinition that calls upstream's
  `super.method()` calls `self.as_parent().method(..)` (predicates) or
  `<Base as ElementNode>::method(tx, this.upcast(), ..)` (associated hooks), per S1 §3.2's rule
  for hook bodies. The `code::hooks::*` / `mark::hooks::*` `pub fn`s below remain as the bodies,
  for package callers that need them outside a hook.
- **R3** Reads are the `Read` trait (S1 §5.2), implemented by `Transaction`, `EditorState` and
  `StateRef`. Every read-only function below takes `state: &EditorState`; any `impl Read` works.
- **R4** Core functions used here (S1 §5.2, §7, §9, §10): `RangeSelection`/`Selection` reads
  (`Selection::nodes(view)`, `is_backward(view)`, `is_collapsed`, `start_end_points`,
  `Read::selection_text_content`),
  `Transaction::{insert_nodes, extract, set_text_node_range}`, `tx.text(k)?.split_text`,
  `tx.splice`, the caret API (`PointCaret`, `SiblingCaret`, `ChildCaret`,
  `caret::caret_from_point`, `CaretRange::extend`, `NodeCaret::adjacent_sibling_or_parent_sibling`,
  `Transaction::{split_at_point_caret_next, remove_text_from_caret_range,
  set_selection_from_caret_range}`),
  `Read::{find_matching_parent, is_block, is_root_or_shadow_root, has_ancestor, is_leaf,
  is_token_or_segmented, character_offsets}`, `format::text_direction`, `Transaction::select_all`,
  `NodeRef::to_owned` (`$cloneWithPropertiesEphemeral`), `Read::children_keys`
  (`$createChildrenArray`), `Transaction::split_node`, `tx.committed_state()`
  (`editor.getEditorState()` inside an update), and `tx.previous_selection()`
  (`$getPreviousSelection`). Where a name here differs from S1, S1's governs.
- **R5** `TextNode::is_simple_text()` must be `TYPE == "text" && mode == Normal`
  (`packages/lexical/src/nodes/LexicalTextNode.ts:463`). Text normalization
  (`LexicalNormalization.ts:48`, `LexicalUpdates.ts:237`) only merges or removes simple text. This
  is what keeps legacy `code-highlight` nodes intact (see 1c.1.3).

Concrete core node structs are written as `Text`, `Tab`, `LineBreak`, `Paragraph` and `Root`.

---

### 1c.1 `code`

#### 1c.1.1 Layout

```
src/code/mod.rs          CodeNode, CodeHighlightNode re-exports, create/is helpers, DEFAULT_CODE_LANGUAGE
src/code/node.rs         CodeNode + hooks (insert_new_after, collapse_at_start, exit_code_node_on_enter)
src/code/highlight.rs    CodeHighlightNode (legacy, tolerated) + orphan transform
src/code/line.rs         line walking: first/last node of line, start/end of code in line, direction
src/code/indent.rs       tab / indent / outdent / shift-lines / move-to (model half of CodeIndentation.ts)
src/code/plain.rs        plainify_code_content, outdent_leading_spaces
src/code/language.rs     CODE_LANGUAGE_MAP, CODE_LANGUAGE_FRIENDLY_NAME_MAP, normalize/friendly-name
```

#### 1c.1.2 `CodeNode`

```rust
pub const DEFAULT_CODE_LANGUAGE: &str = "javascript";
pub fn get_default_code_language() -> &'static str { DEFAULT_CODE_LANGUAGE }

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeNode {
    /// `None` for absent, `null` or `""` (upstream `language || undefined`).
    #[serde(default, deserialize_with = "falsy_string_as_none", skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Same normalization as `language`.
    #[serde(default, deserialize_with = "falsy_string_as_none", skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}
impl CodeNode { pub const TYPE: &'static str = "code"; }
// (R2-20) `impl NodeType for CodeNode` sets `const HAS_LANGUAGE_FIELD: bool = true` (inherited
// by CustomCodeNode through the registry's OR along `Parent`).

impl CodeNode {
    pub fn language(&self) -> Option<&str>;
    pub fn theme(&self) -> Option<&str>;
    /// Stores `None` for `None` or `Some("")`.
    pub fn set_language(&mut self, language: Option<&str>);
    pub fn set_theme(&mut self, theme: Option<&str>);
}

impl ElementNode for CodeNode {
    fn can_indent(&self) -> bool { false }
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot,
                        restore_selection: bool) -> Result<Option<NodeKey>> {
        hooks::insert_new_after(tx, this.key(), selection, restore_selection)
    }
    fn collapse_at_start(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot) -> Result<bool> {
        hooks::collapse_at_start(tx, this.key())
    }
}

/// `$createCodeNode(language, theme)`. Resolves node replacement, so Macro gets `CustomCodeNode`.
pub fn create_code_node(tx: &mut Transaction, language: Option<&str>, theme: Option<&str>) -> Result<NodeKey>;
/// `$isCodeNode`: true for `CodeNode` and every type whose `Parent` chain reaches `CodeNode` (`state.is::<CodeNode>(k)`).
pub fn is_code_node(state: &EditorState, key: NodeKey) -> bool;

pub mod hooks {
    pub fn insert_new_after(tx: &mut Transaction, code: NodeKey, selection: SelectionSlot,
                            restore_selection: bool) -> Result<Option<NodeKey>>;
    pub fn collapse_at_start(tx: &mut Transaction, code: NodeKey) -> Result<bool>;
    /// `$exitCodeNodeOnEnter`. Returns the new paragraph.
    pub fn exit_code_node_on_enter(tx: &mut Transaction, selection: &RangeSelection) -> Result<Option<NodeKey>>;
}
```

JSON: upstream `exportJSON` adds `language` and `theme` after the element base fields. Both are
dropped when undefined (`CodeNode.ts:288`). Import goes through `setLanguage(x || undefined)` and
`setTheme(x || undefined)` (`CodeNode.ts:281`), so `null` and `""` both import as absent. Output is
therefore byte-identical to a JS export of the same input.

`__isSyntaxHighlightSupported` is not ported. It is set only by the highlighter and read only by
`createDOM`/`updateDOM`/`exportDOM`, and is never serialized. The JS view owns it.

**`insert_new_after`** (`CodeNode.ts:297`). This runs whenever core `insert_paragraph` hits a
CodeNode.
1. Always call `exit_code_node_on_enter(selection)` first. If it returns a paragraph, return that.
   Upstream calls it here only when `CodeExtension` is absent (`CodeNode.ts:301-312`); with the
   extension, the `KEY_ENTER_COMMAND` handler (`CodeExtension.ts:27`) calls it before
   insertParagraph. Macro registers no `CodeExtension` (it uses `registerCodeHighlighting`), so it
   runs the in-hook path today. Folding the call in gives the same Enter behaviour either way.
2. `first_point` = whichever of anchor and focus comes first; `first = first_point.node`.
3. If `first` is a text node (any `NodeKind::Text`, including Tab):
   - `node = first_code_node_of_line(first)`. Walk forward from `node`, collecting indentation:
     - Tab: push a new `Tab`, then move to the next sibling.
     - Code text (1c.1.4): count the leading U+0020 code units `n`. If `n > 0`, push a new **plain
       `Text`** of `" " * n`; upstream pushes `$createCodeHighlightNode`, but Rust never creates
       highlight nodes. If `n != size`, stop. Otherwise move to the next sibling.
     - Anything else: stop.
   - `split = tx.split_text(first, &[anchor.offset])?[0]`. Upstream uses `anchor.offset` even when
     the first point is the focus (`CodeNode.ts:346`). Keep that; core `insert_paragraph` has
     already removed selected text, so in practice the selection is collapsed here.
   - `index = index_within_parent(split) + (anchor.offset == 0 ? 0 : 1)`, then
     `tx.splice(parent(first), index, 0, [LineBreak, ...indent])`.
   - Selection: if `indent` is not empty, select the end of its last node. Otherwise, if
     `anchor.offset == 0`, `select_previous(split)`; else `select_next(next_sibling(split), 0, 0)`.
4. If `first` is the CodeNode itself (element point): splice a `LineBreak` at `anchor.offset` and
   select the element at `(offset + 1, offset + 1)`.
5. Return `Ok(None)`.

Indent nodes are plain `Text`, so normalization merges them into a following simple `Text` with
the same format/style/state. The caret is remapped by core. This differs from upstream (whose
highlight-node indent never merges), but the text and caret position match.

**`exit_code_node_on_enter`** (`CodeNode.ts:478`). Applies only when the selection is collapsed,
the anchor is an element point on a CodeNode, `children >= 2`, `anchor.offset == children`, and
the last two children are both `LineBreak` (Enter pressed on an empty last line after an empty
line). Then: `splice(code, children - 2, 2, [])`, insert a new paragraph after the CodeNode,
`select` it (start), and return it. Otherwise `None`. The paragraph comes from core
`create_paragraph_node`, so replacement applies.

**`collapse_at_start`** (`CodeNode.ts:374`): create a paragraph, append every child in order
(children move as they are, highlight nodes included), `tx.replace(code, paragraph, false)`, and
return `true`. Legacy highlight children are converted by the orphan transform (1c.1.3).

Upstream CodeNode overrides nothing else (no `selectStart`, `selectEnd`, `isShadowRoot`,
`canInsertTab` or `isInline`), so keep the defaults.

**Macro subclass.** `CustomCodeNode` (`packages/lexical-core/nodes/CustomCodeNode.ts:84`, type
`custom-code`, `.replace::<CodeNode, CustomCodeNode>(CustomCodeNode::from)`) is
`struct CustomCodeNode { #[serde(flatten)] code: CodeNode, preview_enabled: bool, .. }` with
`type Parent = CodeNode`. Its `impl ElementNode` is empty: `can_indent`, `insert_new_after` and
`collapse_at_start` are inherited from CodeNode (R2). Its `setLanguage` override (`CustomCodeNode.ts:173`, which
clears preview unless the language is `svg`) and its constructor language normalization
(`:91-97`) are Macro's and are specified in the Macro-nodes section. A JSON `"type":"code"` node
imports through `$createCodeNode` → replacement → `CustomCodeNode`. The registry has to keep
`code` registered as the replaced base type.

#### 1c.1.3 `CodeHighlightNode` (tolerated legacy)

```rust
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeHighlightNode {
    /// `None` for absent, `null` or `""` (upstream `highlightType || undefined`).
    #[serde(default, deserialize_with = "falsy_string_as_none", skip_serializing_if = "Option::is_none")]
    pub highlight_type: Option<String>,
}

impl NodeType for CodeHighlightNode {
    const TYPE: &'static str = "code-highlight";
    type Kind = TextKind;
    type Parent = Text;   // text_node_base!
    fn is_parent_required(&self, _: NodeView<'_>) -> bool { true }
    fn create_parent_element(tx: &mut Transaction<'_>, _this: Id<Self>) -> Result<NodeKey, Error> {
        Ok(create_code_node(tx, None, None).key())
    }
}
impl TextNode for CodeHighlightNode {
    fn can_have_format(&self, _: TextView<'_>) -> bool { false }
    /// Upstream `setFormat` override returns `this` unchanged.
    fn coerce_format(&self, _: TextView<'_>, _: TextFormat) -> Result<Option<TextFormat>, Error> { Ok(None) }
}

pub fn is_code_highlight_node(state: &EditorState, key: NodeKey) -> bool;

/// Registered on CodeHighlightNode. See "Orphans" below.
pub fn code_highlight_orphan_transform(tx: &mut Transaction, node: Id<CodeHighlightNode>) -> Result<()>;
```

Rules that keep stored highlight nodes byte-identical:
- **Deserialize, never create.** The type is registered so that existing documents load. No Rust
  code path constructs one. `$createCodeHighlightNode` is not ported, and every place upstream
  creates one creates a plain `Text` instead (indent carry-over, `plainify_code_content`).
- **Never merged.** `is_simple_text()` is false because `TYPE != "text"` (R5). Normalization
  therefore never merges a highlight node with a neighbour, never merges a neighbour into it, and
  never removes it when empty (`LexicalNormalization.ts:51,62,81`). `mergeWithSibling` is only
  reached through that path. Do not add a `can_be_merged` override and do not treat it as simple
  text anywhere.
- **Not tokenized.** No transform on `CodeNode`, and no tokenizer.
- **Format pinned to 0.** `TextNode.updateFromJSON` calls `setFormat(json.format)`
  (`LexicalTextNode.ts:652`), which is the no-op override, so JS imports every highlight node with
  `format: 0`. Rust import must force `TextData.format = 0` for this type to match JS. `detail`,
  `mode`, `style`, `text`, `highlightType` and NodeState (`$`) round-trip unchanged. Field order:
  the text base fields, then `highlightType`.
- `for_each_selected_text_node` and `patch_style_text` skip it (`can_have_format` false,
  `lexical-node.ts:381`), so style patches never touch it.
- Text editing inside an existing highlight node (insert, delete, `split_text`) goes through core
  as for any text node. Split halves keep the type and `highlightType` (clone).

**Orphans.** The one Prism behaviour Rust keeps (`packages/lexical-code-prism/src/CodeHighlighterPrism.ts:95-98`):
when a highlight node's parent is not `is_code_node` (after `collapse_at_start`, `set_blocks_type`,
paste, or unwrapping), replace it with `Text::new(text)`. Upstream does exactly this and drops
format, style and state too. In the same transform, remove a highlight node whose text is `""`;
Prism's re-tokenization drops these upstream, and normalization does not remove them (non-simple).
Inside a CodeNode, the transform touches nothing else.

Migration note: once JS clients without Rust write code blocks, they re-tokenize plain `Text`
written by Rust into highlight nodes on their next edit. Rust tolerates the mix. The id pass that
`CollabProvider.tsx:385` runs for highlight nodes is out of scope here.

#### 1c.1.4 Line walking (`FlatStructureUtils.ts`)

Upstream only accepts `CodeHighlightNode | TabNode | LineBreakNode` in a code line. Rust widens
this by exactly one type, plain `"text"`, because new content is plain `Text` (decision 1). Other
TextNode subclasses (DiffTextNode, InlineSearchNode, UnlinkedTextNode, CommentNode children are
elements) are **not** code text, so `get_code_lines` returns `Err(Invariant)` for them, as upstream
throws:

```rust
/// `matches!(state.type_name(key), Ok("text" | "code-highlight"))` (FlatStructureUtils.ts:44,
/// CodeIndentation.ts:103, plus plain text). Not a Tab, not any other TextNode subclass.
pub fn is_code_text(state: &EditorState, key: NodeKey) -> bool;
/// is_code_text || is Tab.
pub fn is_code_line_node(state: &EditorState, key: NodeKey) -> bool;

pub fn first_code_node_of_line(state: &EditorState, anchor: NodeKey) -> NodeKey;
pub fn last_code_node_of_line(state: &EditorState, anchor: NodeKey) -> NodeKey;
pub fn code_line_direction(state: &EditorState, anchor: NodeKey) -> Option<Direction>;
pub fn start_of_code_in_line(state: &EditorState, anchor: NodeKey, offset: Utf16Offset)
    -> Result<Option<(NodeKey, Utf16Offset)>>;
pub fn end_of_code_in_line(state: &EditorState, anchor: NodeKey) -> Result<NodeKey>;
```

- `first/last_code_node_of_line` (`:35-63`): starting from `anchor`, which may itself be a
  LineBreak, walk siblings in the given direction while `is_code_line_node`. Return the last match,
  or `anchor` if there was none. LineBreak ends the walk and is never included.
- `code_line_direction` (`:73`): from the first to the last node of the line, return the first
  non-null `get_text_direction(text)` among code-text nodes (upstream: highlight nodes). Otherwise
  return the parent's `direction` if it is `Ltr`/`Rtl`, else `None`.
- `start_of_code_in_line` (`:106`): a faithful port of the backward scan.
  - Step back one code unit at a time across previous siblings. At offset 0, move to the previous
    sibling. If there is none, stop. If it is a LineBreak, set `last = (lb, 1)` and stop. If it is
    neither code-line nor LineBreak, return `Err(Invariant)`. Then set
    `offset = max(0, size - 1)`.
  - On each step, record `last_non_blank = (node, offset)` when the node is code text and the unit
    is not U+0020. A missing unit (an empty code-text node, read at offset `max(0, -1) = 0`, which is
    `undefined` in JS) counts as **non-blank** (`undefined !== ' '`, FlatStructureUtils.ts:136-148).
  - If `last_non_blank` was found, return it.
  - Otherwise look at the unit at `anchor[offset]` (or the first unit of the next sibling if
    `offset == size`). Upstream only reads this from highlight nodes; Rust reads it from code text.
    If that unit exists and is not a space, return `last`.
  - Otherwise return `find_next_non_blank_in_line(anchor, offset)` (`:186`), and if that is
    `None`, return `last`. The forward scan skips Tabs and stops at a LineBreak or the end.
- `end_of_code_in_line` (`:219`): `last_code_node_of_line(anchor)`. `Err(Invariant)` if that is a
  LineBreak.

#### 1c.1.5 Indentation (`CodeIndentation.ts`), model half

The view maps keys to these calls. Each returns `Ok(true)` when it handled the key, and the view
then calls `preventDefault`/`stopPropagation`.

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TabAction { InsertTab, Indent, Outdent }

#[derive(Clone, Copy, Debug, Default)]
pub struct CodeIndentOptions {
    /// `CodeIndentConfig.tabSize`: if set, Outdent also strips up to this many leading spaces.
    pub tab_size: Option<u32>,
}

pub fn is_selection_in_code(state: &EditorState, selection: Option<&Selection>) -> bool;
/// `$handleTab(shiftKey)`. `None` when not in code.
pub fn handle_tab(state: &EditorState, shift: bool) -> Result<Option<TabAction>>;
/// `KEY_TAB_COMMAND` handler model half: returns the action; the view then **dispatches** the
/// command it names (`InsertTab` -> INSERT_TAB, `Indent` -> INDENT_CONTENT, `Outdent` ->
/// OUTDENT_CONTENT) through the command bus, as upstream `editor.dispatchCommand`
/// (CodeIndentation.ts:507-514), so higher-priority handlers (Macro list/table/tab-indentation
/// INDENT handlers) still pre-empt the code handler. Never call `handle_multiline_indent` directly
/// from here. Headless callers with no bus run the same priority-ordered dispatch as §1a.4.
pub fn handle_key_tab(st: &EditorState, shift: bool) -> Result<Option<TabAction>>;
/// `INSERT_TAB_COMMAND` handler: if in code, core insert_nodes([Tab]).
pub fn insert_tab_in_code(tx: &mut Transaction) -> Result<bool>;
/// `INDENT_CONTENT_COMMAND` / `OUTDENT_CONTENT_COMMAND` handlers.
pub fn handle_multiline_indent(tx: &mut Transaction, action: TabAction, opts: CodeIndentOptions) -> Result<bool>;
/// `KEY_ARROW_UP/DOWN_COMMAND` handlers, including the code-block edge guard.
pub fn handle_arrow(tx: &mut Transaction, up: bool, alt: bool) -> Result<bool>;
/// `MOVE_TO_START` / `MOVE_TO_END` handlers (Home/End).
pub fn handle_move_to(tx: &mut Transaction, to_start: bool, shift: bool) -> Result<bool>;
```

Semantics, with "code-line node" meaning `is_code_line_node` everywhere upstream says highlight or tab:
- `is_selection_in_code` (`:62`): RangeSelection only. The anchor's node (or its parent, if the
  node is not a CodeNode) is a CodeNode, and is the same node as the focus's.
- `get_code_lines` (private, `:88`):
  - If `get_nodes` returns exactly one node and it is a CodeNode, return `[]`.
  - Otherwise every node must be code-line or LineBreak, else `Err(Invariant)`. Split on
    LineBreak and drop empty lines.
  - Drop the last line if the selection end (`is_backward ? anchor : focus`) equals
    `Point(text, last_line[0], 0)`.
- `handle_tab` (`:128`):
  - Collapsed (anchor equals focus): `InsertTab`, or `Outdent` when `shift`.
  - Otherwise `lines.len() != 1` gives `Indent`/`Outdent`.
  - With a single line, build `line_start = Point(first_of_line, 0)` and
    `line_end = Point(last_of_line, size)`.
    - If the selection starts before `line_start` or ends after `line_end`, return `Indent`/`Outdent`.
    - Else if it does not touch both edges, return `InsertTab`/`Outdent`.
    - Else return `Indent`/`Outdent`.
- `handle_multiline_indent` (`:207`):
  1. No code lines and a collapsed selection: Indent inserts a Tab via `insert_nodes`. Return
     `true` either way.
  2. No code lines, Indent, and `get_text_content() == "\n"`: insert `[Tab, LineBreak]`, then set
     a caret range from `TextPointCaret(tab, next, 0)` to `normalize(SiblingCaret(lb, next))`, in
     the selection's direction.
  3. Otherwise, for each line `i`: let `first = line[0]`, or `first_code_node_of_line(line[0])`
     when `i == 0`.
     - Indent: `insert_before(first, Tab)`. When `i == 0` and the start point (`is_backward ? focus : anchor`)
       equals `Point(first, 0)`, move that point to `(tab, 0, text)`.
     - Outdent: remove `first` if it is a Tab. Else, if `tab_size` is set and `first` is code
       text, call `outdent_leading_spaces`.
  Returns `true`.
- `handle_arrow` (`:542-593` and `$handleShiftLines` `:290`):
  - RangeSelection in code only.
  - Edge guard: the selection is collapsed and the anchor is at offset 0 (up) or at its size
    (down) of a node with no previous (next) sibling whose parent is a CodeNode. Return `true`
    with no change; upstream does this to stop the caret leaving.
  - Then require the anchor and focus nodes to be code-line nodes, else `false`.
  - Without `alt`: if collapsed at the very start (end) of the code node's first (last) child, and
    the CodeNode has no previous (next) sibling, `select_previous`/`select_next` on the CodeNode
    and return `true`. Otherwise `false`. The edge guard pre-empts this when the conditions
    overlap, as upstream does.
  - With `alt`: take the range from the first node of the first line to the last node of the last
    line, ordered by `is_before`. Every node in `get_nodes_between` must be code-line or
    LineBreak, else `false`.
    - The LineBreak adjacent in the move direction must exist, or return `true`. Its far sibling
      must exist, or return `true`.
    - The insertion point is the first (up) or last (down) node of the neighbouring line, or the
      sibling itself.
    - Remove the LineBreak and the range. Up: insert the range nodes in order before the insertion
      point, then the LineBreak before the insertion point. Down: insert the LineBreak after the
      insertion point, then the range after it in order.
    - Restore with `set_text_node_range(anchor_node, anchor_offset, focus_node, focus_offset)`
      using the values captured before mutation. Return `true`.
- `handle_move_to` (`:422`):
  - Returns `false` unless `is_selection_in_code(selection)` **and** both the anchor and focus
    nodes are code-line nodes (`:437-443`). Without the first guard, Home/End in an ordinary
    paragraph would be hijacked, because plain `text` counts as code text. Test: Home/End in a
    paragraph returns false and changes nothing (§6.3).
  - `dir = code_line_direction(focus_node)`. With `to_start' = (dir == Rtl) ? !to_start : to_start`:
    - start: `start_of_code_in_line(focus_node, focus.offset)`. For a LineBreak result call
      `select_next(lb, 0, 0)`; for a text result call `set_text_node_range(n, o, n, o)`; for
      `None` call `select_start(parent)`.
    - end: `select()` the end of `end_of_code_in_line(focus_node)`.
  - With `shift`, restore the original anchor `(key, offset, type)` afterwards. Return `true`.

`registerCodeIndentation`, `CodeIndentExtension`, `CodeIndentConfig.disabled` and `CodeExtension`
are command-bus wiring. The view keeps them and calls the functions above.

#### 1c.1.6 Plain helpers

```rust
/// `$plainifyCodeContent`: split on '\n' into LineBreak and on '\t' into Tab. Non-empty parts
/// become plain `Text` (upstream: CodeHighlightNode). Returns the created, unattached nodes in order.
pub fn plainify_code_content(tx: &mut Transaction, text: &str) -> Result<Vec<NodeKey>>;
/// `$outdentLeadingSpaces`. Strips min(tab_size, leading U+0020 count) from the start of `node`'s
/// text. Anchor and focus text points on `node` shift left by that count, clamped at 0. Returns
/// false when tab_size == 0 or there is no leading space.
pub fn outdent_leading_spaces(tx: &mut Transaction, node: NodeKey, tab_size: u32) -> Result<bool>;
```
`outdent_leading_spaces` (`FlatStructureUtils.ts:272`) takes a selection argument upstream and
mutates it. Rust mutates `tx`'s current selection. Only `\n` is a line separator (no `\r`
handling), matching `:240`.

#### 1c.1.7 Language tables (`code-prism/src/FacadePrism.ts`), model

```rust
pub static CODE_LANGUAGE_FRIENDLY_NAME_MAP: phf::OrderedMap<&str, &str>; // 17 entries, insertion order of :43
pub static CODE_LANGUAGE_MAP: phf::OrderedMap<&str, &str>;               // 8 entries, :63
/// `normalizeCodeLanguage` / deprecated `normalizeCodeLang`: CODE_LANGUAGE_MAP[lang] or lang.
pub fn normalize_code_language(lang: &str) -> &str;
/// normalize, then FRIENDLY[lang] or the normalized lang.
pub fn get_language_friendly_name(lang: &str) -> &str;
/// Entries of the friendly-name map, in order.
pub fn get_code_language_options() -> Vec<(&'static str, &'static str)>;
```
`getCodeLanguages` (`FacadePrism.ts:83`) lists Prism's runtime grammars and is **not** ported.
Macro's `packages/lexical-core/utils/languageSupport.ts:152` builds `highlightsEnabled` from it,
so the Macro-nodes section needs a static language list. `getCodeThemeOptions` (`:105`) always
returns `[]` for Prism and is not ported.

#### 1c.1.8 Mapping

| Rust item | Ports | Source (file:line) | Used by Macro |
| --- | --- | --- | --- |
| `CodeNode` | `CodeNode` | `packages/lexical-code-core/src/CodeNode.ts:83` | yes (8 files; subclassed) |
| `CodeNode` serde | `SerializedCodeNode`, importJSON/updateFromJSON/exportJSON | `CodeNode.ts:50,277,281,288` | yes (`CustomCodeNode.ts:64`) |
| `DEFAULT_CODE_LANGUAGE`, `get_default_code_language` | same | `CodeNode.ts:58,60` | no |
| `CodeNode::set_language/language/set_theme/theme` | setLanguage/getLanguage/setTheme/getTheme | `CodeNode.ts:382,388,402,408` | yes |
| `hooks::insert_new_after` | `insertNewAfter` | `CodeNode.ts:297` | yes (via Enter) |
| `can_indent` | `canIndent` | `CodeNode.ts:370` | yes |
| `hooks::collapse_at_start` | `collapseAtStart` | `CodeNode.ts:374` | yes |
| `create_code_node` | `$createCodeNode` | `CodeNode.ts:413` | yes (3 files) |
| `is_code_node` | `$isCodeNode` | `CodeNode.ts:420` | yes (12 files) |
| `hooks::exit_code_node_on_enter` | `$exitCodeNodeOnEnter` | `CodeNode.ts:478` | yes (in-hook path) |
| `CodeHighlightNode` | `CodeHighlightNode` (deserialize only) | `CodeHighlightNode.ts:37` | yes (2 files) |
| `CodeHighlightNode` serde | `SerializedCodeHighlightNode`, import/update/export | `CodeHighlightNode.ts:29,113,119,127` | yes |
| `can_have_format`, `set_format` no-op | `canHaveFormat`, `setFormat` | `CodeHighlightNode.ts:78,135` | yes |
| `is_parent_required`, `create_parent_element` | same | `CodeHighlightNode.ts:139,143` | yes |
| `is_code_highlight_node` | `$isCodeHighlightNode` | `CodeHighlightNode.ts:167` | yes (2 files) |
| `code_highlight_orphan_transform` | Prism `$textNodeTransform` non-code branch | `packages/lexical-code-prism/src/CodeHighlighterPrism.ts:95` | yes (via `registerCodeHighlighting`) |
| `is_code_text`, `is_code_line_node` | (generalizes highlight/tab guards) | `FlatStructureUtils.ts:45` | n/a |
| `first_code_node_of_line` | `$getFirstCodeNodeOfLine` | `FlatStructureUtils.ts:53` | no |
| `last_code_node_of_line` | `$getLastCodeNodeOfLine` | `FlatStructureUtils.ts:59` | no |
| `code_line_direction` | `$getCodeLineDirection` | `FlatStructureUtils.ts:73` | no |
| `start_of_code_in_line` | `$getStartOfCodeInLine` (+ `findNextNonBlankInLine`) | `FlatStructureUtils.ts:106,186` | no |
| `end_of_code_in_line` | `$getEndOfCodeInLine` | `FlatStructureUtils.ts:219` | no |
| `plainify_code_content` | `$plainifyCodeContent` | `FlatStructureUtils.ts:238` | no |
| `outdent_leading_spaces` | `$outdentLeadingSpaces` | `FlatStructureUtils.ts:272` | no |
| `is_selection_in_code` | `$isSelectionInCode` (private) | `CodeIndentation.ts:62` | via `registerCodeHighlighting` |
| (private) `get_code_lines` | `$getCodeLines` | `CodeIndentation.ts:88` | " |
| `handle_tab`, `handle_key_tab`, `TabAction` | `$handleTab` + KEY_TAB handler | `CodeIndentation.ts:128,507` | " |
| `insert_tab_in_code` | INSERT_TAB handler | `CodeIndentation.ts:520` | " |
| `handle_multiline_indent`, `CodeIndentOptions` | `$handleMultilineIndent`, `CodeIndentConfig.tabSize` | `CodeIndentation.ts:207,607` | " |
| `handle_arrow` | ARROW_UP/DOWN handlers + `$handleShiftLines` | `CodeIndentation.ts:542,568,290` | " |
| `handle_move_to` | `$handleMoveTo` | `CodeIndentation.ts:422` | " |
| `CODE_LANGUAGE_FRIENDLY_NAME_MAP`, `CODE_LANGUAGE_MAP` | same | `packages/lexical-code-prism/src/FacadePrism.ts:43,63` | no |
| `normalize_code_language` | `normalizeCodeLanguage`, `normalizeCodeLang` | `FacadePrism.ts:74`; `packages/lexical-code/src/index.ts` | no |
| `get_language_friendly_name` | `getLanguageFriendlyName` | `FacadePrism.ts:78` | no |
| `get_code_language_options` | `getCodeLanguageOptions` | `FacadePrism.ts:92` | no |

#### 1c.1.9 Not ported (code)

- `CodeNode.createDOM` / `updateDOM`: `CodeNode.ts:114,137`. JS view.
- `CodeNode.exportDOM`: `CodeNode.ts:185`. Moves to `lexical_html`.
- `CodeNode.importDOM` and helpers (`$convertPreElement`, `$convertDivElement`, `$convertTableElement`, GitHub table detection): `CodeNode.ts:210,426-476`. Paste stays in JS.
- `setIsSyntaxHighlightSupported` / `getIsSyntaxHighlightSupported`: `CodeNode.ts:392,398`. View state.
- `CodeHighlightNode.createDOM` / `updateDOM`, `getHighlightThemeClass`: `CodeHighlightNode.ts:82,92,148`.
- `$createCodeHighlightNode`: `CodeHighlightNode.ts:160`. Rust never creates highlight nodes.
- `CodeExtension` (KEY_ENTER wiring): `CodeExtension.ts:23`. Folded into `insert_new_after`.
- `registerCodeIndentation`, `CodeIndentExtension`: `CodeIndentation.ts:502,637`. Command wiring.
- `CodeImportExtension`, `CodeImportRules`, `$installVscodeCodePasteOverlay`: `CodeImportExtension.ts:300,376,393`. DOM import.
- Prism tokenizer, `PrismTokenizer`, `registerCodeHighlighting`, `$codeNodeTransform`, `getCodeLanguages`, `getCodeThemeOptions`: `packages/lexical-code-prism/src/CodeHighlighterPrism.ts`, `FacadePrism.ts:83,105`. Highlighting is view-only (Macro: `codePlugin.ts:173`, `StaticMarkdown.tsx:824`).
- All of `@lexical/code-shiki` (`CodeHighlighterShiki`, `FacadeShiki.ts:126` `normalizeCodeLanguage` for Shiki).
- `loadCodeLanguage`, `isCodeLanguageLoaded`, `CodePrismExtension` (`packages/lexical-code-prism/src/`, P1): Prism grammar loading and extension wiring; highlighting is view-only.

---

### 1c.2 `mark`

#### 1c.2.1 Layout

```
src/mark/mod.rs     MarkNode, create/is, ids API, hooks
src/mark/ops.rs     wrap_selection_in_mark_node, unwrap_mark_node, get_mark_ids
```

#### 1c.2.2 Items

```rust
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct MarkNode {
    /// Ordered and duplicate-free when built through add_id. setIDs accepts anything.
    #[serde(default)]
    pub ids: Vec<String>,
}
impl MarkNode { pub const TYPE: &'static str = "mark"; }

impl MarkNode {
    pub fn ids(&self) -> &[String];              // getIDs (upstream returns a copy)
    pub fn has_id(&self, id: &str) -> bool;
    pub fn set_ids(&mut self, ids: Vec<String>);
    /// Appends if absent. A no-op if present.
    pub fn add_id(&mut self, id: &str);
    /// Removes the first occurrence. A no-op if absent.
    pub fn delete_id(&mut self, id: &str);
}

impl ElementNode for MarkNode {
    fn is_inline(&self) -> bool { true }
    fn can_be_empty(&self) -> bool { false }
    fn can_insert_text_before(&self) -> bool { false }
    fn can_insert_text_after(&self) -> bool { false }
    fn exclude_from_copy(&self, destination: CopyDestination) -> bool { hooks::exclude_from_copy(destination) }
    fn extract_with_child(state: &EditorState, this: NodeKey, child: NodeKey, selection: &Selection,
                          destination: CopyDestination) -> bool {
        hooks::extract_with_child(state, this, child, selection, destination)
    }
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot,
                        restore_selection: bool) -> Result<Option<NodeKey>> {
        hooks::insert_new_after(tx, this.key(), restore_selection)
    }
}

pub mod hooks {
    /// `destination != Clone`.
    pub fn exclude_from_copy(destination: CopyDestination) -> bool;
    pub fn extract_with_child(state: &EditorState, mark: NodeKey, child: NodeKey, selection: &Selection,
                              destination: CopyDestination) -> bool;
    /// Creates `create_mark_node(ids)` (the plain-mark factory, through replacement) and inserts it after `mark`.
    pub fn insert_new_after(tx: &mut Transaction, mark: NodeKey, restore_selection: bool) -> Result<Option<NodeKey>>;
}

pub fn create_mark_node(tx: &mut Transaction, ids: Vec<String>) -> Result<NodeKey>;
/// True for MarkNode and every subtype of MarkNode (`Parent` chain: CommentNode, SearchMatchNode).
pub fn is_mark_node(state: &EditorState, key: NodeKey) -> bool;

pub fn unwrap_mark_node(tx: &mut Transaction, mark: NodeKey) -> Result<()>;
/// `create_node` defaults to `create_mark_node`. Its returned key must satisfy `is_mark_node`.
pub fn wrap_selection_in_mark_node<F>(tx: &mut Transaction, selection: &RangeSelection,
                                      is_backward: bool, id: &str, create_node: Option<F>) -> Result<()>
where F: FnMut(&mut Transaction, Vec<String>) -> Result<NodeKey>;
pub fn get_mark_ids(state: &EditorState, text: NodeKey, offset: Utf16Offset) -> Option<Vec<String>>;
```

JSON: `ids` follows the element base fields (`MarkNode.ts:65`). Import uses `setIDs(json.ids)`
(`:61`), with no dedup or reordering.

`extract_with_child` (`MarkNode.ts:164`): `false` for a non-Range selection or `Html`. Otherwise
`len = is_backward ? anchor.offset - focus.offset : focus.offset - anchor.offset`. The offsets are
subtracted even when anchor and focus are in different nodes; keep that quirk. Return
`is_parent_of(mark, anchor_node) && is_parent_of(mark, focus_node) && text_content_size(mark) == len`.

`unwrap_mark_node` (`index.ts:22`): move each child, in order, so the first lands before the mark
and each later one after the previous child. Then remove the mark.

`wrap_selection_in_mark_node` (`index.ts:37`), exact algorithm:
1. Build a fresh forward RangeSelection `(start, end)` from the given one (swap if backward). The
   input selection is not mutated. `nodes = extract(forward)`, which splits boundary text nodes.
2. State: `current_parent: Option<NodeKey>` and `last_mark: Option<NodeKey>`. For each `node`:
   - If `last_mark` is an ancestor of `node` (`is_parent_of`), continue.
   - `target`: `node` if it is text-kind (Tab included). `continue` if `is_mark_node(node)`; its
     children are visited, and the new mark nests inside the existing one. `node` if it is an
     inline element or inline decorator. Otherwise `None`.
   - `target == None`: block elements, block decorators and **LineBreak** (not text, element or
     decorator). Clear `current_parent` and `last_mark`, and continue. A LineBreak therefore splits
     the mark, despite upstream's comment.
   - `target == current_parent`: continue.
   - If `parent(target) != current_parent`, clear `last_mark`. Then set `current_parent = parent(target)`.
   - If `last_mark` is `None`, `last_mark = create_node([id])` and `insert_before(target, last_mark)`.
   - `append(last_mark, target)`.
3. If a mark was created, select its start (`is_backward`) or its end (`select_start` / `select_end`).
   The `is_backward` argument is used only here.

Existing adjacent marks are never reused or merged: only the mark created earlier in the same
parent run is reused. Macro relies on nested marks being resolved elsewhere
(`register_nested_element_resolver`, 1c.4).

`get_mark_ids` (`index.ts:138`): walk from `text` up through ancestors. Return the ids of the first
mark ancestor (`text` itself is never a mark). If the start node is text and
`offset == size(text)` and its next sibling is a mark, return that sibling's ids. Otherwise `None`.

**Macro subclasses.** `CommentNode` (`packages/lexical-core/nodes/CommentNode.ts:153`, type
`comment-mark`, adds `threadId`/`isDraft`, and overrides `insertNewAfter` at `:267` to copy
ids/thread/draft) and `SearchMatchNode` (`SearchMatchNode.ts:18`, type `search-match`) are
`#[serde(flatten)] mark: MarkNode` + `type Parent = MarkNode`. They inherit `is_inline`,
`can_be_empty`, `can_insert_text_*`, `exclude_from_copy` and `extract_with_child` from MarkNode
(R2); CommentNode redefines only `insert_new_after`. `SearchMatchNode.importJSON` (`:35`) never calls `updateFromJSON`, so it imports
with `ids = []` and default element fields. The Macro-nodes section must keep that quirk
deliberately or decide to drop it.

#### 1c.2.3 Mapping

| Rust item | Ports | Source (file:line) | Used by Macro |
| --- | --- | --- | --- |
| `MarkNode` + serde | `MarkNode`, `SerializedMarkNode`, import/update/export | `packages/lexical-mark/src/MarkNode.ts:36,26,57,61,65` | yes (5 files; subclassed ×2) |
| `MarkNode::has_id` | `hasID` | `MarkNode.ts:109` | yes |
| `MarkNode::ids` / `set_ids` | `getIDs` / `setIDs` | `MarkNode.ts:113,117` | yes |
| `MarkNode::add_id` / `delete_id` | `addID` / `deleteID` | `MarkNode.ts:123,128` | yes |
| `hooks::insert_new_after` | `insertNewAfter` | `MarkNode.ts:139` | yes (CommentNode overrides) |
| `can_insert_text_before/after` | same | `MarkNode.ts:148,152` | yes |
| `can_be_empty` | `canBeEmpty` | `MarkNode.ts:156` | yes |
| `is_inline` | `isInline` | `MarkNode.ts:160` | yes |
| `hooks::extract_with_child` | `extractWithChild` | `MarkNode.ts:164` | yes |
| `hooks::exclude_from_copy` | `excludeFromCopy` | `MarkNode.ts:187` | yes |
| `create_mark_node` | `$createMarkNode` | `MarkNode.ts:192` | yes (4 files, tests) |
| `is_mark_node` | `$isMarkNode` | `MarkNode.ts:196` | yes (2 files) |
| `unwrap_mark_node` | `$unwrapMarkNode` | `packages/lexical-mark/src/index.ts:22` | yes (4 files; `comment-only-change` gate via `lexical-core/utils/document.ts:32`) |
| `wrap_selection_in_mark_node` | `$wrapSelectionInMarkNode` | `index.ts:37` | yes (`commentPlugin.ts:294`, `publishCommentMark.ts:166`) |
| `get_mark_ids` | `$getMarkIDs` | `index.ts:138` | yes (`commentPlugin.ts:67`) |

#### 1c.2.4 Not ported (mark)

- `MarkNode.createDOM` / `updateDOM` (`mark`, `markOverlap` classes): `MarkNode.ts:77,86`.
- `MarkNode.importDOM` (returns null): `MarkNode.ts:53`.
- `MarkExtension`: `index.ts:163`. Registration is `.node::<MarkNode>()`.

---

### 1c.3 `selection`

#### 1c.3.1 Layout

```
src/selection/mod.rs        re-exports
src/selection/css.rs        style_object_from_css, css_from_style_object, js_trim
src/selection/text.rs       slice_selected_text_node_content, is_at_node_end, trim_text_content_from_anchor,
                            patch_style_text, for_each_selected_text_node, ensure_forward_range_selection
src/selection/blocks.rs     set_blocks_type, copy_block_format_indent, wrap_nodes
src/selection/query.rs      get_selection_style_value_for_property, should_override_default_character_selection
```

#### 1c.3.2 Items

```rust
pub type StyleObject = indexmap::IndexMap<String, String>;

/// `getStyleObjectFromCSS` (core `utils/setDOMStyle.ts:18`; deprecated re-export in @lexical/selection).
pub fn style_object_from_css(css: &str) -> StyleObject;
/// `getCSSFromStyleObject`: concatenates `"{k}: {v};"` for every non-empty key, with no separator.
pub fn css_from_style_object(styles: &StyleObject) -> String;
/// ECMAScript `String.prototype.trim` whitespace set (WhiteSpace + LineTerminator, including U+FEFF).
pub fn js_trim(s: &str) -> &str;

pub enum StylePatchValue {
    Set(String),
    Remove,
    /// `(current value, target) -> new value`
    Compute(Box<dyn Fn(Option<&str>, PatchTarget) -> String>),
}
pub type StylePatch = indexmap::IndexMap<String, StylePatchValue>;
#[derive(Clone, Copy, Debug)]
pub enum PatchTarget { Text(NodeKey), Element(NodeKey), CollapsedSelection }

/// `selection` is upstream's argument as a slot; it may differ from `Active` (R2-08, R2-13).
pub fn patch_style_text(tx: &mut Transaction, selection: SelectionSlot, patch: &StylePatch) -> Result<()>;
pub fn for_each_selected_text_node<F>(tx: &mut Transaction, f: F) -> Result<()>
where F: FnMut(&mut Transaction, NodeKey) -> Result<()>;
pub fn ensure_forward_range_selection(selection: &mut RangeSelection);
pub fn is_at_node_end(state: &EditorState, point: &Point) -> Result<bool>;
/// Returns the UTF-16 slice of `text`'s content that `selection` covers. Returns the whole text
/// when the node is not selected, is token/segmented, or is neither anchor nor focus.
pub fn slice_selected_text_node_content(state: &EditorState, selection: &Selection, text: NodeKey) -> Result<String>;
/// (R2-36) Re-reads `tx.anchor_at(anchor)` at the split step.
pub fn trim_text_content_from_anchor(tx: &mut Transaction, anchor: SelectionSlot, delete_count: usize) -> Result<()>;

pub fn copy_block_format_indent(tx: &mut Transaction, src: NodeKey, dest: NodeKey) -> Result<()>;
pub fn set_blocks_type<C, A>(tx: &mut Transaction, selection: Option<&Selection>, create: C, after_create: A) -> Result<()>
where C: FnMut(&mut Transaction) -> Result<NodeKey>,
      A: FnMut(&mut Transaction, NodeKey /*prev*/, NodeKey /*new*/) -> Result<()>;
/// Uses `copy_block_format_indent` as `after_create`.
pub fn set_blocks_type_default<C>(tx: &mut Transaction, selection: Option<&Selection>, create: C) -> Result<()>
where C: FnMut(&mut Transaction) -> Result<NodeKey>;
/// Deprecated upstream; ported for parity.
pub fn wrap_nodes<C>(tx: &mut Transaction, selection: &Selection, create: C, wrapping: Option<NodeKey>) -> Result<()>
where C: FnMut(&mut Transaction) -> Result<NodeKey>;

pub fn get_selection_style_value_for_property(state: &EditorState, selection: &Selection,
                                              property: &str, default: &str) -> String;
/// Model half of `$shouldOverrideDefaultCharacterSelection`. The view resolves vertical/RTL
/// (computed style) and passes the already-adjusted direction.
pub fn should_override_default_character_selection(state: &EditorState, selection: &RangeSelection,
                                                   adjusted_is_backward: bool) -> bool;

// deprecated re-exports (index.ts:44-47) are core methods, not re-exportable fns:
// `$selectAll` = `Transaction::select_all`, `$cloneWithProperties` = `NodeRef::to_owned` (S1 §5.2, §9.4)
```

Semantics:
- `style_object_from_css` (`packages/lexical/src/utils/setDOMStyle.ts:18`) is a char-by-char
  state machine. It handles `/* */` comments (skipped), backslash escapes inside quotes, `'`/`"`
  quotes (kept in the output), parenthesis depth, `:` at depth 0 (starts the value), and `;` at
  depth 0 (commits). It commits only when both the trimmed property and the trimmed value are
  non-empty, and also commits a trailing declaration with no `;`. Later duplicates overwrite the
  value but keep the first position (JS object semantics = `IndexMap::insert`). Use `js_trim`,
  not `str::trim`. **Upstream 0.45 has no parse cache.** `$addNodeStyle` is a deprecated no-op,
  so do not add a cache. JS orders integer-like keys first; CSS property names are never
  integer-like, so insertion order is the whole contract.
- `patch_style` (private, `lexical-node.ts:257`):
  - The target is a Text, an Element, or a collapsed RangeSelection; anything else is
    `Err(Invariant)`.
  - Start from `style_object_from_css` of the text node's `style`, the element's `textStyle`, or
    the selection's `style`.
  - Apply the patch in order: `Compute` → `f(prev.get(k), target)`, where `prev` is the map parsed
    **before** the patch (upstream `prevStyles`), never the map being built; `Remove` → `shift_remove`
    (keeps the order of the rest); `Set` → insert.
  - Write `css_from_style_object` back to the text style or the selection style (`set_style`),
    or the element's `textStyle`.
- `patch_style_text` (`:307`). Upstream mixes two selections, and Rust reproduces it: the collapsed
  branch and the final `get_nodes` use the **argument** `selection` (its style is written with
  `set_style`, so it is `&mut`); the text-node loop uses `tx`'s active selection
  (`for_each_selected_text_node` calls `$getSelection()`, `lexical-node.ts:354`). When they are the
  same selection (every Macro caller), this is one selection.
  - If the selection is a collapsed RangeSelection, patch the selection. If the anchor node is an
    empty element, patch that element too.
  - Then `for_each_selected_text_node(patch_style)`.
  - Then patch, once each, every node in `get_nodes` that is an element with
    `can_be_empty() && children == 0`.
- `for_each_selected_text_node` (`:351`):
  - Uses `tx`'s current selection; returns when there is none.
  - For a RangeSelection, compute slice indices from `caret_range_from_selection(..).text_slices()`.
  - For each `get_nodes` text node with `can_have_format()`:
    - Skip empty slices.
    - Pass the whole node to `f` if it is token/segmented or the slice is `[0, size]`.
    - Otherwise `split_text(start, end)` and pass part `[start == 0 ? 0 : 1]`.
  - Finally, if anchor and focus are both text points on the same key, call
    `ensure_forward_range_selection` on `tx`'s selection (upstream test-compat side effect, `:404`).
- `slice_selected_text_node_content` (`:44`): upstream mutates `__text` of the node or of an
  ephemeral clone. Rust returns the sliced string, and the caller (clipboard / `lexical_html`)
  builds the ephemeral node. Offsets come from `get_character_offsets(selection)`. Same node:
  `[min, max)`. First node: `[start, end of text)`. Last node: `[0, end)`.
- `is_at_node_end` (`:103`): text point → `offset == size`. Element point → `offset == children`.
  Any other node kind → `Err(Invariant)`.
- `trim_text_content_from_anchor` (`:124`), faithful port:
  - If the anchor is an element point, start from `descendant_by_index(offset)`.
  - Loop while `remaining > 0`:
    - Descend an element to its last descendant.
    - `next` = previous sibling, or the nearest ancestor's previous sibling. In the ancestor case
      add 2 when that ancestor is a block (`additional_element_whitespace`).
    - `text` = the node's text content, or `"\n\n"` for an empty block element.
    - If the node is not text or `remaining >= len`: remove it, remove its parent if it is now
      empty and not root, and `remaining -= len + ws`.
    - Otherwise:
      - If the node is simple text in `tx.committed_state()` and its previous text differs, restore
        that text: replace with a new `Text` if the node is not simple, else `set_text_content`.
        If `tx.previous_selection()` is a collapsed RangeSelection, select `(prev_offset, prev_offset)`.
      - Else, if the node is simple text, split out and remove the excess. The split range is
        anchor-relative when the anchor is in this node, with the anchor clamped to the end when
        `anchor.offset < remaining`.
      - Else replace the node with `Text(text[..len - remaining])`.
      - Set `remaining = 0`.
  - All lengths are UTF-16.
- `copy_block_format_indent` (`range-selection.ts:42`): copy the element `format` and `indent`
  from `src` to `dest`, writing each only when it differs.
- `set_blocks_type` (`:86`):
  - Returns on `None`.
  - With start/end points:
    - `anchor_block` / `focus_block` = `find_matching_parent(point.node, is_block)`.
    - `skip_focus = focus_block is element && focus_block != anchor_block && is_point_at_block_start(focus, focus_block)`.
      `is_point_at_block_start` (`:56`) requires `offset == 0`, the node not an empty element,
      and no previous sibling on any node from the point's node up to the block.
    - Insert `anchor_block` if it is an element, then `focus_block` if it is an element and not
      skipped, into an `IndexMap` (dedup by key, first insertion order) (`range-selection.ts:113-118`).
      A block decorator holding a point is never inserted, so it is never replaced.
    - `is_block` is core `INTERNAL_$isBlock` (`LexicalUtils.ts:2009`): a non-inline DecoratorNode, or a
      non-root, non-inline ElementNode with `can_be_empty() != false` whose first child is None, text,
      a LineBreak or inline.
  - For each node in `get_nodes`:
    - An element block is inserted unless it is `focus_block` and `skip_focus`.
    - Otherwise, only when there are no start/end points (NodeSelection), insert its nearest block
      ancestor.
  - For each block, in map order: `new = create(tx)`, `after_create(prev, new)`,
    `tx.replace(prev, new, true)`. Selection remapping is done by core `replace` (and ListItem's
    override).
- `wrap_nodes` (`:170`) and `wrap_nodes_impl` (`:258`, private): line-for-line port, including
  the chunking at root/shadow-root nodes, `emptyElements`, `movedNodes`,
  `$removeParentEmptyElements` (`:148`), the target search, and the final selection. The final
  selection is a clone of `tx.previous_selection()` if both its points are still attached; else
  `select_end(last_element)`; else mark `selection.dirty`.
- `get_selection_style_value_for_property` (`:603`):
  - For a collapsed RangeSelection with a non-empty `style` that contains `property`, return that
    value.
  - Otherwise exclude the first node if it is text and the start offset is at its end, and the
    last node if the end offset is 0. The exclusion is checked against `nodes[0]` for the start
    node and against every later index for the end node.
  - Fold the remaining text nodes' `style[property] or default`. Return `""` on the first
    mismatch, `default` if there were no text nodes.
- `should_override_default_character_selection` (`:473`):
  - `caret = caret_from_point(focus, adjusted_is_backward ? Previous : Next)`.
  - Return `false` if it is an extendable TextPointCaret.
  - Otherwise iterate `extend_caret_to_range(caret)`: a ChildCaret returns `!origin.is_inline()`;
    an element origin continues; a decorator origin returns `true`; anything else breaks. The loop
    ends with `false`.

#### 1c.3.3 Mapping

| Rust item | Ports | Source (file:line) | Used by Macro |
| --- | --- | --- | --- |
| `style_object_from_css` | `getStyleObjectFromCSS` (deprecated re-export) | `packages/lexical/src/utils/setDOMStyle.ts:18`; `packages/lexical-selection/src/index.ts:41` | no (direct) |
| `css_from_style_object` | `getCSSFromStyleObject` | `packages/lexical-selection/src/utils.ts:186` | no |
| `slice_selected_text_node_content` | `$sliceSelectedTextNodeContent` | `lexical-node.ts:44` | no |
| `is_at_node_end` | `$isAtNodeEnd` | `lexical-node.ts:103` | no |
| `trim_text_content_from_anchor` | `$trimTextContentFromAnchor`, `trimTextContentFromAnchor` | `lexical-node.ts:124`; `index.ts:43` | no |
| (private) `patch_style`, `StylePatch`, `PatchTarget` | `$patchStyle` | `lexical-node.ts:257` | no |
| `patch_style_text` | `$patchStyleText` | `lexical-node.ts:307` | no |
| `for_each_selected_text_node` | `$forEachSelectedTextNode` | `lexical-node.ts:351` | no |
| `ensure_forward_range_selection` | `$ensureForwardRangeSelection` | `lexical-node.ts:426` | yes (`nodeTransformPlugin.ts:120`) |
| `copy_block_format_indent` | `$copyBlockFormatIndent` | `range-selection.ts:42` | no (default arg of setBlocksType) |
| `set_blocks_type`, `set_blocks_type_default` | `$setBlocksType` | `range-selection.ts:86` | yes (2 files) |
| `wrap_nodes` (+ private impl) | `$wrapNodes`, `$wrapNodesImpl` | `range-selection.ts:170,258` | no |
| `should_override_default_character_selection` | `$shouldOverrideDefaultCharacterSelection` (model half) | `range-selection.ts:473` | no |
| `get_selection_style_value_for_property` | `$getSelectionStyleValueForProperty` | `range-selection.ts:603` | no |
| `select_all`, `clone_with_properties` | re-exports of core `$selectAll`, `$cloneWithProperties` | `index.ts:44-47`; `packages/lexical/src/LexicalUtils.ts:1231,2167` | no |
| `js_trim` | `String.prototype.trim` | n/a | n/a |

#### 1c.3.4 Not ported (selection); the view-query alternative is on each line

- `createDOMRange`: `utils.ts:50`. The JS view builds DOM ranges from model points. Macro: `remote-cursor.tsx`.
- `createRectsFromDOMRange`: `utils.ts:127`. JS view. Macro: `remote-cursor.tsx`.
- `$getComputedStyleForElement` / `$getComputedStyleForParent`: `utils.ts:203,223`. The view reads computed style.
- `$isParentRTL`: `utils.ts:235`, and `$isParentElementRTL`: `range-selection.ts:528`. The view passes the RTL flag. A model-only approximation is the block's `direction` field.
- `$isEditorVerticalOrientation` (private): `range-selection.ts:447`. The view folds it into `adjusted_is_backward`.
- `$moveCaretSelection`: `range-selection.ts:514`. Uses `RangeSelection.modify` (DOM `Selection.modify`). The view moves the DOM caret and syncs back.
- `$moveCharacter`: `range-selection.ts:539`. Same as above.
- `$addNodeStyle`: `lexical-node.ts:246`. A deprecated no-op.
- `getStyleObjectFromRawCSS` (not in index): `utils.ts:178`.

---

### 1c.4 `utils`

#### 1c.4.1 Layout

```
src/utils/mod.rs        re-exports from lexical_model
src/utils/dfs.rs        DfsNode, dfs, dfs_iter, reverse_dfs(_iter), depth, next/prev preorder helpers
src/utils/tree.rs       nearest-of-type, block ancestor, insert/wrap/unwrap helpers, child cursors, filters
src/utils/nested.rs     NestedElementResolver + resolve_nested_element transform
src/utils/restore.rs    restore_editor_state
```

#### 1c.4.2 Items

```rust
// Core re-exports are methods in S1: `Read::find_matching_parent`,
// `NodeCaret::adjacent_sibling_or_parent_sibling`, `Transaction::split_node` (S1 §5.2, §10.5, §7.4).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DfsNode { pub depth: u32, pub node: NodeKey }

/// Preorder from `start` (default root), inclusive. Stops at `end` inclusive. An element `end`'s
/// children are not visited. Always yields at least `start`.
pub fn dfs(state: &EditorState, start: Option<NodeKey>, end: Option<NodeKey>) -> Vec<DfsNode>;
pub fn dfs_iter(state: &EditorState, start: Option<NodeKey>, end: Option<NodeKey>) -> DfsIter<'_>;
pub fn reverse_dfs(state: &EditorState, start: Option<NodeKey>, end: Option<NodeKey>) -> Vec<DfsNode>;
pub fn reverse_dfs_iter(state: &EditorState, start: Option<NodeKey>, end: Option<NodeKey>) -> DfsIter<'_>;
pub struct DfsIter<'s> { /* state, caret, end_caret, depth */ }
impl Iterator for DfsIter<'_> { type Item = DfsNode; }

pub fn get_adjacent_caret(state: &EditorState, caret: Option<Caret>) -> Option<SiblingCaret>;
/// (node, depth_delta ≤ 0)
pub fn get_next_sibling_or_parent_sibling(state: &EditorState, node: NodeKey) -> Option<(NodeKey, i32)>;
/// Root = 0, `None` = -1.
pub fn get_depth(state: &EditorState, node: Option<NodeKey>) -> i32;
pub fn get_next_right_preorder_node(state: &EditorState, node: NodeKey) -> Option<NodeKey>;
/// Inclusive of `node`, walks up to and including root. Matches `T` and its subtypes (`is::<T>`, S1 §5.2).
pub fn get_nearest_node_of_type<T: ElementNode>(state: &EditorState, node: NodeKey) -> Option<Id<T>>;
pub fn get_nearest_block_element_ancestor_or_throw(state: &EditorState, node: NodeKey) -> Result<NodeKey>;

pub fn restore_editor_state(tx: &mut Transaction, state: &EditorState) -> Result<()>;
pub fn insert_node_to_nearest_root(tx: &mut Transaction, node: NodeKey) -> Result<NodeKey>;
pub fn insert_node_to_nearest_root_at_caret(tx: &mut Transaction, node: NodeKey, caret: PointCaret,
                                            options: Option<SplitAtPointCaretNextOptions>) -> Result<Caret>;
pub fn insert_node_into_leaf(tx: &mut Transaction, node: NodeKey) -> Result<()>;
pub fn wrap_node_in_element<C>(tx: &mut Transaction, node: NodeKey, create: C) -> Result<NodeKey>
where C: FnOnce(&mut Transaction) -> Result<NodeKey>;
pub fn unwrap_node(tx: &mut Transaction, element: NodeKey) -> Result<()>;
pub fn insert_first(tx: &mut Transaction, parent: NodeKey, node: NodeKey) -> Result<()>;
pub fn handle_indent_and_outdent<F>(tx: &mut Transaction, f: F) -> Result<bool>
where F: FnMut(&mut Transaction, NodeKey) -> Result<()>;
pub fn unwrap_and_filter_descendants<P>(tx: &mut Transaction, root: NodeKey, pred: P) -> Result<bool>
where P: FnMut(&EditorState, NodeKey) -> bool;
pub fn descendants_matching<P>(state: &EditorState, children: &[NodeKey], pred: P) -> Vec<NodeKey>
where P: FnMut(&EditorState, NodeKey) -> bool;

/// `$firstToLastIterator` / `$lastToFirstIterator`. A lending cursor that reads the following
/// sibling *before* yielding, so the caller may remove or move the yielded node between calls.
pub struct ChildCursor { next: Option<NodeKey>, dir: Direction }
pub fn first_to_last(state: &EditorState, parent: NodeKey) -> ChildCursor;
pub fn last_to_first(state: &EditorState, parent: NodeKey) -> ChildCursor;
impl ChildCursor { pub fn next(&mut self, state: &EditorState) -> Option<NodeKey>; }

/// `registerNestedElementResolver` as a transform.
pub trait NestedElementResolver: ElementNode + Sized {
    /// `cloneNode(from)`: a fresh, unattached node of the same type.
    fn clone_for_split(tx: &mut Transaction, from: NodeKey) -> Result<NodeKey>;
    /// `handleOverlap(from = outer parent, to = inner node)`.
    fn handle_overlap(tx: &mut Transaction, from: NodeKey, to: NodeKey) -> Result<()>;
}
/// Register with `.transform::<N>(resolve_nested_element::<N>)`.
pub fn resolve_nested_element<N: NestedElementResolver>(tx: &mut Transaction, node: Id<N>) -> Result<()>;
```

Semantics:
- DFS (`index.ts:179-280`, `$dfsCaretIterator` `:236`):
  - `start` defaults to root. The first caret is `ChildCaret(start)` if `start` is an element,
    else `SiblingCaret(start)`; its origin `start` is yielded first with
    `depth = get_depth(start)`.
  - Each step: a ChildCaret adds 1 to depth, then
    `get_adjacent_sibling_or_parent_sibling_caret` adds its (≤ 0) delta.
  - `end_caret`: if `end` is given, `adjacent_child_caret(child_caret_or_self(SiblingCaret(end)))`,
    which is the first child of an element `end`; otherwise
    `get_adjacent_sibling_or_parent_sibling_caret(SiblingCaret(end))[0]`. Without `end`, the same
    walk from `start`.
  - Stop when the current caret or the next one `is_same_node_caret(end_caret)`.
  - Reverse uses direction `Previous`.
  - Upstream's iterators are lazy over live state. `DfsIter` borrows `&EditorState` immutably, so
    callers that mutate must collect first (`dfs`), or iterate a snapshot (`tx.committed_state()` /
    clone) and mutate `tx`.
- `get_nearest_block_element_ancestor_or_throw` (`:363`): `find_matching_parent(node, element && !inline)`.
  `find_matching_parent` includes `node` and excludes root. `Err(Invariant)` when there is no match.
- `restore_editor_state` (`:477`): replace every node in `tx` with a clone of `state`'s node map,
  then mark everything dirty for the view (`$fullReconcile` → `Commit` flag `full_reconcile`).
  Set the selection to a clone of `state.selection`. The core primitive name is S1's.
- `insert_node_to_nearest_root` (`:505`):
  - Initial caret: from `selection ?? prev_selection`. A RangeSelection gives
    `caret_from_point(focus, Next)`. Any other selection gives `SiblingCaret(last of get_nodes, Next)`.
    With no selection, append an empty paragraph to root and use the caret before it.
  - Then `insert_node_to_nearest_root_at_caret`.
  - Select collapsed at `normalize(adjacent child caret)` if that is a ChildCaret, else at the
    returned caret. Return `node`.
- `insert_node_to_nearest_root_at_caret` (`:541`):
  - Normalize the caret to `Next`. A TextPointCaret at offset 0 becomes the previous-flipped
    caret; at the end it becomes `SiblingCaret(origin, Next)`.
  - If the origin is `node`, rewind (it must be a SiblingCaret, else `Err`). If `node` is adjacent
    on either side, detach it (`remove(preserve_empty_parent=true)`).
  - Repeat `split_at_point_caret_next(caret, options)` to a fixpoint. Still a TextPointCaret →
    `Err`.
  - Insert `node`, wrapped in a new paragraph if it is inline. Return `SiblingCaret(node, Next)`
    in the input's direction.
- `insert_node_into_leaf` (`:602`):
  - Non-Range selection: `insert_nodes([node])`.
  - Range: `remove_text_from_caret_range`, take the anchor in `Next`, and split it if it is a
    TextPointCaret (return if the split fails). Insert at the flipped caret and set a collapsed
    caret range there.
- `wrap_node_in_element` (`:633`): `el = create()`, `replace(node, el)`, `append(el, node)`. Returns `el`.
- `unwrap_node` (`:916`): splice `element`'s children into its own slot, replacing it
  (`rewind(SiblingCaret(el, Next)).splice(1, children)`).
- `insert_first` (`:727`): insert at `ChildCaret(parent, Next)`.
- `handle_indent_and_outdent` (`:690`):
  - RangeSelection only, else `false`.
  - For each node: block = nearest non-inline element ancestor (inclusive, excluding root).
    Handle each block once, if `can_indent()`.
  - Return whether any block was handled.
  - CodeNode is never indented this way (`can_indent` false).
- `unwrap_and_filter_descendants` (`:791`): last-to-first over `root`'s children. A node matching
  `pred` stays (or is moved after its ancestor in recursive calls). A non-matching element is
  recursed with "insert matched descendants after me", then removed. A non-matching leaf is
  removed. Returns whether anything changed.
- `descendants_matching` (`:841`): read-only stack DFS; collects matches without descending into them.
- `resolve_nested_element` (`:396`):
  - If `node` has a direct child of type `N` (`is::<N>`, so subtypes count), return; inner nodes resolve first.
  - Walk up to the nearest ancestor `parent: N`, keeping the `child` of `parent` on the path.
  - Act only when `child == node`, the simple case:
    - `handle_overlap(parent, node)`.
    - `next = next_siblings(node)`. `insert_after(parent, node)`.
    - If `next` is not empty, `clone = clone_for_split(parent)`, `insert_after(node, clone)`, and
      append `next` in order.
    - If `parent` cannot be empty and has no children, remove it.
  - The deep case is a no-op upstream (TODO at `:463`); keep it a no-op.
  - The transform runs only for nodes whose registered type is `N` (or its replacement). "Is
    target" checks use `is::<T>` (upstream `instanceof`).

#### 1c.4.3 Mapping

| Rust item | Ports | Source (file:line) | Used by Macro |
| --- | --- | --- | --- |
| `DfsNode` | `DFSNode` | `packages/lexical-utils/src/index.ts:162` | yes |
| `dfs` | `$dfs` | `index.ts:179` | yes (8 files) |
| `get_adjacent_caret` | `$getAdjacentCaret` | `index.ts:192` | no |
| `reverse_dfs` | `$reverseDfs` | `index.ts:204` | no |
| `dfs_iter`, `DfsIter` | `$dfsIterator` (+ `$dfsCaretIterator`, `$getEndCaret`) | `index.ts:219,236,226` | yes (12 files) |
| `get_next_sibling_or_parent_sibling` | `$getNextSiblingOrParentSibling` | `index.ts:282` | no |
| `get_depth` | `$getDepth` | `index.ts:291` | no |
| `get_next_right_preorder_node` | `$getNextRightPreorderNode` | `index.ts:311` | no |
| `reverse_dfs_iter` | `$reverseDfsIterator` | `index.ts:327` | no |
| `get_nearest_node_of_type` | `$getNearestNodeOfType` | `index.ts:341` | no |
| `get_nearest_block_element_ancestor_or_throw` | `$getNearestBlockElementAncestorOrThrow` | `index.ts:363` | no |
| `NestedElementResolver`, `resolve_nested_element` | `registerNestedElementResolver` | `index.ts:396` | no |
| `restore_editor_state` | `$restoreEditorState` | `index.ts:477` | no |
| `insert_node_to_nearest_root` | `$insertNodeToNearestRoot` | `index.ts:505` | no |
| `insert_node_to_nearest_root_at_caret` | `$insertNodeToNearestRootAtCaret` | `index.ts:541` | yes (`AgentSessionMentionNode.ts`) |
| `insert_node_into_leaf` | `$insertNodeIntoLeaf` | `index.ts:602` | no |
| `wrap_node_in_element` | `$wrapNodeInElement` | `index.ts:633` | yes (6 files) |
| `handle_indent_and_outdent` | `$handleIndentAndOutdent` | `index.ts:690` | no |
| `insert_first` | `$insertFirst` | `index.ts:727` | no |
| `unwrap_and_filter_descendants` | `$unwrapAndFilterDescendants` | `index.ts:791` | no |
| `descendants_matching` | `$descendantsMatching` | `index.ts:841` | no |
| `first_to_last`, `ChildCursor` | `$firstToLastIterator` (+ `$childIterator`) | `index.ts:871,887` | no |
| `last_to_first` | `$lastToFirstIterator` | `index.ts:883` | no |
| `unwrap_node` | `$unwrapNode` | `index.ts:916` | yes (4 files; `lexical-core/utils/document.ts:35`) |
| `find_matching_parent` (re-export) | `$findMatchingParent` | `index.ts:73`; `packages/lexical/src/LexicalUtils.ts:2456` | yes (19 files) |
| `get_adjacent_sibling_or_parent_sibling_caret` (re-export) | same | `index.ts:73`; `packages/lexical/src/caret/LexicalCaretUtils.ts:603` | no |
| `split_node` (re-export) | `$splitNode` | `index.ts:73`; `LexicalUtils.ts:1854` | no |

#### 1c.4.4 Not ported (utils)

- `mergeRegister`: re-exported at `index.ts:82` (core `utils/mergeRegister.ts:34`). There are no listeners or unregister closures; Rust drops values. Macro: 60 files, all view-side.
- `isMimeType` (`index.ts:108`) and `mediaFileReader` (`:131`): DOM `File`/`FileReader`.
- `calculateZoomLevel` and `needsManualZoom`: `index.ts:759`. DOM (Macro: `TableCellResizer.tsx`).
- `objectKlassEquals` / `ObjectKlass`: `index.ts:651,644`. Cross-realm JS `instanceof`; not applicable.
- `$filter`: `index.ts:669`. Deprecated; use `Iterator::filter_map`.
- `$isEditorIsNestedEditor`: `index.ts:776`. Nested editors (`LexicalNestedComposer`) are a view concept; not used by Macro.
- `makeStateWrapper` / `StateConfigWrapper`: `index.ts:983,929`. `StateKey<V>` is already typed; use core `get_state`/`set_state`.
- `DOMNodeToLexicalConversion(Map)` types: `index.ts:380-385`. DOM import.
- `markSelection`: `markSelection.ts:98`. DOM overlay.
- `positionNodeOnRange`: `positionNodeOnRange.ts:38`. DOM.
- `selectionAlwaysOnDisplay`: `selectionAlwaysOnDisplay.ts:13`. DOM.
- `px`: `px.ts:9`. Internal DOM helper.
- `addClassNamesToElement`, `removeClassNamesFromElement`, `isHTMLElement`, `isHTMLAnchorElement`, `isBlockDomNode`, `isInlineDomNode`: re-exports at `index.ts:77-83`. DOM.
- `CAN_USE_BEFORE_INPUT`, `CAN_USE_DOM`, `IS_ANDROID`, `IS_ANDROID_CHROME`, `IS_APPLE`, `IS_APPLE_WEBKIT`, `IS_CHROME`, `IS_FIREFOX`, `IS_IOS`, `IS_SAFARI`: `index.ts:87-98`. Environment sniffing.

---

### 1c.5 `text`

#### 1c.5.1 Layout

```
src/text/mod.rs       root_text_content, is_root_text_content_empty, can_show_placeholder,
                      find_text_intersection_from_characters
src/text/entity.rs    TextEntity, EntityMatch, the transform pair, the builder extension
```

#### 1c.5.2 Items

```rust
pub fn root_text_content(state: &EditorState) -> String;
/// `false` while composing. Optional `js_trim`. Then `== ""`.
pub fn is_root_text_content_empty(state: &EditorState, is_composing: bool, trim: bool) -> bool;
pub fn can_show_placeholder(state: &EditorState, is_composing: bool) -> bool;
/// Deprecated upstream ("has never worked correctly"); ported 1:1.
pub fn find_text_intersection_from_characters(state: &EditorState, target: Utf16Offset)
    -> Option<(NodeKey, Utf16Offset)>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EntityMatch { pub start: Utf16Offset, pub end: Utf16Offset }

/// A TextNode subtype produced from plain text by a pattern (hashtag, keyword, ...).
pub trait TextEntity: TextNode + Sized {
    /// UTF-16 offsets into `text`. Implementations using `regress` match over UTF-16.
    fn get_match(text: &str) -> Option<EntityMatch>;
    /// `createNode(textNode)`: a fresh, unattached entity node built from the `from` text node
    /// (its text is copied by the implementation).
    fn create(tx: &mut Transaction, from: NodeKey) -> Result<NodeKey>;
}
/// Registered on `Text` (type `"text"` only; transforms are per type, not inherited).
pub fn text_entity_text_transform<E: TextEntity>(tx: &mut Transaction, node: Id<Text>) -> Result<()>;
/// Registered on `E`.
pub fn text_entity_reverse_transform<E: TextEntity>(tx: &mut Transaction, node: Id<E>) -> Result<()>;

pub trait TextEntityBuilderExt {
    /// `registerLexicalTextEntity`:
    /// `.transform::<Text>(text_entity_text_transform::<E>).transform::<E>(text_entity_reverse_transform::<E>)`.
    fn text_entity<E: TextEntity>(self) -> Self;
}
impl TextEntityBuilderExt for EditorBuilder { /* … */ }
```

Semantics:
- `can_show_placeholder` (`canShowPlaceholder.ts:24`):
  - `false` unless `is_root_text_content_empty(state, is_composing, trim = false)`.
  - `false` if root has more than one child.
  - For the single child: a decorator → `false`. An element that is not a Paragraph
    (`!is::<Paragraph>`) → `false`. `indent != 0` → `false`.
  - Then, for each child of that paragraph, check `children[i]` with the **outer** `i` (always
    0). This upstream bug (`:57`) means only the first child is tested, once per child; it must
    be text. Keep it.
- `find_text_intersection_from_characters` (`findTextIntersectionFromCharacters.ts:18`): iterative
  preorder from root's first child. An element with children descends. A text node returns
  `(node, target - acc)` when `acc + size > target`, else adds its size. Then move to the next
  sibling, or the nearest ancestor's next sibling. Childless elements and decorators contribute 0.
- `text_entity_text_transform` (`registerLexicalTextEntity.ts:60`), faithful:
  - Return unless `node` is simple text.
  - If the previous sibling `prev` is text:
    - `combined = prev.text + text`; `pm = get_match(combined)`.
    - If `prev` is an `E`:
      - If `pm` is `None` or `prev.mode != Normal`, replace `prev` with simple text and return.
      - Else, with `diff = pm.end - len(prev.text)` and `diff > 0`: select `prev` (end), set
        `prev.text = prev.text + text[..diff]`. If `diff == len(text)`, remove `node`; else
        `node.text = text[diff..]`. Return.
    - Else, if `pm` is `None` or `pm.start < len(prev.text)`, return.
  - Loop, with `skip = 0`:
    - `m = get_match(text)`. `text = m ? text[m.end..] : ""`.
    - If that rest is empty and the next sibling `ns` is text:
      - `nm = get_match(current.text + ns.text)`.
      - If `nm` is `None`: replace `ns` with simple text if it is an `E`, else `mark_dirty(ns)`.
        Return.
      - If `nm.start != 0`, return.
    - If `m` is `None`, return.
    - If `m.start == 0` and `prev` is text with `is_text_entity()`: `skip += m.end` and continue.
    - Otherwise split: if `m.start == 0`, `split_text(current, [m.end])` gives
      `(to_replace, current)`; else `split_text(current, [m.start + skip, m.end + skip])` gives
      `(_, to_replace, current)`. Missing `to_replace` → `Err(Invariant)`.
    - `r = E::create(to_replace)`, `r.format = to_replace.format`, `replace(to_replace, r)`.
    - If there is no `current`, return. Otherwise `skip = 0`, `prev = r`, and continue.
- "Replace with simple text" (`:50`): a new `Text(text)` with **only** `format` copied (style,
  detail and state are dropped), then `replace`.
- `text_entity_reverse_transform` (`:174`):
  - `m = get_match(text)`. If `m` is `None` or `m.start != 0`, replace with simple text and return.
  - If `len > m.end`, `split_text(node, [m.end])` and return.
  - If the previous sibling is a text entity, replace both it and `node` with simple text.
  - If the next sibling is a text entity, replace it with simple text, and replace `node` too if
    it is still an `E`.
- All `len`/slice operations are UTF-16. `Text` is the type-`"text"` node only (upstream
  `registerNodeTransform(TextNode)` keys on the type `text`, `LexicalEditor.ts:1351`). Several
  entities each add their own `Text` transform, run in registration order.

#### 1c.5.3 Mapping

| Rust item | Ports | Source (file:line) | Used by Macro |
| --- | --- | --- | --- |
| `root_text_content` | `$rootTextContent` | `packages/lexical-text/src/rootTextContent.ts:14` | no |
| `is_root_text_content_empty` | `$isRootTextContentEmpty` | `isRootTextContentEmpty.ts:16` | no |
| `can_show_placeholder` | `$canShowPlaceholder` | `canShowPlaceholder.ts:24` | no |
| `find_text_intersection_from_characters` | `$findTextIntersectionFromCharacters` | `findTextIntersectionFromCharacters.ts:18` | no |
| `(NodeKey, Utf16Offset)` tuple | `TextNodeWithOffset` | `index.ts:11` | no |
| `EntityMatch` | `EntityMatch` | `registerLexicalTextEntity.ts:19` | no |
| `TextEntity`, `TextEntityBuilderExt::text_entity`, transform pair | `registerLexicalTextEntity` | `registerLexicalTextEntity.ts:40,60,174` | no |

#### 1c.5.4 Not ported (text)

- `$isRootTextContentEmptyCurry`: `isRootTextContentEmpty.ts:39`. A closure factory; call directly.
- `$canShowPlaceholderCurry`: `canShowPlaceholder.ts:74`. Same.
- The unregister tuple returned by `registerLexicalTextEntity` (`:219`). There are no listeners; registration happens at build time.

---

### 1c.6 `offset` (deprecated upstream, ported 1:1)

#### 1c.6.1 Layout

```
src/offset.rs    OffsetView, OffsetNode, create_offset_view
```

#### 1c.6.2 Items

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OffsetNodeType { Element, Text, Inline }

/// Arena index into `OffsetView::nodes`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OffsetIdx(u32);

#[derive(Clone, Debug)]
pub struct OffsetNode {
    pub ty: OffsetNodeType,
    pub key: NodeKey,
    pub start: Utf16Offset,
    pub end: Utf16Offset,
    pub child: Option<OffsetIdx>,
    pub parent: Option<OffsetIdx>,
    pub prev: Option<OffsetIdx>,
    pub next: Option<OffsetIdx>,
}

#[derive(Clone, Debug)]
pub struct OffsetView {
    nodes: Vec<OffsetNode>,
    map: HashMap<NodeKey, OffsetIdx>,
    first: Option<OffsetIdx>,
    block_offset_size: u32,
}

/// `$createOffsetView(editor, blockOffsetSize = 1, editorState?)`. Pass `tx.state()` for the
/// pending state.
pub fn create_offset_view(state: &EditorState, block_offset_size: u32) -> Result<OffsetView>;

impl OffsetView {
    pub fn create_selection_from_offsets(&self, state: &EditorState, start: Utf16Offset, end: Utf16Offset,
                                         diff: Option<&OffsetView>) -> Option<RangeSelection>;
    /// Upstream returns -1 for an unresolved side; Rust returns `None`.
    pub fn get_offsets_from_selection(&self, state: &EditorState, selection: &RangeSelection)
        -> (Option<Utf16Offset>, Option<Utf16Offset>);
}

// deprecated re-export (index.ts:542): `$createChildrenArray` = `Read::children_keys` (S1 §5.2)
```

Port every quirk exactly, for Tier A parity. Macro does not use this module.
- Build (`index.ts:421-539`):
  - Preorder over root's children; `state = {offset: 0, prev_is_block: false}`.
  - Element: build its children first. Then, if `!prev_is_block || empty`, set
    `prev_is_block = true` and `offset += block_offset_size`. Its `start` is the offset before its
    children and its `end` the offset after the block bump.
  - Children are created with `parent = None`, and only the **first** child gets
    `parent = element` (`:470-472`); keep that.
  - Text: `len = text UTF-16 length`, type `Text`. Any other leaf: `len = 1`, type `Inline`.
    Either sets `prev_is_block = false`.
- `search` (`:357`): walk siblings. With `end' = end + 1` unless the node is an element and
  `block_offset_size != 0` (elements get no +1), descend into `child` while `offset < end'`.
  Return the node when it has no child.
- `create_selection_from_offsets` (`:76`):
  - Search start and end. With `diff`, adjust each through `get_adjusted_offset_from_diff`
    (`:241`, ported verbatim, including the `visited` set and the walk of the previous view) and
    search again.
  - Text start: `offset = start - node.start`. If `start != end`, the offset is at the node's end,
    and the next sibling is text, move to `(next, 0)`.
  - Inline: use the parent element's key, with offset `node.end` if `end > node.start` else
    `node.start`. Upstream uses `end` for the start side as well; keep it.
  - Element: `(key, 0, element)`.
  - Return `None` if a node is missing.
- `get_offsets_from_selection` (`:190`): text point → `node.start + offset`. Element point → the
  descendant at that index, giving `end` if `index_within_parent != offset`, else `start`.

#### 1c.6.3 Mapping

| Rust item | Ports | Source (file:line) | Used by Macro |
| --- | --- | --- | --- |
| `OffsetNode`, `OffsetNodeType` | `OffsetElementNode` / `OffsetTextNode` / `OffsetInlineNode` | `packages/lexical-offset/src/index.ts:27,37,47,57` | no |
| `OffsetView` | `OffsetView` | `index.ts:61` | no |
| `OffsetView::create_selection_from_offsets` | same | `index.ts:76` | no |
| `OffsetView::get_offsets_from_selection` | same | `index.ts:190` | no |
| (private) adjust / search / build | `$getAdjustedOffsetFromDiff`, `$searchForNodeWithOffset`, `$createOffsetNode`, `$createOffsetChild` | `index.ts:241,357,421,500` | no |
| `create_offset_view` | `$createOffsetView` | `index.ts:545` | no |
| `create_children_array` (re-export) | `$createChildrenArray` | `index.ts:542`; `packages/lexical/src/LexicalUtils.ts:2482` | no |

#### 1c.6.4 Not ported (offset)

Nothing. The module has no DOM.

---

### 1c.7 Macro import census

Imports in `apps/`, `packages/` and `services/` of the Macro worktree, excluding `node_modules`.
The figure is the number of files importing the symbol.
- `@lexical/code`: `$isCodeNode` 12, `CodeNode` 8, `$createCodeNode` 3, `$isCodeHighlightNode` 2,
  `CodeHighlightNode` 2, `registerCodeHighlighting` 2, `PrismTokenizer` 2, `getCodeLanguages` 1,
  `SerializedCodeNode` 1.
- `@lexical/mark`: `MarkNode` 5, `$unwrapMarkNode` 4, `$wrapSelectionInMarkNode` 4,
  `$createMarkNode` 4, `$isMarkNode` 2, `SerializedMarkNode` 2, `$getMarkIDs` 1.
- `@lexical/selection`: `$setBlocksType` 2, `createDOMRange` 2, `$ensureForwardRangeSelection` 1,
  `createRectsFromDOMRange` 1.
- `@lexical/utils`: `mergeRegister` 60, `$findMatchingParent` 19, `$dfsIterator` 12, `$dfs` 8,
  `$wrapNodeInElement` 6, `$unwrapNode` 4, `calculateZoomLevel` 1,
  `$insertNodeToNearestRootAtCaret` 1.
- `@lexical/text` and `@lexical/offset`: none.
## 1d. lexical_rich_nodes::clipboard (model half of @lexical/clipboard)

Upstream `packages/lexical-clipboard/src/clipboard.ts` and `ClipboardImportExtension.ts`
(v0.45.0); S2 CLP-00..CLP-58. Macro imports `$insertGeneratedNodes`
(`apps/web/.../markdown-paste/markdownPastePlugin.ts:1`), `$generateJSONFromSelectedNodes` /
`$generateNodesFromSerializedNodes` (`plugins/tables/tableMove.ts:4`,
`TableSelectionActionBar.tsx:22`) and `$getClipboardDataFromSelection`. The DOM halves
(`DataTransfer`, `ClipboardEvent`, `execCommand` fallback, `caretFromPoint`, `DOMParser`) stay in
JS; JS reads strings out of the `DataTransfer` and passes them here.

Layout: `src/clipboard/{mod.rs, export.rs, import.rs, drop.rs}`. `get_html_content` is behind the
crate's `html` feature (it calls `lexical_html::generate_html_from_nodes`).

```rust
/// CLP-02: `{namespace, nodes}` stringified with `js_json::to_string`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LexicalClipboardPayload { pub namespace: String, pub nodes: Vec<serde_json::Value> }

pub const MIME_PLAIN: &str = "text/plain";
pub const MIME_HTML: &str = "text/html";
pub const MIME_LEXICAL: &str = "application/x-lexical-editor";
pub const MIME_URI_LIST: &str = "text/uri-list";
pub const MIME_LEXICAL_DRAG: &str = "application/x-lexical-drag";

/// CLP-12..17. `None` selection = whole document.
pub fn generate_json_from_selected_nodes(st: &EditorState, namespace: &str,
    selection: Option<&Selection>) -> Result<LexicalClipboardPayload>;
/// CLP-30: `$parseSerializedNode` per item; every node gets a fresh key. Unknown type -> Err.
pub fn generate_nodes_from_serialized_nodes(tx: &mut Transaction, nodes: &[serde_json::Value])
    -> Result<Vec<NodeKey>>;
/// CLP-31/32.
pub fn insert_generated_nodes(tx: &mut Transaction, nodes: &[NodeKey], selection: SelectionSlot) -> Result<()>;   // R2-07
/// CLP-11: None for null/collapsed/empty selections.
pub fn get_lexical_content(st: &EditorState, namespace: &str, selection: Option<&Selection>)
    -> Result<Option<String>>;
/// CLP-10 (feature "html"): "" for collapsed/empty, else generate_html_from_nodes(selection).
#[cfg(feature = "html")]
pub fn get_html_content(st: &EditorState, selection: &Selection, export: &lexical_html::ExportRegistry)
    -> Result<String>;
/// CLP-21 with the default stacks only (Macro never configures GetClipboardDataExtension):
/// `{"text/plain": sel.text_content()}` plus html and lexical entries when non-null.
pub fn get_clipboard_data_from_selection(st: &EditorState, namespace: &str,
    selection: Option<&Selection>) -> Result<IndexMap<&'static str, String>>;

/// One MIME entry the view read from a DataTransfer (`dt.getData(mime)`), in DataTransfer order.
pub struct ClipboardEntry<'a> { pub mime: &'a str, pub data: &'a str }
/// CLP-37: lexical 0, html 10, plain 20, uri-list 30; unweighted mimes after all weighted ones,
/// lexicographic. Data, so the view can extend it.
pub const DEFAULT_IMPORT_MIME_TYPE_PRIORITY: &[(&str, u32)];
/// CLP-34/38: run the importers in priority order; skip empty data; skip text/html when it equals
/// text/plain (iOS Safari autocorrect heuristic); first importer returning true wins.
/// (R2.1) HTML import stays in JS: where upstream calls `$generateNodesFromDOM`, the importer
/// reads `ClipboardPayload::html_nodes` (S1 §14.1; filled by the view's html-import, S12 V-4) and
/// imports them with `$generateNodesFromSerializedNodes` (replacements and normalization
/// applied); `None` there falls through to the next importer. No callback.
pub fn insert_data_transfer_for_rich_text(tx: &mut Transaction, namespace: &str,
    entries: &[ClipboardEntry<'_>], html_nodes: Option<&[SerializedNode]>,
    selection: SelectionSlot) -> Result<bool>;
/// CLP-33: `text/plain` || `text/uri-list` -> `selection.insert_raw_text`.
pub fn insert_data_transfer_for_plain_text(tx: &mut Transaction, entries: &[ClipboardEntry<'_>])
    -> Result<bool>;

/// CLP-51..56 model half of `$doDrop`.
pub enum DropOutcome { NotHandled, Handled /* JS preventDefault */ }
pub fn do_drop(tx: &mut Transaction, drop_caret: PointCaret, same_editor: bool, rich: bool,
    entries: &[ClipboardEntry<'_>], html_nodes: Option<&[SerializedNode]>)
    -> Result<DropOutcome>;
```

Semantics:
- `generate_json_from_selected_nodes` (`clipboard.ts:547`): for each top-level child of root, call
  `append_nodes_to_json(node, target = nodes)`; return `{namespace, nodes}`.
- `append_nodes_to_json(node, target)` (`:483`):
  - `should_include = selection.is_none() || is_selected(node, selection)`.
  - `should_exclude = node is element && exclude_from_copy(node, Some(CopyDestination::Html))`.
    The destination is `Html` even for JSON (upstream quirk, CLP-13; keep it).
  - A text node is first cloned and sliced: `slice_selected_text_node_content(selection, clone)`
    (`'clone'` mode, the clone keeps the node's key). A zero-length result is not included
    (CLP-14).
  - `serialized = export_node_to_json(target_node)`: `export_json()` whose `type` equals the
    registered type, else `Err(Invariant("... does not implement .exportJSON()"))`; an element's
    JSON must have a `children` array (CLP-17).
  - For each child of an element (the original node's children): recurse with `serialized.children`
    as target; if the recursion included the child and `!should_include` and
    `extract_with_child(node, child, selection, CopyDestination::Clone)`, set `should_include = true`
    (CLP-15).
  - Included and not excluded: push `serialized`. Otherwise splice `serialized.children` into
    `target` at its end (hoist, CLP-16). Return `should_include`.
- `insert_generated_nodes` (`:395`): dispatch `Command::InsertClipboardNodes { nodes }` (S1) to
  the registered handlers (tables and code hook it). If none handles it:
  `selection.insert_nodes(nodes)` then `update_selection_on_insert` (`:412`): collapsed
  RangeSelection only; the text node at the anchor (text point: the anchor node; element point:
  scan backward from the child before the offset, stopping at a non-inline element); if found and
  its format or style differs from the selection's, copy both onto the selection and mark it dirty.
- Lexical importer (CLP-39, `ClipboardImportExtension.ts:179`): parse the payload; accept only when
  `payload.namespace == namespace` and `nodes` is an array; then
  `generate_nodes_from_serialized_nodes` + `insert_generated_nodes`, true. A parse error falls
  through to the next importer (JS logs `console.error`; Rust records a `warn!` with the byte
  length only).
- Plain importer (CLP-41, `:234` + `LexicalSelection.ts:3317 tokenizeRawText`): non-Range
  selection -> `insert_raw_text(text)`. Range: split on `\r\n` and `\n` -> `insert_paragraph()`,
  `\t` -> insert a TabNode, other runs -> `insert_text`, each against the **current** selection.
  `text/uri-list` uses the plain importer (CLP-42).
- `do_drop` (`clipboard.ts:260-362`): (1) `split_at_point_caret_next(drop_caret)` (S1) gives the
  stable caret; None -> NotHandled. (2) `same_editor`: require a non-collapsed RangeSelection, else
  NotHandled; if the drop caret is strictly inside the selection -> Handled with no change;
  otherwise `selection.remove_text()` first (move semantics, CLP-54). (3) If the stable caret's
  origin is detached after the removal -> Handled (CLP-55). (4) Set a collapsed selection at the
  stable caret and run the rich or plain inserter (CLP-56). The drag marker check
  (`application/x-lexical-drag`, CLP-51) and the cross-editor `deleteByDrag` dispatch (CLP-57)
  stay in the view.

Mapping:

| Rust item | Ports | Source | Macro |
| --- | --- | --- | --- |
| `generate_json_from_selected_nodes` | `$generateJSONFromSelectedNodes` | clipboard.ts:547 | Y (P0) |
| `generate_nodes_from_serialized_nodes` | `$generateNodesFromSerializedNodes` | clipboard.ts:577 | Y (P0) |
| `insert_generated_nodes` | `$insertGeneratedNodes`, `$updateSelectionOnInsert` | clipboard.ts:395, :412 | Y (P0) |
| `get_clipboard_data_from_selection` | `$getClipboardDataFromSelection` (default stacks) | clipboard.ts:716 | Y (P0) |
| `insert_data_transfer_for_rich_text` | `$insertDataTransferForRichText`, ClipboardImportExtension `$runImport` + default importers | clipboard.ts:151; ClipboardImportExtension.ts:159-313, :333 | Y (P0) |
| `insert_data_transfer_for_plain_text` | `$insertDataTransferForPlainText` | clipboard.ts:129 | via plain text |
| `get_lexical_content`, `get_html_content` | `$getLexicalContent`, `$getHtmlContent` | clipboard.ts:102, :73 | |
| `do_drop` | `$doDrop`, `$handleRichTextDrop`, `$handlePlainTextDrop` | clipboard.ts:260, :364, :376 | |
| `DEFAULT_IMPORT_MIME_TYPE_PRIORITY` | `DEFAULT_IMPORT_MIME_TYPE_PRIORITY`, `DEFAULT_IMPORT_MIME_TYPE` | ClipboardImportExtension.ts:158 | |

Not ported (view): `copyToClipboard`, `$copyToClipboardEvent`, `setLexicalClipboardDataTransfer`,
`$writeDragSourceToDataTransfer`, `caretFromPoint`, the html importer's `DOMParser`/TrustedTypes,
`ClipboardDOMImportExtension`, the configurable `GetClipboardDataExtension` /
`ClipboardImportExtension` stacks and `mergeConfig` (Macro uses only the defaults, CLP-18..20,
CLP-35/36/43; Tier B covers them), `$exportMimeTypeFromSelection` (P1, single-mime variant of the
default stacks; add if a caller appears).

## 2. lexical_markdown

Crate `crates/client/lexical/lexical_markdown/`. Ports `packages/lexical-markdown/src/*`
(v0.45.0) plus Macro's list-indent patch. Depends on `lexical_model`, `lexical_rich_nodes` (its `list`, `heading`/`quote`, `code`,
`link` and `selection` modules), and `regress` (features `utf16`, with mitigation M-I, §2.9). wasm32-safe: `std::sync::LazyLock` only, no threads.

All offsets are UTF-16 code units (`Utf16Offset`). Every JS `str[i]`, `str.length`,
`slice`, `match.index`, `match[0].length` maps to UTF-16 arithmetic. Scanners that index
characters (`textContent[anchorOffset - 1]`, the delimiter scanner) work on a
`Vec<u16>` copy of the line or node text; texts here are line- or node-sized.

JS whitespace is one set everywhere in this crate (`\s`, `trim`, `trimStart`, `trimEnd`):
`U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028, U+2029, U+202F, U+205F,
U+3000, U+FEFF`. Implement `util::is_js_whitespace(u16)` and `util::js_trim{,_start,_end}`.
Never use `str::trim`/`char::is_whitespace` (they include U+0085 and exclude U+FEFF).

### 2.1 Module layout

```
lexical_markdown/
  Cargo.toml
  AGENTS.md, CLAUDE.md -> AGENTS.md
  src/
    lib.rs              re-exports; convert_from_markdown_string, convert_to_markdown_string,
                        convert_selection_to_markdown_string
    options.rs          MarkdownOptions
    matcher.rs          Match, Matcher, RegexMatcher, find_all/replace helpers over regress
    transformer.rs      ElementTransformer, MultilineElementTransformer, TextFormatTransformer,
                        TextMatchTransformer, Transformer, Transformers (registry + indexes),
                        ReplaceResult, AfterStartMatch, RegExpEnd, EndIndex
    state.rs            LIST_MARKER_STATE, CODE_FENCE_STATE, HARD_LINE_BREAK_STATE,
                        parse_markdown_hard_line_break, create_markdown_line_break_node
    normalize.rs        normalize_markdown
    import/mod.rs       import driver: import_multiline, import_blocks, normalize_tabs
    import/text.rs      import_text_transformers, can_contain_transformable_markdown
    import/text_format.rs  find_outermost_text_format_transformer, scan_delimiters,
                        process_emphasis, can_emphasis, is_flanking, import_text_format_transformer
    import/text_match.rs   find_outermost_text_match_transformer, import_found_text_match_transformer
    export.rs           ExportCx, export_top_level_elements, export_children,
                        export_text_format, selection export
    shortcuts.rs        ShortcutTrigger, markdown_shortcuts, markdown_shortcuts_on_enter,
                        run_element_transformers, run_multiline_element_transformers,
                        run_text_match_transformers, run_text_format_transformers
    builtin/mod.rs      HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST, CHECK_LIST,
                        text-format statics, LINK, groupings, TRANSFORMERS
    builtin/block.rs    create_block_node
    builtin/list.rs     list_replace, list_export, get_indent
    builtin/code.rs     Code (multiline)
    builtin/link.rs     Link (text match)
    util.rs             unescape_text, is_empty_paragraph, is_js_whitespace, js_trim*,
                        is_punctuation, is_punctuation_or_space
```

### 2.2 Options

```rust
/// Replaces `LIST_INDENT_SIZE` (upstream 4, Macro patch 2) and the two boolean
/// arguments of `$convertFromMarkdownString` / `$convertToMarkdownString`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MarkdownOptions {
    /// Spaces per list nesting level, both directions. Must be >= 1
    /// (0 returns `Error::InvalidArgument`; upstream would divide by zero).
    pub list_indent: u8,
    /// Import: skip `normalize_markdown`, keep empty paragraphs, never merge lines.
    /// Export: keep literal backslashes, no extra blank line between blocks.
    pub should_preserve_new_lines: bool,
    /// Import only. Merge adjacent non-empty lines with a space (CommonMark soft breaks).
    /// Ignored when `should_preserve_new_lines`.
    pub should_merge_adjacent_lines: bool,
}
impl Default for MarkdownOptions { /* list_indent: 4, false, false */ }
```

Every read of `LIST_INDENT_SIZE`:

| Site | Use | Rust |
| --- | --- | --- |
| `packages/lexical-markdown/src/MarkdownTransformers.ts:349` | declaration | `MarkdownOptions::list_indent` |
| `packages/lexical-markdown/src/MarkdownTransformers.ts:362` | `getIndent`: `floor(spaces / LIST_INDENT_SIZE)` (import and typing) | `get_indent(ws, opts.list_indent)` |
| `packages/lexical-markdown/src/MarkdownTransformers.ts:457` | `$listExport`: `' '.repeat(depth * LIST_INDENT_SIZE)` | `list_export(.., opts.list_indent)` |
| `packages/lexical-markdown/src/utils.ts:347`, read at `:371` | dead legacy `processNestedLists` | not ported |

The patch ([markdown patch](../../../apps/web/patches/%40lexical%252Fmarkdown%400.45.0.patch)) changes exactly these
constants, in `src/` and the four `dist/` bundles (prod bundles: `n.length/4` -> `/2` in
`getIndent`, `" ".repeat(4*o)` -> `2*o` in `$listExport`). The src hunks:

```diff
@@ -346,7 +346,7 @@ const createBlockNode = (       (src/MarkdownTransformers.ts)
 // Amount of spaces that define indentation level
 // TODO: should be an option
-const LIST_INDENT_SIZE = 4;
+const LIST_INDENT_SIZE = 2;
@@ -344,7 +344,7 @@ function listExport(            (src/utils.ts, dead code)
 // TODO: should be param
-const LIST_INDENT_SIZE = 4;
+const LIST_INDENT_SIZE = 2;
```

Macro passes `MarkdownOptions { list_indent: 2, .. }` everywhere it imports or exports
(and wherever it runs shortcuts). Macro's own `packages/lexical-core/transformers/image.ts:161`
has a separate `LIST_INDENT_SIZE = 2`; that port should read `opts.list_indent` too.

### 2.3 Match and Matcher

Upstream transformer callbacks receive a JS `RegExpMatchArray`: positional groups
(`undefined` for non-participating), `index`, `input`. Macro also passes two `RegExp`
subclasses that override `exec` and return synthetic arrays
(`packages/lexical-core/transformers/auto-link.ts:15` `AutoLinkRegExp`, `:44`
`EscapedAutoLinkRegExp`, used as `importRegExp`/`regExp`). Hence a `Matcher` trait.

```rust
/// JS `RegExpMatchArray` for a non-global match. Offsets are UTF-16.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Match {
    /// `match.index`: start of group 0 in `input`.
    pub index: Utf16Offset,
    /// `match.input`.
    pub input: std::sync::Arc<str>,
    /// `match[i]`; `None` = JS `undefined`. Always at least one entry (group 0).
    groups: Vec<Option<String>>,
}
impl Match {
    /// Synthetic match (Matcher impls, the delimiter scanner, `fakeStartMatch`).
    pub fn new(index: Utf16Offset, input: impl Into<std::sync::Arc<str>>,
               groups: Vec<Option<String>>) -> Result<Match>;   // Err if groups is empty
    pub fn get(&self, i: usize) -> Option<&str>;     // match[i]
    /// `match[i]` coerced like JS string use of `undefined` is NOT done; callers
    /// that upstream do `match[i] || x` use `get(i).filter(|s| !s.is_empty())`.
    pub fn full(&self) -> &str;                       // match[0]
    pub fn full_len16(&self) -> u32;                  // match[0].length
    pub fn end(&self) -> Utf16Offset;                 // index + match[0].length
    pub fn group_count(&self) -> usize;               // match.length
    pub fn set(&mut self, i: usize, value: Option<String>);  // fakeStartMatch[2] = ''
}

/// `String.prototype.match(re)` with a non-global `re` (equivalently `re.exec(text)`).
pub trait Matcher: Send + Sync + std::fmt::Debug {
    fn exec(&self, text: &str) -> Option<Match>;
    /// `re.test(text)`.
    fn test(&self, text: &str) -> bool { self.exec(text).is_some() }
}

/// A JS regex compiled by `regress` with ECMAScript semantics, matched over UTF-16.
#[derive(Debug)]
pub struct RegexMatcher { regex: regress::Regex, source: Box<str>, flags: Box<str> }
impl RegexMatcher {
    /// `source`/`flags` exactly as JS `RegExp(source, flags)`. Accepts `i m s u`.
    /// Rejects `g` and `y` with `Error::InvalidArgument`: upstream calls `str.match(re)`,
    /// which with `g` returns all matches without `index`; no built-in uses either.
    pub fn new(source: &str, flags: &str) -> Result<RegexMatcher>;
    pub fn source(&self) -> &str;
    pub fn flags(&self) -> &str;
}
impl Matcher for RegexMatcher { /* see below */ }
```

`RegexMatcher::exec`: encode `text` to `Vec<u16>`, run
`regex.find_from_utf16(&units, 0).next()`, set `index` = group 0 start, decode each
group range with `String::from_utf16_lossy`. A group boundary inside a surrogate pair
(possible only with non-`u` classes such as `[^x]`) becomes U+FFFD; Rust strings cannot
hold lone surrogates. Built-in statics are `static X: LazyLock<RegexMatcher>`, built
with `RegexMatcher::new(..).expect(..)`; their compilation is covered by a unit test
that forces every static.

Crate-private helpers in `matcher.rs`:
- `find_all(&RegexMatcher, &str) -> Vec<Match>`: JS `matchAll` with `g`. Next search
  starts at the previous match end; on an empty match advance one code unit (non-`u`) or
  one code point (`u`). No live caller can match empty.
- `replace_all(&RegexMatcher, &str, impl FnMut(&Match) -> String) -> String`: JS
  `str.replace(/g/, fn)`, same advance rule.

### 2.4 Transformer traits

Upstream types: `packages/lexical-markdown/src/MarkdownTransformers.ts:55-219`. Upstream
`replace` returns `boolean | void`; only `false` means "not handled, try the next
transformer". `export` returns `string | null`; `null` means "try the next transformer".

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplaceResult { Handled, NotHandled }   // void|true , false

pub trait ElementTransformer: Send + Sync + std::fmt::Debug {
    /// Node `TYPE` strings that must be registered (`dependencies: Klass[]`).
    fn dependencies(&self) -> &[&'static str];
    /// `export(node, traverseChildren, selection?)`. Children go through
    /// `cx.export_children(..)`; `cx.selection()` is the optional selection.
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>>;
    fn reg_exp(&self) -> &dyn Matcher;
    /// `replace(parentNode, children, match, isImport)`.
    fn replace(&self, tx: &mut Transaction, opts: &MarkdownOptions, parent: NodeKey,
               children: &[NodeKey], m: &Match, is_import: bool) -> Result<ReplaceResult>;
    /// `triggerOnEnter?: boolean`.
    fn trigger_on_enter(&self) -> bool { false }
}

/// `regExpEnd?: RegExp | {optional?: true, regExp: RegExp}`.
pub enum RegExpEnd<'a> {
    /// `regExpEnd` undefined: end is optional, nothing matches it (runs to end of doc).
    None,
    /// A bare `RegExp`, or `{regExp}` with `optional` absent or falsy.
    Required(&'a dyn Matcher),
    /// `{optional: true, regExp}`.
    Optional(&'a dyn Matcher),
}

/// Return of `handleImportAfterStartMatch`.
pub enum AfterStartMatch {
    /// `undefined`: run the default end-search.
    Default,
    /// `null`: try the next multiline transformer.
    Skip,
    /// `[imported, lastLineIndex]`.
    Done { imported: bool, last_line: usize },
}

pub trait MultilineElementTransformer: Send + Sync + std::fmt::Debug {
    fn dependencies(&self) -> &[&'static str];
    fn export(&self, _cx: &mut ExportCx<'_>, _node: NodeKey) -> Result<Option<String>> { Ok(None) }
    fn handle_import_after_start_match(&self, _tx: &mut Transaction, _opts: &MarkdownOptions,
        _lines: &[String], _root: NodeKey, _start_line_index: usize, _start_match: &Match)
        -> Result<AfterStartMatch> { Ok(AfterStartMatch::Default) }
    fn reg_exp_start(&self) -> &dyn Matcher;
    fn reg_exp_end(&self) -> RegExpEnd<'_> { RegExpEnd::None }
    /// `replace(rootNode, children|null, startMatch, endMatch|null, linesInBetween|null, isImport)`.
    /// Import: `children = None`, `lines_in_between = Some`. Shortcut: the reverse.
    fn replace(&self, tx: &mut Transaction, opts: &MarkdownOptions, root: NodeKey,
               children: Option<&[NodeKey]>, start_match: &Match, end_match: Option<&Match>,
               lines_in_between: Option<Vec<String>>, is_import: bool) -> Result<ReplaceResult>;
}

/// Plain data, like upstream's `Readonly<{format, tag, intraword?}>`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextFormatTransformer {
    /// Ordered; export uses `format[0]`, import toggles in order. Single-bit `Format`s.
    pub format: std::borrow::Cow<'static, [Format]>,
    pub tag: std::borrow::Cow<'static, str>,
    /// Upstream `intraword?: boolean`; only `=== false` is ever tested, so default true.
    pub intraword: bool,
}

/// `getEndIndex?` result.
pub enum EndIndex { Default, At(Utf16Offset), Reject }   // (absent), number, false

pub trait TextMatchTransformer: Send + Sync + std::fmt::Debug {
    fn dependencies(&self) -> &[&'static str];
    /// `export?(node, exportChildren, exportFormat)`.
    fn export(&self, _cx: &mut ExportCx<'_>, _node: NodeKey) -> Result<Option<String>> { Ok(None) }
    /// `importRegExp?`. `None` = skipped on import.
    fn import_reg_exp(&self) -> Option<&dyn Matcher> { None }
    /// `regExp` (shortcuts only).
    fn reg_exp(&self) -> &dyn Matcher;
    /// Whether `replace` is defined. Upstream skips transformers without it on import
    /// and in shortcuts.
    fn has_replace(&self) -> bool { true }
    /// `replace?(node, match) -> TextNode | void`. Returns a text node to recurse into.
    fn replace(&self, tx: &mut Transaction, node: NodeKey, m: &Match) -> Result<Option<NodeKey>>;
    fn get_end_index(&self, _tx: &Transaction, _node: NodeKey, _m: &Match) -> EndIndex { EndIndex::Default }
    /// `trigger?`: one UTF-16 code unit (BMP char), compared with the unit before the caret.
    fn trigger(&self) -> Option<char> { None }
}

#[derive(Clone, Debug)]
pub enum Transformer {
    Element(std::sync::Arc<dyn ElementTransformer>),
    MultilineElement(std::sync::Arc<dyn MultilineElementTransformer>),
    TextFormat(TextFormatTransformer),
    TextMatch(std::sync::Arc<dyn TextMatchTransformer>),
}
```

`Transformers` is the registry plus every index upstream builds per call
(`transformersByType`, `createTextFormatTransformersIndex`, the shortcut indexes). Build it
once and reuse it; it holds all compiled regexes.

```rust
pub struct Transformers {
    // transformersByType (utils.ts:429): per-type lists, input order kept within a type.
    element: Vec<std::sync::Arc<dyn ElementTransformer>>,
    multiline_element: Vec<std::sync::Arc<dyn MultilineElementTransformer>>,
    text_format: Vec<TextFormatTransformer>,
    text_match: Vec<std::sync::Arc<dyn TextMatchTransformer>>,
    // createTextFormatTransformersIndex (MarkdownImport.ts:317):
    /// transformersByTag: insertion-ordered by first occurrence of a tag; a later
    /// duplicate tag replaces the value in place (JS object key order).
    format_by_tag: Vec<(String, usize)>,
    /// fullMatchRegExpByTag['`'], present iff a text-format transformer has tag "`".
    code_span: Option<&'static RegexMatcher>,
    // createMarkdownExport (MarkdownExport.ts:51): format.len() == 1, stable-sorted with
    // transformers whose format contains CODE last.
    export_text_format: Vec<usize>,
    // registerMarkdownShortcuts (MarkdownShortcuts.ts:444-468):
    element_for_enter: Vec<usize>,              // element where trigger_on_enter()
    format_by_trigger: Vec<(u16, Vec<usize>)>,  // last code unit of tag
    match_by_trigger: Vec<(u16, Vec<usize>)>,   // trigger(); None skipped
    composition_end_triggers: Vec<u16>,         // ' ' + every tag's last unit + every trigger
}
impl Transformers {
    pub fn new(list: impl IntoIterator<Item = Transformer>) -> Transformers;
    /// `invariant(editor.hasNode(dep))` for element, multiline and text-match
    /// transformers (MarkdownShortcuts.ts:470-488). Text-format has no dependencies.
    /// Err(`lexical_markdown::Error::MissingNode { type_name }`, R2-45); never panics.
    pub fn check_dependencies(&self, editor: &Editor) -> Result<()>;
    pub fn element(&self) -> &[std::sync::Arc<dyn ElementTransformer>];
    pub fn multiline_element(&self) -> &[std::sync::Arc<dyn MultilineElementTransformer>];
    pub fn text_format(&self) -> &[TextFormatTransformer];
    pub fn text_match(&self) -> &[std::sync::Arc<dyn TextMatchTransformer>];
}
```

Ordering and precedence (preserve exactly):
- Import: multiline transformers first, in order, per line; then element transformers,
  in order; the first whose `replace` is not `NotHandled` wins.
- Export: `[...multiline, ...element]` in that order; first non-`None` wins. Text match
  transformers are tried, in order, before any child is exported.
- Shortcuts while typing: element, then multiline, then text match, then text format.
  On Enter: multiline, then `element_for_enter`.
- Text format: per-trigger lists keep registry order (with `TRANSFORMERS`, `*` maps to
  `***`, `**`, `*`).

### 2.5 Node state keys and hard line breaks

Markdown attaches state to nodes it does not own, so these stay `StateKey`s
(`MarkdownTransformers.ts:237-262`). Default values are not serialized (core NodeState rule).
`resetOnCopyNode: true` on all three.

```rust
/// 'mdListMarker' on ListNode. parse: "-", "*" or "+" else "-". Default "-".
pub static LIST_MARKER_STATE: StateKey<String>;
/// 'mdCodeFence' on CodeNode. parse: >= 3 backticks only, else "```". Default "```".
pub static CODE_FENCE_STATE: StateKey<String>;
/// 'mdHardLineBreak' on LineBreakNode. parse: "\\" or >= 2 U+0020 only, else "". Default "".
pub static HARD_LINE_BREAK_STATE: StateKey<String>;

/// `line.endsWith('\\')` -> (line minus last unit, "\\"); else `/^(.*?\S)( {2,})$/`
/// -> (group1, group2); else None.
pub fn parse_markdown_hard_line_break(line: &str) -> Option<(String, String)>;

/// `$createMarkdownLineBreakNode(previousNode)`: creates a LineBreakNode; if the last child
/// of `previous` is a text node: when its text parses as a hard break, set that text to the
/// stripped part and store the marker; else when its text is `^ {2,}$` and some earlier
/// sibling on the same visual line (scan back to the previous LineBreakNode) has text
/// containing a non-whitespace unit, set its text to "" and store the spaces as marker.
/// The line break is returned unattached.
pub fn create_markdown_line_break_node(tx: &mut Transaction, previous: NodeKey) -> Result<NodeKey>;
```

### 2.6 Import

```rust
/// `$convertFromMarkdownString(markdown, transformers, node?, shouldPreserveNewLines,
/// shouldMergeAdjacentLines)` (index.ts:57).
pub fn convert_from_markdown_string(tx: &mut Transaction, markdown: &str,
    transformers: &Transformers, node: Option<NodeKey>, opts: &MarkdownOptions) -> Result<()>;

/// `normalizeMarkdown(input, shouldMergeAdjacentLines)` (MarkdownTransformers.ts:888).
/// Not exported by upstream index.ts; `pub` for Macro's ported transformers.
pub fn normalize_markdown(input: &str, should_merge_adjacent_lines: bool) -> String;
```

Steps (file:line in `packages/lexical-markdown/src/`):

1. `index.ts:64` If `!should_preserve_new_lines`, `markdown = normalize_markdown(markdown,
   should_merge_adjacent_lines)`.
2. `normalize_markdown` (`MarkdownTransformers.ts:888-962`). Split on `'\n'` only (`\r`
   stays in the line). `in_code = false`. Per line `i`: `line = js_trim_end(raw)`;
   `last = sanitized.last()`; `hard = (i < n-1) ? parse_markdown_hard_line_break(raw) : None`;
   `last_hard = last.is_some_and(|l| parse_markdown_hard_line_break(l).is_some())`.
   - `CODE_SINGLE_LINE.test(line)`: push `line`, continue (no toggle).
   - `CODE_START.test(line) || CODE_END.test(line)`: toggle `in_code`, push `line`, continue.
   - `in_code`: push `raw`, continue.
   - If any of: `line == ""`, `last == Some("")`, `last` is None or empty, HEADING(last),
     HEADING(line), QUOTE(line), ORDERED_LIST(line), UNORDERED_LIST(line), CHECK_LIST(line),
     TABLE_ROW(line), TABLE_ROW_DIVIDER(line), `last_hard`, `!should_merge`, TAG_START(line),
     TAG_END(line), TAG_END_AT_END(last), TAG_START_AT_END(last), CODE_END(last): push
     `(!should_merge && line != "") || hard.is_some() ? raw : line`.
   - Else replace the last entry with `last + " " + js_trim_start(hard.is_none() ? line : raw)`.
   - Join with `'\n'`.
3. `MarkdownImport.ts:55-58` `lines = markdown.split('\n')`; `root = node.unwrap_or(tx.root())`;
   clear `root` (remove every child, `LexicalElementNode.ts:420`).
4. `MarkdownImport.ts:60-87` For `i` in `0..lines.len()`: `(imported, shifted) =
   import_multiline(lines, i)`; if `imported`, `i = shifted` and continue with `i + 1`.
   Else `import_blocks(lines[i])`. A handler returning `Done { imported: false, .. }`
   makes the caller fall through to `import_blocks(lines[i])` and ignore `last_line`.
5. `import_multiline` (`MarkdownImport.ts:120-230`). For each multiline transformer, in order:
   - `start = reg_exp_start().exec(lines[s])`; none: next transformer.
   - `handle_import_after_start_match(..)`: `Skip` -> next transformer; `Done{..}` ->
     return it; `Default` -> continue below.
   - `(end_re, optional)` from `reg_exp_end()`: `None` -> `(None, true)`,
     `Required(r)` -> `(Some(r), false)`, `Optional(r)` -> `(Some(r), true)`.
   - `e = s`. While `e < n`: `end = end_re.and_then(|r| r.exec(lines[e]))`.
     If `end` is none and (`!optional` or `e < n-1`): `e += 1`, continue.
     If `end` is some, `e == s` and `end.index == start.index`: `e += 1`, continue.
     Build `between`: if `end` is some and `e == s`:
     `[slice(lines[s], start.full_len16(), -end.full_len16())]`; else for `j` in `s..=e`:
     `j == s` -> `slice(lines[j], start.full_len16())`; `j == e && end.is_some()` ->
     `slice(lines[j], 0, -end.full_len16())`; else `lines[j]`. Use JS `slice` semantics:
     a negative end of `-0` is `0`, so a zero-length end match yields `""`. Note that the
     first-line slice uses `start.full_len16()`, not `start.end()`.
     `replace(tx, opts, root, None, &start, end.as_ref(), Some(between), true)`:
     `Handled` -> return `(true, e)`; `NotHandled` -> stop scanning for this transformer
     and try the next one.
   - If `!optional` and no end was found, the while loop ends and the next transformer is tried.
   - Nothing handled: `(false, s)`.
6. `import_blocks(line)` (`MarkdownImport.ts:232-293`):
   - Create `TextNode(line)` in a new `ParagraphNode`, append to `root`.
   - For each element transformer: `m = reg_exp().exec(line)` (always the original line).
     If matched: set the text node's text to `slice(line, m.full_len16())` (not restored
     if `replace` declines; later transformers still see the old line but the node keeps
     the truncated text); `replace(tx, opts, paragraph, &[text], &m, true)`; `Handled` -> break.
   - `import_text_transformers(text)`.
   - Merge: if the paragraph is still attached, `line` is non-empty, `!should_preserve_new_lines`,
     and the previous sibling is a ParagraphNode, QuoteNode or ListNode: target = that
     sibling, or for a ListNode the nearest ListItemNode ancestor-or-self of its last
     descendant (`None` if no descendant). If target exists and its text-content size
     is > 0: splice at its end `[create_markdown_line_break_node(target), ...paragraph's
     children]` and remove the paragraph.
7. `MarkdownImport.ts:89-108` Over a snapshot of `root`'s children: if
   `!should_preserve_new_lines`, `is_empty_paragraph(child)` and `root` currently has > 1
   children, remove it and continue (the last empty one survives). Otherwise, for an element
   child, `normalize_tabs` on every descendant text node (`getAllTextNodes`, includes nested
   elements such as links and code).
8. `normalize_tabs` (`MarkdownImport.ts:296-315`): split at every `\t` index `k` and `k+1`
   (`split_text` sorts and dedups), replace every resulting node whose text is exactly
   `"\t"` with a fresh TabNode (no format copied).
9. `MarkdownImport.ts:110` If `tx.selection().is_some()`, `select_start(root)` (first
   descendant's start, else `root.select()`). Transformers never select on import:
   every `replace` selects only when `!is_import`. `split_text` moves selection points
   as core does.

`is_empty_paragraph(node)` (`utils.ts:452`): a ParagraphNode with no children, or with exactly
one text-kind child whose text is 0-3 JS-whitespace units.

Empty TextNodes created here (`TextNode("")` for an empty line, CODE with empty code) are
left for core normalization at commit, as upstream.

Text transformers (`importTextTransformers.ts:41-141`), `import_text_transformers(node)`:

1. `f = find_outermost_text_format_transformer(node)`, `t = find_outermost_text_match_transformer(node)`.
2. If both: keep `f` when `f.start <= t.start && f.end >= t.end` or `t.start > f.end`;
   otherwise keep `t` (an adjacent `t.start == f.end` keeps `t`).
3. `f`: `import_text_format_transformer`; else `t`: `import_found_text_match_transformer`
   (`None` -> return immediately: no recursion and **no** unescape, as upstream's bare `return;`
   at `importTextTransformers.ts:110-112`, which skips `:137-140`. The branch is dead in JS because
   the finder filters out transformers without `replace` (`importTextMatchTransformer.ts:29`); keep
   it for a `replace` that returns `None`).
4. Recurse into `node_after`, then `node_before`, then `transformed` (each only if
   `can_contain_transformable_markdown`: text-kind and no CODE format).
5. Unescape: `set_text(node, unescape_text(text(node)))` on the node key this call was given.
   Core `split_text` keeps the original key for the first part (non-segmented nodes,
   `LexicalTextNode.ts:1023-1035`), so when a split starts at 0 or the match spans the whole
   node, this node is also the `transformed` node and gets unescaped twice (once by the
   recursion). Keep that. If the key was replaced (LINK at offset 0), it is detached;
   skip when it no longer exists, else set it (no visible effect).

`unescape_text(s)` (`utils.ts:466-472`): pass 1, left to right, `\` followed by an ASCII
punctuation unit (`!-/ :-@ [-\` {-~`) -> drop the backslash (non-overlapping, so `\\\\`
becomes `\\`). Pass 2, on the result: `&#` + ASCII digits + `;` -> the code point. Scalar
value -> that char; U+D800-DFFF -> U+FFFD (JS yields a lone surrogate); > U+10FFFF or digit
overflow -> leave the entity text unchanged (JS throws `RangeError` and aborts the whole
import; do not replicate).

`find_outermost_text_format_transformer(node)` (`importTextFormatTransformer.ts:25-123`):

1. Code spans, if `code_span` is set: all matches of the code-span regex over the text
   (`find_all`). For each: `start = m.index + len16(m[1])`, `end = m.end()`; push
   `start..end` to exclude ranges; the first one is `code = {start, end, content: m[3], tag: "`"}`.
2. `delims = scan_delimiters(text, exclude)`; `emph = process_emphasis(..)` if non-empty.
3. Pick: both -> `emph` if `emph.start <= code.start && emph.end >= code.end`, else `code`
   (also when `emph` lies entirely before `code`); one -> it; none -> `None`.
4. Return `{start, end, transformer: format_by_tag[tag], m}` with synthetic
   `m = Match::new(start, text, [slice(start, end), tag, content])`.

`scan_delimiters` (`:125-184`): delimiter chars = first unit of every tag except tags
starting with `` ` ``. Walk `i`: skip if unit not a delimiter char, or odd count of
backslashes right before `i`, or `i` in an exclude range (`start <= i < end`, start index
only). Else `len` = run of the same unit; `can_open = can_emphasis(.., true)`,
`can_close = can_emphasis(.., false)`; push `{index, char, length, original_length: len,
can_open, can_close, active: true}` if either; `i += len`.

`can_emphasis(c, i, len, open)` (`:293-314`): false unless `is_flanking(i, len, open)`. `*`
-> true. `_` -> true if not flanking on the other side, else true iff the adjacent unit
(`text[i-1]` for open, `text[i+len]` for close) exists and is punctuation. Any other char
(`~`, `=`) -> true.

`is_flanking(i, len, left)` (`:316-340`): `(primary, secondary) = left ? (after, before) :
(before, after)`; false if `primary` absent or whitespace; true if `primary` is not
punctuation; else true iff `secondary` absent, whitespace or punctuation.

`process_emphasis` (`:186-291`): CommonMark "process emphasis" over the list, returning the
outermost match rather than mutating text. `openers_bottom` keyed by `(char, can_open)`,
default `-1`. `pos = 0`; while `pos < len`: closer = `delims[pos]`; skip (`pos += 1`) unless
active, `can_close`, `length > 0`. Scan `k` from `pos-1` down to `> bottom` for an opener
that is active, `can_open`, `length > 0`, same char. Rule of 3: if `opener.can_close ||
closer.can_open`, and `(o.orig + c.orig) % 3 == 0` while neither `orig` is a multiple of 3,
skip that opener. Tag = longest tag starting with that char with `len <= min(o.length,
c.length)`, ties broken by `format_by_tag` order; none -> skip that opener. Found:
`m = {start: o.index + o.length - tag_len, end: c.index + tag_len, content:
text[o.index + o.length .. c.index], tag}`; keep it if no result yet, `m.start <
result.start`, or same start with `m.end > result.end`. Deactivate `delims[k+1..pos]`;
`o.length -= tag_len; c.length -= tag_len; o.active = o.length > 0`; if `c.length > 0`
then `c.index += tag_len` (stay on `pos`), else `c.active = false; pos += 1`. Not found:
`openers_bottom[key] = pos - 1`; if `!c.can_open` deactivate; `pos += 1`.

`import_text_format_transformer` (`:342-389`): if `m.full() == text`, transformed = node;
else split: `start == 0` -> `split_text(end)` = `[transformed, after?]`; else
`split_text(start, end)` = `[before, transformed, after?]`. Set transformed text to `m[2]`;
for each format in order, set it if not already set.

`find_outermost_text_match_transformer` (`importTextMatchTransformer.ts:12-76`): for each
text-match transformer with `has_replace()` and `import_reg_exp()`: `m = exec(text)`;
`start = m.index`; `end = get_end_index(..)` (`Default` -> `m.end()`, `Reject` -> skip). The
first found wins; a later one replaces it only if `start < found.start && (end > found.end
|| end <= found.start)`.

`import_found_text_match_transformer` (`:78-110`): split as above (`start == 0` ->
`split_text(end)`, else `split_text(start, end)`, using core `split_text` exactly; a zero-length
match on an empty node splits into `[node]` and `replace` is still called on it, as upstream);
`transformed_new = replace(tx, transformed, &m)`; return
`{before, after, transformed: transformed_new}`.

### 2.7 Export

```rust
/// `$convertToMarkdownString(transformers, node?, shouldPreserveNewLines)` (index.ts:77).
/// Runs on a read view; mid-transaction callers (Macro tables.ts:160,319) pass the
/// transaction's pending state.
pub fn convert_to_markdown_string(state: &EditorState, transformers: &Transformers,
    node: Option<NodeKey>, opts: &MarkdownOptions) -> Result<String>;

/// `$convertSelectionToMarkdownString(transformers, selection, shouldPreserveNewLines)`
/// (index.ts:92). `None` or a collapsed RangeSelection -> "". Always walks the root,
/// never a sub-node.
pub fn convert_selection_to_markdown_string(state: &EditorState, transformers: &Transformers,
    selection: Option<&Selection>, opts: &MarkdownOptions) -> Result<String>;

/// Callback context passed to `export`. Holds the unclosed/unclosable tag stacks that
/// upstream threads through closures.
pub struct ExportCx<'a> { /* state, transformers, opts, selection, tag stacks, mode */ }
impl<'a> ExportCx<'a> {
    pub fn state(&self) -> &EditorState;
    pub fn options(&self) -> &MarkdownOptions;
    /// The `selection` argument of element/multiline `export`; None for whole-doc export.
    pub fn selection(&self) -> Option<&Selection>;
    /// `traverseChildren` / `exportChildren`.
    pub fn export_children(&mut self, element: NodeKey) -> Result<String>;
    /// `exportFormat(textNode, textContent)`; only meaningful inside text-match `export`.
    pub fn export_format(&mut self, text_node: NodeKey, text_content: &str) -> Result<String>;
}

/// One entry of the unclosed/unclosable stacks.
#[derive(Clone, Debug, PartialEq, Eq)]
struct OpenTag { format: Format, tag: String }
```

`ExportCx::export_children` semantics depend on the caller:
- From an element/multiline `export` (whole doc): fresh empty stacks per call
  (`MarkdownExport.ts:355-364`).
- From a text-match `export`: shares the caller's `unclosed` stack (mutations visible) and
  uses `unclosable ++ unclosed` as the new unclosable stack (`:411-426`).
- `export_format` from text-match `export`: shares both stacks (`:427-435`).
- Selection mode: `export_children` is `export_children_for_selection(..).markdown`, and
  `export_format` first slices the text with
  `lexical_rich_nodes::selection::slice_selected_text_node_content(state, selection, text)` (only the
  text is used; formats and siblings come from the original node) (`:242-269`).

Whole-document steps (`MarkdownExport.ts:41-92`):

0. `text_formats` = the registry's text-format transformers with exactly one format
   (`format.len() == 1`), stable-sorted so that those whose format is CODE come last
   (`MarkdownExport.ts:51-60`). `export_text_format` iterates this list, in this order.
1. `children = children(node.unwrap_or(root))`. For each `i`, `r = export_top_level(child)`.
   If `r` is some, push `"\n" + r` when `!should_preserve_new_lines && i > 0 &&
   !is_empty_paragraph(child) && !is_empty_paragraph(children[i-1])`, else `r`. (Uses `i > 0`
   even if the previous child produced nothing.) Join with `"\n"`.
2. `export_top_level(node)` (`:344-385`): each `[...multiline, ...element]` transformer's
   `export` (multiline default returns None); first some wins. Else element ->
   `export_children(node, fresh stacks)`; decorator -> its text content; else None.
3. `export_children(node, unclosed, unclosable)` (`:387-475`), per child:
   text-match transformers in order (first some -> push, next child); else LineBreakNode ->
   `get_state(HARD_LINE_BREAK_STATE) + "\n"`; text-kind (TextNode, TabNode, CodeHighlightNode,
   subclasses) -> `export_text_format(child, text, unclosed, unclosable)`; element -> recurse
   with the same two stacks (unclosable not extended); decorator -> text content. Join with "".
4. `export_text_format(node, text, unclosed, unclosable)` (`:481-597`):
   - Escape unless the node has CODE (`MarkdownExport.ts:499-501`), by prefixing U+005C before each
     unit in the set: preserve-newlines set = {U+002A `*`, U+005F `_`, U+0060 backtick, U+007E `~`};
     default set = the same four plus U+005C backslash. Nothing else is escaped.
   - Hoist whitespace (`/^(\s*)(.*?)(\s*)$/s`): `lead` = maximal leading JS-whitespace run,
     `trail` = maximal trailing run of the rest, `mid` = the middle. All-whitespace ->
     `lead` = everything, `mid = ""`.
   - `prev`/`next` = previous/next sibling if text-kind, else none.
   - Opening: for each `export_text_format` transformer `t` (`fmt = t.format[0]`): if
     `check_has_format(node, fmt)` and `fmt` not yet applied: mark applied; if
     `!check_has_format(prev, fmt)` or no entry in `unclosed` has `t.tag`, push
     `{fmt, tag}` and append `tag` to `opening`. `check_has_format(n, f)` (`:616-627`): false
     unless `n` is text-kind and has `f`; then CODE -> true; text of `n` matches `^\s*$` -> false;
     else true.
   - Closing: for `i` in `0..unclosed.len()`: `nh = has(node, unclosed[i].format)`,
     `xh = has(next, ..)` (`has` = text-kind with the bit, no whitespace rule). Both ->
     continue. Else pop from a copy while `copy.len() > i`: if the popped tag is in
     `unclosable` (by tag string) skip it (the real stack is not popped for it); else
     `!nh` -> append its tag to `close_before`, `else if !xh` -> append to `close_after`;
     then pop the real stack. Then break.
   - All-whitespace `mid` and not CODE -> return `close_before + escaped`.
   - Else `close_before + lead + opening + mid + close_after + trail`.

Selection export (`MarkdownExport.ts:100-342`) has the same shape:
- Top level iterates the root's children with `process_node_for_selection`; include an
  entry iff `should_include` and markdown is some; same newline rule; join `"\n"`.
- `process_node_for_selection` (`:146-211`): `inc = is_selected(node, selection)`. For each
  `[...multiline, ...element]` export (with `cx.selection()` = selection): on some, if
  `!inc` and the node is an element, set `inc` when
  `export_children_for_selection(node).should_include`; return `(result, inc)`. Else element
  -> its children result, `inc || child_inc`; decorator -> `(text, inc)`; else `(None, inc)`.
- `export_children_for_selection` (`:213-342`), per child, `ci = is_selected(child)`:
  text-match exports run first, even for unselected children (their tag-stack mutations
  persist; keep that). On some: if `!ci`, the child is an element, any direct child is
  selected, and `extract_with_child(child, child, selection, "html")` -> `ci = true`; push only
  if `ci`. LineBreak/text/decorator push only if `ci` (text uses the sliced text). Element:
  recurse with the same stacks; include if `ci || sub.should_include` (with the same
  `extract_with_child` upgrade). Result `should_include` = any child pushed.

### 2.8 Shortcuts (model plugin)

Upstream registers an update listener and a `KEY_ENTER_COMMAND` handler
(`MarkdownShortcuts.ts:439-677`). The listener calls `editor.update()` from inside a listener,
which triggers the cascade-guard bug (SCOPE.md §3.3 #2, `notes-bench.md:183`). If that update
is a no-op, `_cascadeCount` never resets, error #343 fires about every 100 keystrokes, and
the shortcut is dropped. Rust has no listeners. The JS view calls these functions after it
commits a text-insertion transaction, and commits the follow-up transaction only when they
return `Ok(true)`. A no-op is dropped without committing, so no cascade counter exists.

```rust
/// What the update listener reads from `{tags, dirtyLeaves, editorState, prevEditorState}`.
pub struct ShortcutTrigger<'a> {
    pub tags: &'a [&'a str],               // update tags of the commit
    pub is_composing: bool,                // editor.isComposing(), supplied by the view
    pub prev_selection: Option<&'a Selection>,
    pub selection: Option<&'a Selection>,  // committed selection
    pub dirty_leaves: &'a std::collections::HashSet<NodeKey>,
}
impl<'a> ShortcutTrigger<'a> {
    /// Fills everything except `is_composing` from the commit.
    pub fn from_commit(commit: &'a Commit, is_composing: bool) -> ShortcutTrigger<'a>;
}

/// Cheap precheck on the committed state, no transaction. Returns the anchor to run on.
pub fn markdown_shortcut_anchor(state: &EditorState, trigger: &ShortcutTrigger<'_>,
    transformers: &Transformers) -> Option<(NodeKey, Utf16Offset)>;

/// Listener body. `tx` is opened on the commit described by `trigger`. Ok(true): the
/// caller commits `tx` with tag "history-push". Ok(false): drop `tx` uncommitted.
pub fn markdown_shortcuts(tx: &mut Transaction, trigger: &ShortcutTrigger<'_>,
    transformers: &Transformers, opts: &MarkdownOptions) -> Result<bool>;

/// KEY_ENTER_COMMAND handler (COMMAND_PRIORITY_LOW). Ok(true): the view calls
/// preventDefault and stops propagation.
pub fn markdown_shortcuts_on_enter(tx: &mut Transaction, shift_key: bool,
    transformers: &Transformers, opts: &MarkdownOptions) -> Result<bool>;
```

`markdown_shortcut_anchor` (`:542-596`), in order; any failure -> `None`:
1. Tags contain `"collaboration"` or `"historic"`.
2. `is_composing`.
3. `comp_end = tags contains "composition-end"`.
4. Both selections must be RangeSelections, `selection` collapsed, and if `!comp_end`
   `selection != prev_selection` (RangeSelection `is`: anchor, focus, format, style equal).
5. `(key, off) = selection.anchor`. Node at `key` must be text-kind, `key` in
   `dirty_leaves`, and if `!comp_end`: not (`off != 1 && off > prev_selection.anchor.offset + 1`)
   (prev offset compared regardless of the prev anchor key).
6. If `comp_end`: the unit at `off - 1` must be in `composition_end_triggers`.

`markdown_shortcuts` (`:598-612`): precheck; then node must satisfy
`can_contain_transformable_markdown`; parent must exist and not be a CodeNode (or subclass);
then `transform(parent, anchor, off)` = `run_element_transformers(all element) ||
run_multiline_element_transformers || run_text_match_transformers ||
run_text_format_transformers`.

`markdown_shortcuts_on_enter` (`:615-675`): false if `shift_key`; selection must be a
collapsed RangeSelection; anchor node text-kind and transformable; parent exists and not
CodeNode; `off == text length`; then `run_multiline_element_transformers(.., enter = true)
|| run_element_transformers(element_for_enter, enter = true)`.

`run_element_transformers(parent, anchor, off, list, enter)` (`:42-94`):
1. False unless `parent`'s parent is root or a shadow root and `parent`'s first child is `anchor`.
2. `text = text(anchor)`. If `!enter` and unit `off - 1` is not U+0020, false.
3. For each transformer: `m = reg_exp().exec(text)` (whole node text). `expected = (enter ||
   m.full() ends with ' ') ? off : off - 1`. If `m.full_len16() == expected`:
   `next = next_siblings(anchor)`; `[leading, remainder?] = split_text(anchor, off)`;
   `siblings = remainder ++ next`; `replace(tx, opts, parent, &siblings, &m, false)`:
   `Handled` -> remove `leading`, return true. On `NotHandled` the split stays and the loop
   continues with the same `anchor` key and the old `text` (keep that).
4. False.

`run_multiline_element_transformers` (`:96-160`): the same gates (1, 2). Skip transformers
whose `reg_exp_end()` is `Required`. `m = reg_exp_start().exec(text)`; `len = (enter ||
ends with ' ') ? off : off - 1`; mismatch -> next. Split as above;
`replace(tx, opts, parent, Some(&siblings), &m, None, None, false)`: `Handled` -> remove
`leading`, true.

`run_text_match_transformers(anchor, off)` (`:162-207`): `c` = unit at `off - 1`; list =
`match_by_trigger[c]`, none -> false. `text = text[..off]` if `off < len`. For each with
`has_replace()`: `m = reg_exp().exec(text)`, none -> next. `start = m.index`, `end = m.end()`.
`start == 0` -> `replace_node = split_text(end)[0]`; else `split_text(start, end)[1]`.
`select_next(replace_node, 0, 0)` (`LexicalNode.ts:1613`: next element -> `select(0,0)`, next
non-text leaf -> parent at its index, next text -> offsets, none -> `parent.select()`). Then
`replace(tx, replace_node, &m)`; return true (its return value is ignored).

`run_text_format_transformers(anchor, off)` (`:209-383`), all on UTF-16 units:
1. `close_end = off - 1`; `close_char = text[close_end]`; list = `format_by_trigger[close_char]`,
   none -> false.
2. For each `t` (`tag`, `tl = len16(tag)`): `close_start = close_end - tl + 1`.
   - `tl > 1` and `text[close_start..close_start+tl] != tag` -> next. (Out-of-range units
     compare as absent and never equal.)
   - `text[close_start - 1] == ' '` -> next.
   - `!t.intraword` and `text[close_end + 1]` exists and is not punctuation-or-space -> next.
   - `open_node = anchor`; `open_start = get_open_tag_start_index(text, close_start, tag)`.
     While `open_start < 0`, walk previous siblings of `open_node`'s position: a LineBreakNode
     stops the walk; a text-kind sibling with CODE is skipped; another text-kind sibling
     becomes `open_node` and `open_start = get_open_tag_start_index(its text, its len, tag)`;
     other nodes (decorators, inline elements) are skipped.
   - `open_start < 0` -> next.
   - Same node and `open_start + tl == close_start` (empty content) -> next.
   - `open_text = text(open_node)`. `open_start > 0 && open_text[open_start - 1] == close_char`
     -> next.
   - `!t.intraword` and `open_text[open_start - 1]` exists and is not punctuation-or-space -> next.
   - `t.format` lacks CODE and `open_text[..open_start]` has an odd number of backticks -> next.
   - Strip the tags, close first: `close_text' = close_text[..close_start] +
     close_text[close_end + 1..]`; set it. Open node text = `close_text'` if same node else
     `open_text`; set `that[..open_start] + that[open_start + tl..]`.
   - `prev = tx.selection()`; set a new RangeSelection with anchor `(open_node, open_start,
     text)` and focus `(anchor, close_end - tl * (same ? 2 : 1) + 1, text)`.
   - For each format in `t.format`: if the selection lacks it, `format_text(format)` (core
     `RangeSelection.formatText`, which splits nodes).
   - Collapse the anchor onto the focus (key, offset, type). For each format, if the
     collapsed selection has it, toggle it off.
   - If `prev` was a RangeSelection, set the new selection's `format = prev.format`.
   - Return true.
3. False.

`get_open_tag_start_index(s, max, tag)` (`:402-421`): for `i` from `max` down to `tl`:
`st = i - tl`; return `st` if `s[st..st+tl] == tag` and `s[st + tl] != ' '`. Else -1.

### 2.9 Regex strategy

Policy:
- Transformer-facing patterns (`reg_exp`, `reg_exp_start`/`end`, `import_reg_exp`) and the
  code-span pattern are `regress` regexes with ECMAScript semantics over UTF-16. They compile
  once into `static LazyLock<RegexMatcher>` values. `Transformers::new` holds `&'static`
  references and compiles nothing per call. User transformers compile their own
  `RegexMatcher` once at construction.
- regress gives JS semantics for everything the sources rely on: `\s` (JS set), ASCII
  `\w \d` (no `u` flag), `.` excludes `\n \r U+2028 U+2029`, `$` = end of input without
  `m`, `[^[\]]` (an unescaped `[` in a class is a literal), negative lookahead, the `s` flag,
  and a lone `{` as a literal (Q16, verified). **Except the `i` flag**, see the next item.
- **regress `i` is not V8's non-unicode `i` (R-1, verified against node 24).** ECMAScript
  non-unicode `Canonicalize(ch)` (ES2024 §22.2.2.7.3) is: `u = toUpperCase(ch)`; if `u` is not
  exactly one code unit return `ch`; if `ch >= U+0080` and `u < U+0080` return `ch`; else `u`.
  regress 0.12.0 folds with Unicode simple case folding instead, so `/s/i` matches U+017F,
  `/[a-z]/i` and `/\w/i` match U+212A and U+017F, and `TAG_START_REGEX` /i accepts `<ſpan>` and
  `<Kbd>` (Kelvin sign). V8 rejects all of these. Markdown import classifies such text
  differently, which changes stored node trees, so this is fixed before M1 by **mitigation M-I**:
  1. Patch regress's non-unicode icase path to use the ECMAScript `Canonicalize` above for both
     literal atoms and class membership (a character matches a class iff some class member has
     the same canonical value). Carry it as a workspace `[patch.crates-io] regress = { path =
     "vendor/regress" }` (R2, M2: the repo's `vendor/` convention, with a `README-MACRO.md` naming the upstream PR) fork pinned to 0.12.0 plus the patch, and send the patch upstream;
     drop the fork once a release contains it. The fork is still regress (decision 5).
  2. The canonical table is generated from the same Unicode version as V8 (node 24, ICU 77),
     checked in as a `const` table, not computed from Rust's `char::to_uppercase` (which tracks a
     different Unicode version).
  3. Conformance test `regex_icase_v8`: for every BMP code unit `c` and for each of the patterns
     `/c/i` (escaped), `/[c]/i`, `/[^c]/i`, `/[a-z]/i`, `/\w/i`, the set of matching units equals
     the set recorded once from node 24 into `tests/fixtures/icase-v8.json`; plus every static `i`
     pattern in §2.9 and §4.2.3 over a corpus containing U+017F, U+212A, U+0130, U+0131, U+1E9E and
     U+03C2 equals recorded V8 results.
  Until the patch lands, no `i` pattern may ship in a Rust path that writes stored JSON.
  Rejected alternative: rewriting each `i` source into explicit case classes at init. It needs a
  regex-source rewriter that handles ranges, negated classes and escapes, which is more code to
  get wrong than the one folding function.
- `RegexMatcher::exec` decodes groups with `String::from_utf16_lossy`, so a group boundary inside a
  surrogate pair (reachable only through non-`u` classes such as `[^x]` over astral text) stores
  U+FFFD where JS stores a lone surrogate (`\udXXX` in JSON). Known deviation, §5.1 (R-5); §6.4
  adds a corpus scan for `\ud[89ab]` escapes in stored text.
- Internal fixed patterns that only count units, classify one unit, or trim are scans.
  Each is exactly equivalent to its pattern, as stated in the table, and each gets a
  unit test against the JS pattern's behaviour.
- Dynamic construction in live code: `ENDS_WITH(re)` and the two CODE fence regexes.
  Neither is built at runtime in Rust (see rows). The tag-escaping construction at
  `MarkdownImport.ts:327-350,360` is dead (see below), so nothing is built from tags.

Live sites (`packages/lexical-markdown/src/`). `md-regex.tsv` was verified complete
against the source. Corrections to `notes-packages.md` §3 are marked **(corr)**.

| Site | JS source | Flags | Rust | Notes |
| --- | --- | --- | --- | --- |
| MarkdownTransformers.ts:221 `ORDERED_LIST_REGEX` | `^(\s*)(\d{1,})\.\s` | | regress static | ORDERED_LIST, normalize |
| :222 `UNORDERED_LIST_REGEX` | `^(\s*)[-*+]\s` | | regress | |
| :223 `CHECK_LIST_REGEX` | `^(\s*)(?:[-*+]\s)?\s?(\[(\s\|x)?\])\s` | i | regress | `[X]` matches; `list_replace` tests `m[3] == "x"`, so it imports unchecked |
| :224 `HEADING_REGEX` | `^(#{1,6})\s` | | regress | |
| :225 `QUOTE_REGEX` | `^>\s` | | regress | |
| :226 `CODE_START_REGEX` | ``^([ \t]*`{3,})([\w-]+)?[ \t]?`` | | regress | `\w` ASCII, as in JS |
| :227 `CODE_END_REGEX` | ``^[ \t]*`{3,}$`` | | regress | |
| :228-229 `CODE_SINGLE_LINE_REGEX` | ``^[ \t]*```[^`]+(?:(?:`{1,2}\|`{4,})[^`]+)*```(?:[^`]\|$)`` | | regress | normalize only |
| :230 `TABLE_ROW_REG_EXP` | `^(?:\|)(.+)(?:\|)\s?$` | | regress | `.` stops at `\r` (lines keep `\r`) |
| :231 `TABLE_ROW_DIVIDER_REG_EXP` | `^(\| ?:?-*:? ?)+\|\s?$` | | regress | |
| :232 `TAG_START_REGEX` | `^<[a-z_][\w-]*(?:\s[^<>]*)?\/?>` | i | regress | |
| :233 `TAG_END_REGEX` | `^<\/[a-z_][\w-]*\s*>` | i | regress | |
| :234-235 `ENDS_WITH(re)` | `` `(?:${re.source})$` `` same flags | i | two regress statics `TAG_START_AT_END`, `TAG_END_AT_END` | upstream rebuilds per line. **(corr)** The sources start with `^`, so these match only a line that is entirely one tag |
| :238 listMarker parse | `^[-*+]$` | | scan | value is exactly `-`, `*` or `+` |
| :244 codeFence parse | ``^`{3,}$`` | | scan | >= 3 units, all backticks |
| :256 hardLineBreak parse | `^(\\\| {2,})$` | | scan | `\` or >= 2 U+0020 |
| :271 hard break split | `^(.*?\S)( {2,})$` | | regress static | keep regex: `.` must not cross `\r`/U+2028/U+2029 |
| :283 `hasNonWhitespaceContentOnLine` | `\S` test | | scan | any non-JS-whitespace unit |
| :311 | `^ {2,}$` | | scan | |
| :352, :353 `getIndent` | `\t` g, ` ` g (`match` counts) | g | scan | counts over the whole `m[1]`, not only leading |
| :468 `$listExport` | `^(\s{0,3}\d+)(\.\s)` -> `'$1\\$2'` | | regress static | single replacement: insert `\` after group 1 |
| :545 CODE export | `` `{3,} `` g, `match` -> array | g | scan | longest backtick run; used only if >= 3 |
| :572 CODE single-line end | `` `{N,}$ `` (N = fence length) | | scan | text ends with a backtick run of length >= N; match = the whole trailing run |
| :592 CODE multiline end | ``^[ \t]*`{N,}$`` | | scan | optional spaces/tabs, then >= N backticks to end; match = whole line |
| :804 LINK title escape | `([\\"])` g -> `'\\$1'` | g | scan | prefix `\` to `\` and `"` |
| :813-814 LINK `importRegExp` | `(?:\[(.+?)\])(?:\((?:([^()\s]+)(?:\s"((?:[^"]*\\")*[^"]*)"\s*)?)\))` | | regress | |
| :815-816 LINK `regExp` | `(?:\[([^[\]]*(?:\[[^[\]]*\][^[\]]*)*)\])(?:\((?:([^()\s]+)(?:\s"((?:[^"]*\\")*[^"]*)"\s*)?)\))$` | | regress | unescaped `[` in class is valid in regress |
| MarkdownImport.ts:337-339 code span | ``(^\|[^\\`])(`)((?:\\`\|[^`])+?)(`)(?!`)`` | | regress static `CODE_SPAN` | negative lookahead. The source does not depend on the tag; enable iff a tag "`" is registered |
| importTextFormatTransformer.ts:45 | `new RegExp(codeRegex.source, 'g')` + `matchAll` | g | `find_all(&CODE_SPAN)` | cannot match empty |
| MarkdownExport.ts:500 | ``([*_`~])`` g -> `'\\$1'` | g | scan | preserve-newlines escape |
| MarkdownExport.ts:501 | ``([*_`~\\])`` g -> `'\\$1'` | g | scan | default escape |
| MarkdownExport.ts:506 | `^(\s*)(.*?)(\s*)$` | s | scan | leading/trailing JS-whitespace runs |
| MarkdownExport.ts:623 | `^\s*$` | | scan | |
| utils.ts:446 `PUNCTUATION_OR_SPACE` | ``[!-/:-@[-`{-~\s]`` | | `is_punctuation_or_space(u16)` | single units only (MarkdownShortcuts.ts:251,319) |
| utils.ts:447 `WHITESPACE` | `\s` | | `is_js_whitespace(u16)` | |
| utils.ts:448 `PUNCTUATION` | ``[!"#$%&'()*+,\-./:;<=>?@[\]^_`{\|}~]`` | | `is_punctuation(u16)` | the same 32 ASCII units as the 446 ranges |
| utils.ts:450 `MARKDOWN_EMPTY_LINE_REG_EXP` | `^\s{0,3}$` | | scan | <= 3 units, all whitespace |
| utils.ts:468 `unescapeText` | ``\\([!-/:-@[-`{-~])`` g -> `'$1'` | g | scan | left to right, non-overlapping |
| utils.ts:469 `unescapeText` | `&#(\d+);` g, function replacer | g | scan | decode rule in 2.6 |

Dead regex construction, not ported:
- `MarkdownImport.ts:327` tag escaper `(\*|\^|\+)`, `:341-344` single-char-tag full match,
  `:347-349` multi-char-tag full match, `:360` `openTagsRegExp`. They are built, but only
  `fullMatchRegExpByTag['`']` is ever read (`importTextFormatTransformer.ts:39`).
  `openTagsRegExp` has no reader. **(corr)** notes §3 calls 341/347 "core of inline-format
  import" and discusses the alternation order of 360. Inline formats come from the
  delimiter scanner (2.6).
- `utils.ts:30-404`: the legacy `allMarkdownCriteria*` autoformat table (`MarkdownFormatKind`,
  `MarkdownCriteria`, 32 regex literals at 72-282, `getAllMarkdownCriteriaForParagraphs/
  TextNodes` at 318-324, `createHeadingExport`, `listExport`, `LIST_INDENT_SIZE`,
  `processNestedLists`, `blockQuoteExport`, `codeBlockExport`). Nothing in the repo
  references it, and `index.ts` does not export it. **(corr)** notes §3 gives 72-323;
  the whole dead block is 30-404.

Other JS string semantics to keep: `split('\n')` only (keep `\r`); `trim*` = JS set;
`endsWith`, `startsWith`, `lastIndexOf` on UTF-16; `str.split('[')` counts in LINK.

### 2.10 Built-in transformers

All are unit structs implementing the traits, exposed as `pub static`. Groups are
functions returning `Vec<Transformer>`, because `Arc` cannot live in a static.

```rust
pub struct Heading;        pub static HEADING: Heading = Heading;
pub struct Quote;          pub static QUOTE: Quote = Quote;
pub struct Code;           pub static CODE: Code = Code;
pub struct UnorderedList;  pub static UNORDERED_LIST: UnorderedList = UnorderedList;
pub struct OrderedList;    pub static ORDERED_LIST: OrderedList = OrderedList;
pub struct CheckList;      pub static CHECK_LIST: CheckList = CheckList;
pub struct Link;           pub static LINK: Link = Link;

use std::borrow::Cow::Borrowed as B;
pub static INLINE_CODE: TextFormatTransformer =
    TextFormatTransformer { format: B(&[Format::CODE]), tag: B("`"), intraword: true };
pub static HIGHLIGHT: TextFormatTransformer =
    TextFormatTransformer { format: B(&[Format::HIGHLIGHT]), tag: B("=="), intraword: true };
pub static BOLD_ITALIC_STAR: TextFormatTransformer =
    TextFormatTransformer { format: B(&[Format::BOLD, Format::ITALIC]), tag: B("***"), intraword: true };
pub static BOLD_ITALIC_UNDERSCORE: TextFormatTransformer =
    TextFormatTransformer { format: B(&[Format::BOLD, Format::ITALIC]), tag: B("___"), intraword: false };
pub static BOLD_STAR: TextFormatTransformer =
    TextFormatTransformer { format: B(&[Format::BOLD]), tag: B("**"), intraword: true };
pub static BOLD_UNDERSCORE: TextFormatTransformer =
    TextFormatTransformer { format: B(&[Format::BOLD]), tag: B("__"), intraword: false };
pub static STRIKETHROUGH: TextFormatTransformer =
    TextFormatTransformer { format: B(&[Format::STRIKETHROUGH]), tag: B("~~"), intraword: true };
pub static ITALIC_STAR: TextFormatTransformer =
    TextFormatTransformer { format: B(&[Format::ITALIC]), tag: B("*"), intraword: true };
pub static ITALIC_UNDERSCORE: TextFormatTransformer =
    TextFormatTransformer { format: B(&[Format::ITALIC]), tag: B("_"), intraword: false };

/// [HEADING, QUOTE, UNORDERED_LIST, ORDERED_LIST]. CHECK_LIST is NOT included upstream.
pub fn element_transformers() -> Vec<Transformer>;
/// [CODE]
pub fn multiline_element_transformers() -> Vec<Transformer>;
/// [INLINE_CODE, BOLD_ITALIC_STAR, BOLD_ITALIC_UNDERSCORE, BOLD_STAR, BOLD_UNDERSCORE,
///  HIGHLIGHT, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH]
pub fn text_format_transformers() -> Vec<Transformer>;
/// [LINK]
pub fn text_match_transformers() -> Vec<Transformer>;
/// element ++ multiline ++ text_format ++ text_match.
pub fn transformers() -> Vec<Transformer>;
/// `TRANSFORMERS`, the upstream default argument, prebuilt.
pub static TRANSFORMERS: std::sync::LazyLock<Transformers>;
```

`create_block_node(create)` (`MarkdownTransformers.ts:334-345`): `node = create(m)`; append
`children` to it; `replace(parent, node, false)`; if `!is_import`, `select(node, 0, 0)`.
Returns `Handled`.

HEADING (`:478-494`, regex `HEADING_REGEX`, `trigger_on_enter`, deps `heading`): export:
HeadingNode -> `"#" * level + " " + children` (level from tag `hN`), else None. Replace:
`create_block_node(HeadingNode(h{len16(m[1])}))`.

QUOTE (`:496-533`, `QUOTE_REGEX`, `trigger_on_enter`, deps `quote`): export: QuoteNode ->
split children markdown on `"\n"`, prefix each line with `"> "`, join `"\n"`. Replace: on
import, if the previous sibling is a QuoteNode, splice `[create_markdown_line_break_node(prev),
...children]` at its end, remove `parent`, `Handled`. Else create a QuoteNode, append
children, replace `parent`, and select (0,0) if not import.

CODE (`:535-692`, multiline, deps `code`, `reg_exp_start` = `CODE_START_REGEX`,
`reg_exp_end` = `Optional(CODE_END_REGEX)`):
- export: CodeNode only. `text = text_content(node)`; `fence = get_state(CODE_FENCE_STATE)`;
  if `text` contains `fence`, and its longest backtick run is >= 3, `fence = "`" * (run + 1)`.
  Return `fence + language.unwrap_or("") + (text non-empty ? "\n" + text : "") + "\n" + fence`.
  Text content includes CodeHighlightNode/TabNode/LineBreak text (core `getTextContent`).
- `handle_import_after_start_match` always returns `Done`, so the default end search never
  runs for CODE. `fence = m[1]`; `n = len16(js_trim(fence))`; `after = line[m.index +
  len16(fence)..]` (includes the language).
  - Single line: `after` ends with a run of >= n backticks. `content = after` before that
    run; `fake = m` with group 2 set to `Some("")`; `replace(.., Some(vec![content]), end =
    that run, ..)`. Returns `Done{true, s}`. Example: ```` ```js x``` ```` becomes code
    `"js x"` with no language.
  - Multiline: first `j > s` whose line is `[ \t]*` then >= n backticks to end. `between =
    lines[s+1..j]`, with `line[len16(m[0])..]` prepended if non-empty. Returns `Done{true, j}`.
  - Endless: `between = lines[s+1..]`, with the same prepend; `end = None`. Returns
    `Done{true, n_lines - 1}`.
- replace: `fence = m[1].map(js_trim).unwrap_or("```")`; `language = m[2]` non-empty or None.
  Import (`children` None, `lines` Some):
  one line -> with end match, code = it; without, strip one leading U+0020;
  several -> if `lines[0]` is all whitespace, drop it, else strip one leading U+0020 from it;
  then pop trailing lines that are exactly empty; code = join `"\n"`. Set `CODE_FENCE_STATE =
  fence`; append `TextNode(code)` (even if empty) to a new CodeNode(language); append the
  CodeNode to `root`. Shortcut (`children` Some):
  `create_block_node(CodeNode(m[2]))(root = paragraph, children, ..)`, with no fence state.
  Code highlighting stays view-only. Import creates a plain TextNode child and never
  CodeHighlightNodes.

`get_indent(ws, list_indent)` (`:351-366`): `count('\t') + floor(count(' ') / list_indent)`,
counting the whole string.

`list_replace(list_type)` (`:368-422`), shared by the three list transformers:
1. `prev`/`next` = siblings of `parent`. `item = ListItemNode(checked = list_type == Check ?
   Some(m[3] == Some("x")) : None)`.
2. `first = first unit of js_trim(m[0])`. `marker = (Bullet|Check) && first in {-,*,+}
   ? Some(first) : None` (the `parse(c) === c` test).
3. `next` is a ListNode of the same type: set `LIST_MARKER_STATE` on it if `marker`; insert
   `item` before its first child (append if it has none); remove `parent`. Else `prev` is a
   ListNode of the same type: set the marker; append `item`; remove `parent`. Else a new
   ListNode(type, start = Number type ? m[2] parsed as JS `Number` : default), set the marker,
   append `item`, replace `parent` with the list.
4. Append `children` to `item`; if `!is_import`, `select(item, 0, 0)`.
5. `indent = get_indent(m[1].unwrap_or(""), opts.list_indent)`; if > 0, call the ListItemNode
   `set_indent` override from `lexical_rich_nodes::list` (`packages/lexical-list/src/LexicalListItemNode.ts:497`),
   which nests the item. Return `Handled`.

`list_export(list, cx, depth, selection)` (`:424-476`): for each ListItemNode child: if it
has exactly one child and that child is a ListNode, recurse with `depth + 1`, push the result
if non-empty, continue (no index increment). With a selection, skip items none of whose
direct children are selected (no index increment). `indent = " " * (depth *
opts.list_indent)`. Prefix: Number -> `"{start + index}. "`; Check -> `"{marker} [x] "` or
`"{marker} [ ] "`; Bullet -> `"{marker} "`, where `marker = get_state(list,
LIST_MARKER_STATE)`. `text = cx.export_children(item)`; for non-Number lists, escape a leading
`^(\s{0,3}\d+)(\.\s)` to `$1\$2`. Push `indent + prefix + text`; `index += 1`. Join `"\n"`.

UNORDERED_LIST / ORDERED_LIST / CHECK_LIST (`:694-731`): deps `list`, `listitem`;
`trigger_on_enter`; regex `UNORDERED_LIST_REGEX` / `ORDERED_LIST_REGEX` / `CHECK_LIST_REGEX`;
replace `list_replace(Bullet | Number | Check)`; export: ListNode ->
`list_export(node, cx, 0, cx.selection())`, else None. All three export every list type. The
first one in registry order wins, which is equivalent because they share the exporter.

LINK (`:794-851`, text match, deps `link`, `trigger` `')'`):
- export: LinkNode but not AutoLinkNode, else None. `text = cx.export_children(node)`;
  `title` with `\` and `"` backslash-escaped; `title` non-empty -> `[text](url "title")`,
  else `[text](url)`. The URL is not escaped.
- replace(node, m): if `node` has a LinkNode ancestor (`$findMatchingParent`, self
  included), `Ok(None)`. `(text, url, title) = (m[1], m[2], m[3])`; url/title through
  `unescape_text`. `open = count('[')`, `close = count(']')` in `text`; `open < close` ->
  `Ok(None)` (the node stays split). `open > close` -> `outside = "[" + part0`,
  `text = parts[1..].join("[")`. Create `LinkNode(url, title)` with a TextNode(text) child
  carrying `node`'s format; replace `node` with the link; if `outside` is non-empty, insert
  an unformatted TextNode(outside) before the link. Return the link's text node.

### 2.11 Public API mapping

| Rust item | Ports | Source (file:line) | Notes |
| --- | --- | --- | --- |
| `convert_from_markdown_string` | `$convertFromMarkdownString` | `packages/lexical-markdown/src/index.ts:57` | options struct replaces 2 bools |
| `convert_to_markdown_string` | `$convertToMarkdownString` | `packages/lexical-markdown/src/index.ts:77` | |
| `convert_selection_to_markdown_string` | `$convertSelectionToMarkdownString` | `packages/lexical-markdown/src/index.ts:92` | |
| `markdown_shortcuts`, `markdown_shortcut_anchor`, `ShortcutTrigger` | `registerMarkdownShortcuts` update listener | `packages/lexical-markdown/src/MarkdownShortcuts.ts:541-614` | no listener; caller commits only on true |
| `markdown_shortcuts_on_enter` | `KEY_ENTER_COMMAND` handler | `packages/lexical-markdown/src/MarkdownShortcuts.ts:615-675` | view does `preventDefault` |
| `Transformers::check_dependencies` | dependency invariant | `packages/lexical-markdown/src/MarkdownShortcuts.ts:470-488` | `Err`, not panic |
| `Transformers::new` | `transformersByType`, `indexBy`, `createTextFormatTransformersIndex`, shortcut indexes | `packages/lexical-markdown/src/utils.ts:406,429`; `packages/lexical-markdown/src/MarkdownImport.ts:317`; `packages/lexical-markdown/src/MarkdownShortcuts.ts:443-468`; `packages/lexical-markdown/src/MarkdownExport.ts:51` | built once |
| `Transformer` | `Transformer` union | `packages/lexical-markdown/src/MarkdownTransformers.ts:55` | enum |
| `ElementTransformer` | `ElementTransformer` | `packages/lexical-markdown/src/MarkdownTransformers.ts:61` | |
| `MultilineElementTransformer`, `RegExpEnd`, `AfterStartMatch` | `MultilineElementTransformer` | `packages/lexical-markdown/src/MarkdownTransformers.ts:99` | |
| `TextFormatTransformer` | `TextFormatTransformer` | `packages/lexical-markdown/src/MarkdownTransformers.ts:170` | struct |
| `TextMatchTransformer`, `EndIndex` | `TextMatchTransformer` | `packages/lexical-markdown/src/MarkdownTransformers.ts:177` | |
| `ReplaceResult` | `boolean \| void` returns | `packages/lexical-markdown/src/MarkdownTransformers.ts:89,166` | |
| `Match`, `Matcher`, `RegexMatcher` | `RegExp`, `RegExpMatchArray` | `packages/lexical-core/transformers/auto-link.ts:15,44` (Macro exec overrides) | |
| `MarkdownOptions` | `LIST_INDENT_SIZE`, `shouldPreserveNewLines`, `shouldMergeAdjacentLines` | `packages/lexical-markdown/src/MarkdownTransformers.ts:349`; `packages/lexical-markdown/src/index.ts:61-62` | replaces Macro patch |
| `LIST_MARKER_STATE` | `listMarkerState` | `packages/lexical-markdown/src/MarkdownTransformers.ts:237` | |
| `CODE_FENCE_STATE` | `codeFenceState` | `packages/lexical-markdown/src/MarkdownTransformers.ts:242` | |
| `HARD_LINE_BREAK_STATE` | `hardLineBreakState` | `packages/lexical-markdown/src/MarkdownTransformers.ts:254` | |
| `parse_markdown_hard_line_break` | `parseMarkdownHardLineBreak` | `packages/lexical-markdown/src/MarkdownTransformers.ts:264` | |
| `create_markdown_line_break_node` | `$createMarkdownLineBreakNode` (+ `hasNonWhitespaceContentOnLine`, `$extractMarkdownHardLineBreakMarker`) | `packages/lexical-markdown/src/MarkdownTransformers.ts:275,290,321` | |
| `normalize_markdown` | `normalizeMarkdown` | `packages/lexical-markdown/src/MarkdownTransformers.ts:888` | |
| `builtin::block::create_block_node` | `createBlockNode` | `packages/lexical-markdown/src/MarkdownTransformers.ts:334` | crate-private |
| `builtin::list::get_indent` | `getIndent` | `packages/lexical-markdown/src/MarkdownTransformers.ts:351` | takes `list_indent` |
| `builtin::list::list_replace` | `listReplace` | `packages/lexical-markdown/src/MarkdownTransformers.ts:368` | |
| `builtin::list::list_export` | `$listExport` | `packages/lexical-markdown/src/MarkdownTransformers.ts:424` | |
| `HEADING` | `HEADING` | `packages/lexical-markdown/src/MarkdownTransformers.ts:478` | |
| `QUOTE` | `QUOTE` | `packages/lexical-markdown/src/MarkdownTransformers.ts:496` | |
| `CODE` | `CODE` | `packages/lexical-markdown/src/MarkdownTransformers.ts:535` | |
| `UNORDERED_LIST` | `UNORDERED_LIST` | `packages/lexical-markdown/src/MarkdownTransformers.ts:694` | |
| `CHECK_LIST` | `CHECK_LIST` | `packages/lexical-markdown/src/MarkdownTransformers.ts:707` | |
| `ORDERED_LIST` | `ORDERED_LIST` | `packages/lexical-markdown/src/MarkdownTransformers.ts:720` | |
| `INLINE_CODE` | `INLINE_CODE` | `packages/lexical-markdown/src/MarkdownTransformers.ts:733` | |
| `HIGHLIGHT` | `HIGHLIGHT` | `packages/lexical-markdown/src/MarkdownTransformers.ts:739` | |
| `BOLD_ITALIC_STAR` | `BOLD_ITALIC_STAR` | `packages/lexical-markdown/src/MarkdownTransformers.ts:745` | |
| `BOLD_ITALIC_UNDERSCORE` | `BOLD_ITALIC_UNDERSCORE` | `packages/lexical-markdown/src/MarkdownTransformers.ts:751` | |
| `BOLD_STAR` | `BOLD_STAR` | `packages/lexical-markdown/src/MarkdownTransformers.ts:758` | |
| `BOLD_UNDERSCORE` | `BOLD_UNDERSCORE` | `packages/lexical-markdown/src/MarkdownTransformers.ts:764` | |
| `STRIKETHROUGH` | `STRIKETHROUGH` | `packages/lexical-markdown/src/MarkdownTransformers.ts:771` | |
| `ITALIC_STAR` | `ITALIC_STAR` | `packages/lexical-markdown/src/MarkdownTransformers.ts:777` | |
| `ITALIC_UNDERSCORE` | `ITALIC_UNDERSCORE` | `packages/lexical-markdown/src/MarkdownTransformers.ts:783` | |
| `LINK` | `LINK` | `packages/lexical-markdown/src/MarkdownTransformers.ts:794` | |
| `element_transformers()` | `ELEMENT_TRANSFORMERS` | `packages/lexical-markdown/src/MarkdownTransformers.ts:853` | |
| `multiline_element_transformers()` | `MULTILINE_ELEMENT_TRANSFORMERS` | `packages/lexical-markdown/src/MarkdownTransformers.ts:860` | |
| `text_format_transformers()` | `TEXT_FORMAT_TRANSFORMERS` | `packages/lexical-markdown/src/MarkdownTransformers.ts:867` | |
| `text_match_transformers()` | `TEXT_MATCH_TRANSFORMERS` | `packages/lexical-markdown/src/MarkdownTransformers.ts:879` | |
| `transformers()`, `TRANSFORMERS` | `TRANSFORMERS` | `packages/lexical-markdown/src/MarkdownTransformers.ts:881` | |
| `import::import_multiline` | `$importMultiline` | `packages/lexical-markdown/src/MarkdownImport.ts:120` | private |
| `import::import_blocks` | `$importBlocks` | `packages/lexical-markdown/src/MarkdownImport.ts:232` | private |
| `import::normalize_tabs` | `$normalizeMarkdownTextNode` | `packages/lexical-markdown/src/MarkdownImport.ts:296` | private |
| `import::text::import_text_transformers` | `importTextTransformers` | `packages/lexical-markdown/src/importTextTransformers.ts:41` | private |
| `import::text::can_contain_transformable_markdown` | `canContainTransformableMarkdown` | `packages/lexical-markdown/src/importTextTransformers.ts:29` | private |
| `import::text_format::find_outermost_text_format_transformer` | `findOutermostTextFormatTransformer` | `packages/lexical-markdown/src/importTextFormatTransformer.ts:25` | private |
| `import::text_format::{scan_delimiters, process_emphasis, can_emphasis, is_flanking}` | same | `packages/lexical-markdown/src/importTextFormatTransformer.ts:125,186,293,316` | private |
| `import::text_format::import_text_format_transformer` | `importTextFormatTransformer` | `packages/lexical-markdown/src/importTextFormatTransformer.ts:342` | private |
| `import::text_match::find_outermost_text_match_transformer` | `findOutermostTextMatchTransformer` | `packages/lexical-markdown/src/importTextMatchTransformer.ts:12` | private |
| `import::text_match::import_found_text_match_transformer` | `importFoundTextMatchTransformer` | `packages/lexical-markdown/src/importTextMatchTransformer.ts:78` | private |
| `export::*` whole-doc path | `createMarkdownExport`, `$exportTopLevelElements`, `$exportChildren`, `$exportLineBreak` | `packages/lexical-markdown/src/MarkdownExport.ts:41,344,387,477` | |
| `export::*` selection path | `createSelectionMarkdownExport`, `$processNodeForSelection`, `$exportChildrenForSelection` | `packages/lexical-markdown/src/MarkdownExport.ts:100,146,213` | |
| `export::export_text_format` | `exportTextFormat`, `getTextSibling`, `hasFormat`, `checkHasFormat` | `packages/lexical-markdown/src/MarkdownExport.ts:481,599,609,616` | |
| `ExportCx` | `traverseChildren` / `exportChildren` / `exportFormat` closures | `packages/lexical-markdown/src/MarkdownExport.ts:355,411,427,242` | |
| `shortcuts::run_element_transformers` | `runElementTransformers` | `packages/lexical-markdown/src/MarkdownShortcuts.ts:42` | |
| `shortcuts::run_multiline_element_transformers` | `runMultilineElementTransformers` | `packages/lexical-markdown/src/MarkdownShortcuts.ts:96` | |
| `shortcuts::run_text_match_transformers` | `runTextMatchTransformers` | `packages/lexical-markdown/src/MarkdownShortcuts.ts:162` | |
| `shortcuts::run_text_format_transformers` | `$runTextFormatTransformers` | `packages/lexical-markdown/src/MarkdownShortcuts.ts:209` | |
| `shortcuts::{is_inside_unclosed_code_span, get_open_tag_start_index, is_equal_sub_string}` | same | `packages/lexical-markdown/src/MarkdownShortcuts.ts:389,402,423` | |
| `util::unescape_text` | `unescapeText` | `packages/lexical-markdown/src/utils.ts:466` | `pub` (LINK, Macro transformers) |
| `util::is_empty_paragraph` | `isEmptyParagraph` | `packages/lexical-markdown/src/utils.ts:452` | `pub` |
| `util::{is_punctuation_or_space, is_js_whitespace, is_punctuation}` | `PUNCTUATION_OR_SPACE`, `WHITESPACE`, `PUNCTUATION` | `packages/lexical-markdown/src/utils.ts:446-448` | `pub` |

External functions this crate calls (owned by other sections): core `split_text`,
`select_next`, `select_start`, `RangeSelection::format_text`/`has_format`/`toggle_format`,
`get_all_text_nodes`, `is_selected`, `ElementNode::extract_with_child`
(`packages/lexical/src/nodes/LexicalElementNode.ts:742`, LinkNode override
`packages/lexical-link/src/LexicalLinkNode.ts:273`);
`lexical_rich_nodes::selection::slice_selected_text_node_content`
(`packages/lexical-selection/src/lexical-node.ts:44`); `lexical_rich_nodes::list` ListItemNode
`set_indent` (`packages/lexical-list/src/LexicalListItemNode.ts:497`).

### 2.12 Not ported

- `packages/lexical-markdown/src/MarkdownShortcuts.ts:540-614` `editor.registerUpdateListener`
  wiring and nested `editor.update()`. Replaced by the caller-driven `markdown_shortcuts`,
  which drops the cascade-count bug (SCOPE.md §3.3 #2) on purpose.
- `packages/lexical-markdown/src/MarkdownShortcuts.ts:615-676` `registerCommand(KEY_ENTER_COMMAND)`,
  `event.shiftKey`, `event.preventDefault()`. These stay in the JS view, which calls
  `markdown_shortcuts_on_enter`.
- `packages/lexical-markdown/src/MarkdownShortcuts.ts:549` `editor.isComposing()`. The view
  supplies it as `ShortcutTrigger::is_composing`.
- `packages/lexical-markdown/src/MarkdownImport.ts:45` `createMarkdownImport` and
  `packages/lexical-markdown/src/MarkdownExport.ts:41,100` `create*MarkdownExport` closure
  factories. Their precomputation moves into `Transformers::new`.
- `packages/lexical-markdown/src/MarkdownImport.ts:327,341-350,360` dead regex construction
  (non-code `fullMatchRegExpByTag`, `openTagsRegExp`).
- `packages/lexical-markdown/src/utils.ts:30-404` the dead legacy `allMarkdownCriteria*` table
  and its exporters (including the dead `LIST_INDENT_SIZE` at `:347`).
- `packages/lexical-markdown/src/utils.ts:406` `indexBy`, generic. Inlined in `Transformers::new`.
- [markdown patch](../../../apps/web/patches/%40lexical%252Fmarkdown%400.45.0.patch). Replaced by `MarkdownOptions::list_indent`;
  delete the patch once the web app uses the Rust crate.
- Upstream `String.fromCodePoint` `RangeError` at `packages/lexical-markdown/src/utils.ts:470`.
  It is deliberately not replicated: the entity is left as text.
- The React `HorizontalRule` markdown transformer (`DEFAULT_TRANSFORMERS = [HR, ...TRANSFORMERS]`,
  regExp `/^(---|\*\*\*|___)\s?$/`, MD-ARR-07, in `@lexical/react`). Not ported: Macro has its own HR
  transformer (§4.2). Upstream HR shortcut and conformance tests (P1) run against Macro's HR
  transformer, or stay Tier B (JS).
## 3. lexical_html (export only)

Scope: `$generateHtmlFromNodes` and everything it reaches (`$appendNodesToHTML`, the
`EditorDOMRenderConfig` export hooks, `html.export` overrides, every registered node's
`exportDOM`, including the `createDOM` code those exports reuse), plus the linkedom
serializer the lexical-service `/html` route depends on. Import (`importDOM`,
`$generateNodesFromDOM`, `DOMImportExtension`) stays in JS.

Crate: `crates/client/lexical/lexical_html`, wasm32-safe, depends on `lexical_model` only
(plus `regress`, `base64`, `ryu-js`). It defines `ExportDom`, the walker, the serializer and the
core-node impls. `lexical_rich_nodes` (feature `html`) and `macro_document_model` (feature `html`)
depend on it and implement `ExportDom` for their own nodes (orphan rule, §0.1). No DOM: export
builds an owned tree and serializes it. The one parser is HtmlRenderNode's (§3.8), in
`macro_document_model`.

### 3.0 Findings that shape the design

Verified by running `services/lexical-service/src/lib/html.ts` under bun against
linkedom 0.18.13 (the version in `bun.lock:3016`).

1. **The serializer target is linkedom, not a browser.** The output differs from Chrome in
   ways the port has to copy:
   - Attributes serialize in **reverse insertion order**. linkedom links each new `Attr`
     right after the element start (`shared/attributes.js` `setAttribute` →
     `knownSiblings(element, attribute, element[NEXT])`). `setAttribute` on an existing name
     updates the value in place and keeps its position.
   - `style` is a `Map`: it serializes as `k:v` pairs joined by `;`, with no spaces and no
     trailing `;`. Setting an existing property keeps its position. The priority argument
     of `setProperty` is ignored. Shorthands are stored as written (`border:1px solid black`).
   - In `text/html` mode, attribute values are **not** entity-escaped: only `"` becomes
     `&quot;` (`interface/attr.js:48`, where `ignoreCase` is true). Text escapes only
     `& < >` and U+00A0, which becomes `&#160;` (`shared/text-escaper.js`).
   - Empty `id`, `class` and `style` attributes are dropped. The other names in
     `emptyAttributes` serialize bare when their value is empty (`contenteditable`).
   - IDL properties that linkedom does not reflect produce **no attribute**: `li.value`,
     `td.colSpan` and `td.rowSpan`. `contentEditable = 'false'` becomes a bare
     `contenteditable`.
   - Tag and attribute names keep their case (`__lexicalListType`, `tabIndex`).
   - Void elements (`/^(?:area|base|br|col|embed|hr|img|input|keygen|link|menuitem|meta|param|source|track|wbr)$/i`)
     serialize as `<br>`.
2. **Production `/html` throws on every list.** `TaskListNode.exportDOM` checks
   `element instanceof HTMLElement` (`packages/lexical-core/nodes/TaskListNode.ts:100`), but
   `withDOM` in `services/lexical-service/src/lib/html.ts:38` installs only `window`,
   `document`, `DOMParser` and `MutationObserver`. lexical-service runs on **Bun on ECS**
   (`services/lexical-service/src/server.ts:41`), not workerd, and Bun has no `HTMLElement`
   global (the html.ts comment about workerd is stale). Verified: `markdownToHtml("- a\n- b\n")`
   throws `ReferenceError: HTMLElement is not defined` under Bun with the real code, so a
   `SendEmail` body containing a list fails. Ruling Q1: **fix**. JS has no output, so the fix is
   provably safe. The Rust port emits what the code intends, and JS is fixed now
   (`typeof HTMLElement !== 'undefined' && element instanceof HTMLElement`, or install it in
   `withDOM`) so shadow mode compares like with like. The corpus generator (3.9) runs the fixed JS.
3. **No theme and no overrides on the `/html` path.** `createHeadlessEditor` passes no
   `theme`, so `theme = {}` (`packages/lexical/src/LexicalEditor.ts:784`). It also passes
   no `html.export` and no `dom`, and there is no post-processing: no inlined CSS and no
   sanitizing. `text` is `$getRoot().getTextContent()`.
4. Sample outputs (theme `{}`). These are the golden seeds for 3.9:
   ```html
   <h1><span style="white-space:pre-wrap">Title</span></h1>
   <p><span style="white-space:pre-wrap">Some </span><b><strong style="white-space:pre-wrap">bold</strong></b>…<i><b><strong style="white-space:pre-wrap">bi</strong></b></i>…<s><span style="white-space:pre-wrap">s</span></s>…<code style="white-space:pre-wrap" spellcheck="false"><span>code</span></code>…<mark style="white-space:pre-wrap"><span>hl</span></mark></p>
   <p><a href="https://macro.com/run?a=1&b=&quot;2&quot;"><span style="white-space:pre-wrap">runbook</span></a></p>
   <table><colgroup><col><col></colgroup><tbody><tr><td style="border:1px solid black;width:75px;vertical-align:top;text-align:start"><p><span style="white-space:pre-wrap">a</span></p></td>…</tr></tbody></table>
   <ul><li><span style="white-space:pre-wrap">two</span><ul><li><span style="white-space:pre-wrap">nested</span></li></ul></li></ul>
   <ul __lexicalListType="check"><li aria-checked="false" tabIndex="-1" role="checkbox"><span style="white-space:pre-wrap">todo</span></li></ul>
   <blockquote><span style="white-space:pre-wrap">quote</span><br><span style="white-space:pre-wrap">line2</span></blockquote><hr><pre data-language="js" spellcheck="false"><span style="white-space:pre-wrap">const x = 1 &lt; 2;</span></pre>
   <div><img alt="alt" data-scale="1" data-image-id="" data-src-type="url" height="0" width="0" src="https://img/x.png"></div>
   <p><div data-lexical-inline="false" data-lexical-equation="eF4y"></div></p>
   ```

### 3.1 Module layout

```
crates/client/lexical/lexical_html/
  src/lib.rs            re-exports; HtmlExporter; generate_html_from_nodes / generate_dom_from_nodes
  src/dom.rs            HtmlNode, HtmlElement, Attr, AttrValue (DOM-like builder)
  src/serialize.rs      linkedom-compatible serializer (inner_html, outer_html)
  src/css.rs            get_style_object_from_css, set_dom_style_from_css, normalize_class_names, uhyphen
  src/theme.rs          EditorTheme and sub-structs (serde, camelCase = upstream EditorThemeClasses)
  src/export.rs         ExportDom trait, DomExportOutput, ExportCtx, AfterFn, AppendFn, CopyDestination
  src/registry.rs       ExportRegistry (+ builder, html.export overrides)
  src/config.rs         DomRenderConfig trait + DefaultDomRenderConfig (= DEFAULT_EDITOR_DOM_CONFIG export subset)
  src/walk.rs           append_nodes_to_html (port of $appendNodesToHTML)
  src/selection.rs      is_selected, slice_selected_text (export-side selection helpers)
  src/js.rs             js_number_to_string (ryu-js), btoa
  src/nodes/mod.rs      element_export_dom (ElementNode.exportDOM), text_create_dom / text_export_dom
  src/nodes/core.rs     impl ExportDom for ParagraphNode, TextNode, TabNode, LineBreakNode
```
Implementations for upstream node crates go behind each crate's `html` feature, because the
orphan rule puts each impl next to its type:
```
crates/client/lexical/lexical_rich_nodes/src/html.rs          HeadingNode, QuoteNode (feature "html")
crates/client/lexical/lexical_rich_nodes/src/list/html.rs     ListNode, ListItemNode
crates/client/lexical/lexical_rich_nodes/src/link/html.rs     LinkNode, AutoLinkNode
crates/client/lexical/lexical_rich_nodes/src/code/html.rs     CodeNode, CodeHighlightNode
crates/client/lexical/lexical_rich_nodes/src/table/html.rs    TableNode, TableRowNode, TableCellNode
crates/client/lexical/lexical_rich_nodes/src/mark/html.rs     MarkNode
crates/client/lexical/macro_document_model/src/html/mod.rs     macro_export_registry(), markdown_to_html
crates/client/lexical/macro_document_model/src/html/nodes.rs   impl ExportDom for the 41 Macro nodes
crates/client/lexical/macro_document_model/src/html/fragment.rs  htmlparser2 10.1.0 port (HtmlRenderNode)
crates/client/lexical/macro_document_model/tests/html_corpus.rs
```

### 3.2 DOM builder (`dom.rs`)

```rust
/// Output tree node. Mirrors the DOM node kinds export can produce.
#[derive(Clone, Debug, PartialEq)]
pub enum HtmlNode {
    Element(HtmlElement),
    Text(String),
    /// DocumentFragment: appending it into a parent splices its children in.
    Fragment(Vec<HtmlNode>),
    /// Pre-serialized markup emitted verbatim. Only `html/fragment.rs` produces it, and only from
    /// its own serializer output, never from stored `__html` directly (§3.8 `html-render`).
    Raw(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct HtmlElement {
    /// Kept verbatim, case-sensitive (linkedom does not lowercase createElement names).
    pub tag: String,
    /// Insertion order. The serializer writes them reversed (linkedom).
    attrs: Vec<Attr>,
    pub children: Vec<HtmlNode>,
    /// Replaces upstream's `data-temporary-table-cell-lexical-key`. Never serialized.
    pub(crate) lexical_key: Option<NodeKey>,
}

#[derive(Clone, Debug, PartialEq)]
struct Attr { name: String, value: AttrValue }

#[derive(Clone, Debug, PartialEq)]
enum AttrValue {
    Plain(String),
    /// DOMTokenList: ordered, deduped, empty tokens skipped. Serialized joined by ' '.
    Class(Vec<String>),
    /// CSSStyleDeclaration map: ordered; set-existing keeps position.
    Style(Vec<(String, String)>),
}

impl HtmlElement {
    pub fn new(tag: impl Into<String>) -> Self;
    /// `setAttribute`. Updates in place when `name` exists, else appends. `name == "class"`
    /// behaves like `className = value`. `name == "style"` stores the raw string (Plain).
    pub fn set_attribute(&mut self, name: &str, value: impl Into<String>);
    pub fn remove_attribute(&mut self, name: &str);
    pub fn get_attribute(&self, name: &str) -> Option<String>;
    /// `classList.add(...tokens)`: creates the `class` attr at first use; tokens are added verbatim
    /// (linkedom does not split or validate), empty tokens skipped, duplicates ignored.
    pub fn class_list_add<'s>(&mut self, tokens: impl IntoIterator<Item = &'s str>);
    /// `className = v`: clear, then add `v.split(/\s+/)`.
    pub fn set_class_name(&mut self, value: &str);
    /// `style.setProperty(name, value)` / `style[camel] = value`. `name` goes through `uhyphen`.
    /// When the existing `style` attr is Plain (set via set_attribute), it is first re-parsed
    /// the linkedom way: split on /\s*;\s*/, key = text before the first ':', both trimmed,
    /// empty keys/values skipped.
    pub fn style_set_property(&mut self, name: &str, value: &str);
    pub fn style_remove_property(&mut self, name: &str);
    /// `textContent = s`: replace children with one Text (none when `s` is empty).
    pub fn set_text_content(&mut self, text: &str);
    pub fn append(&mut self, node: HtmlNode); // Fragment children are spliced
    /// Direct children with `tag` (ASCII case-insensitive), for `:scope > tag` queries.
    pub fn direct_children_mut<'e>(&'e mut self, tag: &'e str) -> impl Iterator<Item = &'e mut HtmlElement> + 'e;
}
```

### 3.3 Serializer (`serialize.rs`): linkedom 0.18.13 `text/html`

```rust
/// `container.innerHTML` for a `<div>` holding `nodes`.
pub fn inner_html(nodes: &[HtmlNode]) -> String;
pub fn outer_html(node: &HtmlNode, out: &mut String);

const LINKEDOM_EMPTY_ATTRIBUTES: [&str; 33] = ["allowfullscreen", "allowpaymentrequest",
    "async", "autofocus", "autoplay", "checked", "class", "contenteditable", "controls",
    "default", "defer", "disabled", "draggable", "formnovalidate", "hidden", "id", "ismap",
    "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open",
    "playsinline", "readonly", "required", "reversed", "selected", "style", "truespeed"];
```
Rules, each copied from linkedom:
- Element: `<` + `tag`, then for each attr **in reverse insertion order**: compute its string
  `s` (below); skip it when `s` is exactly `id`, `class` or `style`; otherwise write `' ' + s`.
  Then: if `tag` matches the void regex, write `>` and ignore children. Otherwise write `>`,
  the children, and `</tag>`. `interface/element.js:439`.
- Attr string: let `v` be the value (Class → tokens joined by `' '`; Style → `k:v` joined by
  `;`). If `name` is in `LINKEDOM_EMPTY_ATTRIBUTES` and `v` is empty, `s = name`. Otherwise
  `s = name="` + `v.replace('"', "&quot;")` + `"`. Nothing else is escaped.
  `interface/attr.js:43`.
- Text: replace `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, U+00A0→`&#160;`. Leave `"` and `'` alone.
- Fragment: the children, concatenated. Raw: verbatim.

### 3.4 CSS and class helpers (`css.rs`, `js.rs`)

```rust
/// Port of getStyleObjectFromCSS: quote-, escape-, comment- and paren-aware `;`/`:` split;
/// keys and values trimmed; empty pairs dropped; a later duplicate key overwrites the earlier
/// one at its first position (JS object semantics).
pub fn get_style_object_from_css(css: &str) -> Vec<(String, String)>;
/// Port of setDOMStyleFromCSS(dom.style, css) with prev = '': for each pair, strip
/// /\s*!important\s*$/i (then trim) and style_set_property. The priority is dropped
/// because linkedom ignores it.
pub fn set_dom_style_from_css(el: &mut HtmlElement, css: &str);
/// Port of normalizeClassNames: every /\S+/ match of every Some(non-empty) input.
pub fn normalize_class_names<'s>(names: impl IntoIterator<Item = Option<&'s str>>) -> Vec<&'s str>;
/// Port of addClassNamesToElement.
pub fn add_class_names(el: &mut HtmlElement, names: &[Option<&str>]);
/// Exact port of uhyphen: replace /(([A-Z0-9])([A-Z0-9][a-z]))|(([a-z0-9]+)([A-Z]))/g with
/// '$2$5-$3$6', then lowercase.
pub fn uhyphen(name: &str) -> String;

/// ECMAScript Number::toString (ryu-js). Use for every `${number}` and `.toString()` on numbers.
pub fn js_number_to_string(n: f64) -> String;
/// `btoa`: standard base64 with padding of the Latin-1 bytes. See EquationNode for chars > U+00FF.
pub fn btoa(s: &str) -> Option<String>;
/// EquationNode attribute (Q7 fix): `btoa(s)` when every UTF-16 unit is <= U+00FF (byte-identical
/// with JS, Latin-1 bytes); otherwise standard padded base64 of the UTF-8 bytes. JS throws in the
/// second case, so any output is safe; the web's `importDOM` `atob` would mojibake it, which is
/// acceptable only because `/html` output goes to email and is never re-imported.
pub fn btoa_or_utf8(s: &str) -> String;
```

### 3.5 Theme (`theme.rs`)

Upstream `createDOM` reads `editor._config.theme`, so exports carry theme classes. The
`/html` path uses `EditorTheme::default()`, which is upstream's `{}`. A web theme JSON
deserializes into the same struct when needed.

```rust
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorTheme {
    pub paragraph: Option<String>,
    pub quote: Option<String>,
    pub heading: HeadingTheme,
    pub link: Option<String>,
    pub code: Option<String>,
    /// highlightType -> class (theme.codeHighlight[type]).
    pub code_highlight: BTreeMap<String, String>,
    pub tab: Option<String>,
    pub mark: Option<String>,
    pub mark_overlap: Option<String>,
    pub table: Option<String>,
    pub table_row: Option<String>,
    pub table_cell: Option<String>,
    pub table_cell_header: Option<String>,
    pub table_row_striping: Option<String>,
    pub table_alignment: Option<TableAlignmentTheme>,
    pub list: Option<ListTheme>,
    pub text: Option<TextTheme>,
    pub search_match: Option<String>,
    /// `theme['inline-search']` (Macro InlineSearchNode).
    #[serde(rename = "inline-search")]
    pub inline_search: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct HeadingTheme { pub h1: Option<String>, pub h2: Option<String>, pub h3: Option<String>,
    pub h4: Option<String>, pub h5: Option<String>, pub h6: Option<String> }
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TableAlignmentTheme { pub center: Option<String>, pub right: Option<String> }
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListTheme {
    pub ul: Option<String>, pub ol: Option<String>,
    pub ul_depth: Vec<String>, pub ol_depth: Vec<String>,
    pub nested: Option<NestedListTheme>, pub checklist: Option<String>,
    pub listitem: Option<String>, pub listitem_checked: Option<String>, pub listitem_unchecked: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct NestedListTheme { pub list: Option<String>, pub listitem: Option<String> }
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TextTheme {
    pub base: Option<String>, pub bold: Option<String>, pub capitalize: Option<String>,
    pub code: Option<String>, pub highlight: Option<String>, pub italic: Option<String>,
    pub lowercase: Option<String>, pub strikethrough: Option<String>, pub subscript: Option<String>,
    pub superscript: Option<String>, pub underline: Option<String>, pub uppercase: Option<String>,
    pub underline_strikethrough: Option<String>,
}
```

### 3.6 Export contract (`export.rs`, `registry.rs`, `config.rs`)

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub use lexical_model::CopyDestination; // (R2) one definition, S1 §2

pub struct ExportCtx<'a> {
    pub state: &'a EditorState,
    pub theme: &'a EditorTheme,
    pub selection: Option<&'a Selection>,
    /// Text of the node being exported after selection slicing; None means unsliced.
    pub(crate) text_override: Option<&'a str>,
}
impl<'a> ExportCtx<'a> {
    /// Text to render for text-kind node `key`: the selection slice when present, else TextData.text.
    pub fn text(&self, key: NodeKey) -> &str;
}

/// Runs after the node and its children are in the parent: `siblings` is the parent's
/// child list and `index` is this node's position. It may replace or remove the node.
pub type AfterFn<'a> = Box<dyn FnOnce(&ExportCtx<'a>, &mut Vec<HtmlNode>, usize) -> Result<()> + 'a>;
/// Upstream `append`: puts the children fragment somewhere other than `element.children`.
pub type AppendFn<'a> = Box<dyn FnOnce(&mut HtmlNode, Vec<HtmlNode>) + 'a>;

pub struct DomExportOutput<'a> {
    /// None = upstream `element: null`: the node and its whole subtree are skipped.
    pub element: Option<HtmlNode>,
    pub after: Option<AfterFn<'a>>,
    pub append: Option<AppendFn<'a>>,
    /// Upstream `$getChildNodes`. None means the element's own children.
    pub children: Option<Vec<NodeKey>>,
}
impl DomExportOutput<'_> {
    pub fn element(el: HtmlElement) -> Self;
    pub fn skip() -> Self;
}

/// Implemented per node type. `Self` holds the node's own fields; base data comes from ctx.state.
pub trait ExportDom: lexical_model::NodeType {
    fn export_dom<'a>(&'a self, ctx: &ExportCtx<'a>, key: NodeKey) -> Result<DomExportOutput<'a>>;
}
```
(R2, R2-1 R2-46) `exclude_from_copy` and `extract_with_child` are S1 `ElementNode` hooks only. The
walker calls `Read::exclude_from_copy(key, Some(CopyDestination::Html))` and
`Read::extract_with_child(key, child, selection, CopyDestination::Html)`; `ExportDom` does not
repeat them.

```rust
pub type ExportFn = for<'a> fn(&ExportCtx<'a>, NodeKey) -> Result<DomExportOutput<'a>>;

pub struct ExportRegistry { /* HashMap<&'static str, Entry>, overrides: HashMap<&'static str, ExportFn> */ }
pub struct ExportRegistryBuilder { /* … */ }
impl ExportRegistry { pub fn builder() -> ExportRegistryBuilder; }
impl ExportRegistryBuilder {
    /// Registers T::TYPE with monomorphized thunks that call T::export_dom,
    /// T::exclude_from_copy and T::extract_with_child.
    pub fn node<T: ExportDom>(self) -> Self;
    /// Upstream `createEditor({html: {export: Map<Klass, fn>}})`
    /// (LexicalEditor.ts:255, :875): replaces T's exportDOM for `node_type`.
    pub fn override_export(self, node_type: &'static str, f: ExportFn) -> Self;
    pub fn build(self) -> ExportRegistry;
}
/// Registers Paragraph, Text, Tab, LineBreak.
pub fn register_core(b: ExportRegistryBuilder) -> ExportRegistryBuilder;
```
Exporting a node whose type is not registered returns `Err(lexical_html::Error::UnregisteredNodeType { type_name })` (R2).
`macro_document_model` has a unit test that every type in its editor registry has an
export entry.

```rust
/// Export subset of EditorDOMRenderConfig (LexicalEditor.ts:279). Defaults equal
/// DEFAULT_EDITOR_DOM_CONFIG (LexicalEditor.ts:748).
pub trait DomRenderConfig {
    /// default: selection.map_or(true, |s| is_selected(state, key, s))
    fn should_include(&self, ctx: &ExportCtx<'_>, key: NodeKey) -> bool;
    /// default: node is element-kind && registry.exclude_from_copy(key, Html)
    fn should_exclude(&self, ctx: &ExportCtx<'_>, reg: &ExportRegistry, key: NodeKey) -> bool;
    /// default: node is element-kind && registry.extract_with_child(key, child, dest)
    fn extract_with_child(&self, ctx: &ExportCtx<'_>, reg: &ExportRegistry, key: NodeKey,
        child: NodeKey, dest: CopyDestination) -> bool;
    /// default: override map by type, else the registered T::export_dom
    fn export_dom<'a>(&self, ctx: &ExportCtx<'a>, reg: &ExportRegistry, key: NodeKey)
        -> Result<DomExportOutput<'a>>;
}
pub struct DefaultDomRenderConfig;

pub struct HtmlExporter<C: DomRenderConfig = DefaultDomRenderConfig> {
    pub registry: ExportRegistry,
    pub theme: EditorTheme,
    pub config: C,
}
impl HtmlExporter {
    pub fn new(registry: ExportRegistry, theme: EditorTheme) -> Self;
}
impl<C: DomRenderConfig> HtmlExporter<C> {
    /// $generateHtmlFromNodes: inner_html of a div holding the exported root children.
    pub fn generate_html_from_nodes(&self, state: &EditorState, selection: Option<&Selection>) -> Result<String>;
    /// $generateDOMFromNodes.
    pub fn generate_dom_from_nodes(&self, state: &EditorState, selection: Option<&Selection>) -> Result<Vec<HtmlNode>>;
}
```

### 3.7 Walker (`walk.rs`): exact `$appendNodesToHTML` (`packages/lexical-html/src/index.ts:258`)

```rust
fn append_nodes_to_html<C: DomRenderConfig>(exp: &HtmlExporter<C>, ctx: &ExportCtx<'_>,
    key: NodeKey, parent: &mut Vec<HtmlNode>) -> Result<bool>;
```
`generate_dom_from_nodes` calls it for each child of the root. The root itself is never
exported. Steps:
1. `include = config.should_include(key)`, then `exclude = config.should_exclude(key)`.
   Both use the original, unsliced node.
2. If `selection.is_some()` and the node is text-kind, set
   `ctx.text_override = slice_selected_text(state, sel, key)` (3.7.1).
3. `out = config.export_dom(ctx', key)`. If `out.element` is `None`, return `Ok(false)`
   without visiting any children.
4. `children = out.children`, or the node's children when it is element-kind, or empty.
5. Make `frag: Vec<HtmlNode>`. For each child, `child_inc = recurse(child, &mut frag)`.
   Then, if `!include && child_inc && config.extract_with_child(key, child, Html)`, set
   `include = true`. Every child is recursed even after `include` turns true.
6. If `include && !exclude`:
   - If `element` is an Element or Fragment, append `frag` with `out.append` when set, else
     into its children. A `Text` element drops `frag`, as upstream does when `isHTMLElement`
     is false.
   - Push `element` into `parent`. A Fragment is spliced in.
   - Then call `out.after(ctx, parent, index)`, but only for a non-Fragment element.
     Upstream's fragment branch (`replaceChildren` on the already-emptied fragment) has no
     effect on the output, and no registered node uses it.
7. Otherwise `parent.extend(frag)`, which hoists the children.
8. Return `include`.

#### 3.7.1 Selection helpers (`selection.rs`)

```rust
/// LexicalNode.isSelected (LexicalNode.ts:696).
pub fn is_selected(state: &EditorState, key: NodeKey, selection: &Selection) -> bool;
/// $sliceSelectedTextNodeContent(selection, node, 'clone') (lexical-selection/src/lexical-node.ts:44).
/// Returns the sliced text, or None when unchanged.
pub fn slice_selected_text(state: &EditorState, selection: &Selection, key: NodeKey) -> Option<String>;
```
`is_selected` port:
- Start with `sel.get_nodes(state)` contains `key`. A text node returns that value.
- For a range selection with both points of type `element`: if collapsed, return false.
- Otherwise, for an inline decorator whose parent is the first point's node (focus if
  backward, else anchor), return false when that point's offset equals the parent's
  children size and the node is the parent's last child.

`slice_selected_text` port:
- Only when `is_selected`, the mode is not token or segmented, and start/end points exist.
- Only when the node is the anchor or focus node. Take
  `(a, f) = state.character_offsets(sel)?` (`Read::character_offsets`, `LexicalSelection.ts:2022`).
  - Same node: slice `[min, max)`.
  - First node (focus if backward, else anchor): slice `[offset, end)`.
  - Last node: slice `[0, offset)`.
- Slice on UTF-16 units. If a boundary splits a surrogate pair, the Rust output has
  U+FFFD where JS would have a lone surrogate.

### 3.8 Per-node export

Shared helpers in `nodes/mod.rs`:

```rust
/// ElementNode.exportDOM tail (LexicalElementNode.ts:611): if indent > 0, set style
/// padding-inline-start: `${indent*40}px` and set_attribute("data-lexical-indent", indent);
/// if direction is Some, set_attribute("dir", "ltr"|"rtl").
pub fn element_export_dom(ctx: &ExportCtx<'_>, key: NodeKey, el: &mut HtmlElement);

/// TextNode.createDOM (LexicalTextNode.ts:505) with prev format 0. Returns the outer element.
pub fn text_create_dom(ctx: &ExportCtx<'_>, key: NodeKey) -> HtmlElement;
/// TextNode.exportDOM (LexicalTextNode.ts:661). `create` is the subclass createDOM result;
/// subclasses pass text_create_dom output plus their own additions.
pub fn text_export_dom(ctx: &ExportCtx<'_>, key: NodeKey, create: HtmlElement) -> HtmlNode;
pub fn element_format_str(f: ElementFormat) -> Option<&'static str>; // left,start,center,right,end,justify
```
`text_create_dom`, in this order:
1. `outer`: `code` if CODE, else `mark` if HIGHLIGHT, else `sub` if SUBSCRIPT, else `sup`
   if SUPERSCRIPT, else none.
2. `inner`: `strong` if BOLD, else `em` if ITALIC, else `span`.
3. `dom = outer ?? inner`. If CODE, `dom.set_attribute("spellcheck","false")`.
4. If there is an outer tag, create the inner element and append it to `dom`.
5. The inner element gets the Text `ctx.text(key)`, even when empty.
6. Theme classes go on the inner element (`setTextThemeClassNames`,
   `LexicalTextNode.ts:138`, with prev = 0): first `text.base`. Then, if
   UNDERLINE && STRIKETHROUGH and `text.underlineStrikethrough` is set, add it and remember
   that. Then walk `[bold, capitalize, code, highlight, italic, lowercase, strikethrough,
   subscript, superscript, underline, uppercase]` (`LexicalConstants.ts:101` order). For
   each flag that is set and has a class, add the class, except underline and strikethrough
   once underlineStrikethrough was added.
7. If `TextData.style` is not empty, `set_dom_style_from_css(dom, style)`.

`text_export_dom`, in this order:
1. Set style `white-space: pre-wrap`.
2. `text-transform`: lowercase, else uppercase, else capitalize (first set flag).
3. Wrap the element with `b` if BOLD, then `i` if ITALIC, then `s` if STRIKETHROUGH, then
   `u` if UNDERLINE. Each wrap becomes the new outermost element: `<u><s><i><b>…`.

| Node (TYPE) | export output (theme `{}` unless noted) |
| --- | --- |
| `paragraph` | `p` + theme.paragraph; element_export_dom; `<br>` child if no children; style `text-align` if format set |
| `text` | `text_export_dom(text_create_dom)` |
| `tab` | text_create_dom + theme.tab on outer; then text_export_dom (text is `\t`) |
| `linebreak` | `br` (LexicalNode.exportDOM = createDOM) |
| `heading` | `h1`..`h6` + theme.heading[tag]; element_export_dom; `<br>` if empty; text-align; `dir` (set again, same position) |
| `quote` | `blockquote` + theme.quote; same tail as heading |
| `list` / `task-list` | `ul`/`ol`; `start` if != 1; list theme classes (`$setListThemeClassNames`, `LexicalListNode.ts:233`, add-only; depth from `lexical_list::get_list_depth`); `start` again; `__lexicalListType="check"` for check lists. **No** element_export_dom. TaskListNode's `.mdtl-bar-mount` child is created and then removed, so it never appears. `extract_with_child` = child is listitem |
| `listitem` | `li`. If parent is a check list and the first child is not a list: `role="checkbox"`, `tabIndex="-1"`, `aria-checked`. **No `value` attr** (linkedom does not reflect `li.value`). Theme classes (`LexicalListItemNode.ts:557`); `set_dom_style_from_css(ElementData.style)`; for each textStyle pair `style_set_property("--listitem-marker-"+k, v)` with `!important` **kept** in v (raw setProperty, no strip); text-align; dir. No element_export_dom. If nested (first child is a ListNode): `after` = if the previous element sibling is `li`, move this li's children into it and remove this li. `extract_with_child`: range selection whose anchor and focus are both inside this node and whose text length equals this node's text length |
| `link` | `a`; `href = lexical_link::sanitize_url(url)` (formatUrl, then `url` crate parse; protocol not in {http:,https:,mailto:,sms:,tel:} → `about:blank`; parse error → formatted url); `target`, `rel`, `title` when truthy; theme.link; element_export_dom. `extract_with_child`: range selection, anchor and focus inside, selection text non-empty |
| `autolink` | `span` (no attrs) when isUnlinked, else as `link`; element_export_dom |
| `code` / `custom-code` | `pre` + theme.code; `spellcheck="false"`; `data-language` if language; never `data-highlight-language` (isSyntaxHighlightSupported is view-only, so always false); `data-theme` if theme; `set_dom_style_from_css(ElementData.style)`. No element_export_dom. CustomCodeNode's createDOM is unused here |
| `code-highlight` | text_create_dom + theme.codeHighlight[highlightType] on outer; text_export_dom |
| `table` | createDOM: `table`; style from ElementData.style; `colgroup` child with `colCount` `col`s, each `width:${w}px` when colWidths[i] is truthy; theme.table; when rowStriping, theme.tableRowStriping + `data-lexical-row-striping="true"`; tableAlignment classes. Then element_export_dom. Children (rows) are appended after colgroup (export does not use getDOMSlot). `after`: alignment classes again; table map = `lexical_table::compute_table_map_skip_cell_check(state, key)`; first occurrence of each cell key gives (startColumn, colSpan); known columns come from direct `tr > cell` children whose `lexical_key` is in the map (key is removed from map once used), and those keys are cleared; keep only colgroup `col`s at known indexes; move all direct `tr` children into a new `tbody` appended last. `extract_with_child` = dest == Html. No scroll wrapper (scrollable tables are never active headless) |
| `tablerow` | `tr`; style `height:${h}px` if height; theme.tableRow; element_export_dom. `extract_with_child` = dest == Html |
| `tablecell` | createDOM: `th` if headerState != NO_STATUS else `td`; style `width` if width truthy; `colspan`/`rowspan` if > 1 (deviation, see below); style `background-color` if set; style `vertical-align` if middle/bottom; theme.tableCell + tableCellHeader for headers. Then element_export_dom; `lexical_key = key`; style `border:1px solid black`; `width:${width \|\| 75}px`; `vertical-align: (verticalAlign \|\| "top")`; `text-align:start`; `background-color:#f2f3f5` if background is null and header |
| `mark` / `comment-mark` / `search-match` | `exclude_from_copy(Html) = true`: element dropped, children hoisted. createDOM is irrelevant. `extract_with_child(Html) = false` |

Colspan and rowspan: linkedom drops `td.colSpan`, but markdown never produces merged
cells, so the corpus is unaffected and Rust emits the correct `colspan="n"`/`rowspan="n"`.
`li.value` does appear on every markdown list, so Rust drops it to match linkedom.

Macro nodes (`packages/lexical-core/nodes/*.ts`). Notation used below:
- "attrs(*)" means getDataAttrs entries in object-literal order, each set with
  `set_attribute`.
- "if v": falsy values skipped. "toString": every entry set, booleans as `true`/`false`.
- JSON values use a JS-compatible `JSON.stringify`: key order as stored, JS number
  formatting, JS escaping. `serde_json` writes `1.0` and is not enough.
- Numbers use `js_number_to_string`.

| Node (TYPE) | Base | export output |
| --- | --- | --- |
| `account-manager-request` | Decorator | `span` `data-account-manager-request=grantId`, text `Account manager request` |
| `agent-activity` | Decorator | `div` `data-agent-activity=agentSessionId`, text = rows mapped to `label` or `label detail`, joined `\n` |
| `agent-context` | Decorator | skip (element null) |
| `agent-session-mention` | Decorator | `div` if expanded else `span`; attrs(if v): data-agent-session-mention=true, -id, -label, data-mention-uuid, data-agent-session-expanded (only when expanded); text `label \|\| "Agent session"` |
| `await` | Decorator | skip |
| `booking-link-mention` | Decorator | `span`; attrs(if v): data-booking-link-mention, data-booking-profile-id, -slug, -label, -url; text `label \|\| slug \|\| "Booking link"` |
| `classed-block` | Element | `<tag>` (verbatim); `data-classed-block="true"`; `class_list_add` each class (verbatim tokens); then each `attributes` entry via set_attribute in stored order (JS object order: integer-like keys first; a `class` key replaces the class list). No element_export_dom |
| `completion` | Element | skip (subtree dropped) |
| `connect-app` | Decorator | `span` `data-connect-app=appSlug`, text `Connect {name}` |
| `contact-mention` | Decorator | `span`; attrs(toString): data-contact-mention=true, -contact-id, data-name, data-email-or-domain, data-is-company, data-mention-uuid; text `format_display_name()` |
| `cursor-system-notification` | Decorator | `div` `data-system-notification=source`, text = text |
| `database-query` | Decorator | `span` if displayMode == "scalar" else `div`; `data-database-query="true"`; text `title \|\| prompt \|\| "Database answer"` |
| `date-mention` | Decorator | `span`; attrs(toString): data-date-mention, data-date, data-display-format, data-mention-uuid; text displayFormat |
| `diff` | Element | createDOMWithFactory fallback (no factory headless): `div`, class `md-diff`, `data-diff-user-id`, `data-diff-label`; element_export_dom |
| `diff-delete` | Element | `div` class `md-diff-delete`; element_export_dom |
| `diff-insert` | Decorator | empty `div` |
| `diff-text` | Text | text_create_dom; then `class_list_add("diff-"+status)` on outer, `data-diff-status`, `data-diff-author` if set; text_export_dom |
| `document-card` | DecoratorBlock | `div`; attrs(if v): data-document-card, -document-id, -document-name, data-block-name, data-block-params (JSON), data-preview-box (JSON), data-preview-data (JSON, `{}` default), data-mention-uuid. No text |
| `document-mention` | Decorator | `span`; attrs(if v): data-document-mention, -document-id, -document-name, data-block-name, data-block-params (JSON), data-mention-uuid, data-channel-type, data-created-at (number), data-collapsed; text documentName |
| `equation` | Decorator | `span` if inline else `div`; `data-lexical-equation=btoa_or_utf8(equation)` (§3.4: Latin-1 bytes when every unit <= U+00FF, else UTF-8 bytes; JS throws in the second case), `data-lexical-inline="true"\|"false"` |
| `group-mention` | Decorator | `span`; attrs(toString): data-group-mention, data-group-alias; text `@{alias}` |
| `horizontalrule` | DecoratorBlock | `hr` |
| `html-render` | DecoratorBlock | `div` `data-html-render="true"`, class `macro_html_render` (+ ` macro_html_render_adapt`); child `template` `shadowrootmode="open"` whose content is `__html` **parsed and re-serialized**, as `template.innerHTML = html` does in linkedom (`HtmlRenderNode.ts:143-145`): `html/fragment.rs` ports htmlparser2 10.1.0's `Tokenizer` + `Parser` tree rules (implied end tags, void elements, close tags with no open element ignored) as linkedom 0.18.13 drives them into the template's content fragment, then serializes with §3.3. So unbalanced tags are balanced inside the template and a literal `</template>` cannot break out of it. Emitting `__html` raw is forbidden. html5ever is not used: its HTML5 tree builder differs from htmlparser2, so it would not be byte-identical |
| `image` | Media | Media output + `alt` on the `img` (set last, so it serializes first) |
| `video` | Media | Media output + `controls="true"\|"false"` on the `video` |
| (Media base) | DecoratorBlock | wrapper `div` > `img`/`video` with `src`, `width`, `height` (calculateEffectiveDimensions; `Math.round` of positive numbers equals `f64::round`), `data-src-type`, `data-{image\|video}-id`, `data-scale`, `data-constrained-width`/`-height` when set |
| `inline-search` | Text | text_create_dom; then `set_class_name(theme.inline_search.unwrap_or("undefined"))` on outer, which replaces the text theme classes (JS assigns `undefined`); text_export_dom |
| `magic-chip` | Decorator | `div` `data-magic-chip=agentSessionId`, text status |
| `paste` | DecoratorBlock | `div`; attrs(if v): data-paste-node, data-content, data-paste-origin; text content |
| `pr-mention` | Decorator | `span`; attrs(if v): data-pr-mention, data-pr-id, -label, data-mention-uuid, data-pr-url; text `label \|\| "Pull request"` |
| `reply-target` | Decorator | `div` `data-reply-target-node=targetMessageId`, text displayText |
| `snapshot` | Decorator | `span`; attrs(if v): data-snapshot-node, data-document-id, -name, data-block-name, data-content, data-snapshot-date, data-mention-uuid; text documentName |
| `tag-mention` | Decorator | `span` data-tag-mention=true, data-tag-option-id, data-tag-property-definition-id, data-tag-name, data-tag-scope, data-tag-color (if set); text name |
| `theme-mention` | Decorator | `span` data-theme-mention=true, data-theme-json=JSON(data); text name |
| `unknown-mention` | Decorator | `div` data-unknown-mention=true, data-name |
| `unlinked-text` | Text | as `text` |
| `user-mention` | Decorator | `span`; attrs(toString): data-user-mention, data-user-id, data-email, data-display-name, data-mention-uuid; text `@{displayName}` or empty |
| `watermark` | Decorator | `span`; attrs(toString): data-watermark, data-content; then class `macro-watermark-node`; text content |

### 3.9 `markdown_to_html` in `macro_document_model` (replaces POST `/html`)

```rust
// crates/client/lexical/macro_document_model/src/html/mod.rs
#[derive(Clone, Debug)]
pub struct MarkdownToHtmlOptions {
    /// Macro: list_indent = 2 (replaces the @lexical/markdown patch).
    pub markdown: lexical_markdown::MarkdownOptions,
    /// `/html` parity: EditorTheme::default() (headless `{}`).
    pub theme: lexical_html::EditorTheme,
}
impl Default for MarkdownToHtmlOptions { fn default() -> Self; }

/// Same shape as lexical_client::RenderedBody.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderedBody { pub html: String, pub text: String }

pub fn macro_export_registry() -> lexical_html::ExportRegistry;

/// Port of services/lexical-service/src/lib/html.ts markdownToHtml.
pub fn markdown_to_html(md: &str, opts: &MarkdownToHtmlOptions) -> Result<RenderedBody>;
```
Steps:
1. Build the Macro editor with `headless_editor()` (§4.0): SupportedNodeTypes plus the
   CodeNode→CustomCodeNode and ListNode→TaskListNode replacements (`lib/html.ts:63`; this route,
   unlike the doc-id export routes, does use replacements).
2. Open a transaction and call `lexical_markdown::convert_from_markdown_string(tx, md,
   &ALL_TRANSFORMERS, None, false, false, &opts.markdown)`, then commit. Any error becomes
   `Err`; upstream `onError` throws.
3. `html = HtmlExporter::new(macro_export_registry(), opts.theme.clone()).generate_html_from_nodes(&state, None)?`.
4. `text = root text content` (ElementNode.getTextContent, blocks joined with `\n\n`).

Caller switch: in `crates/email/src/inbound/toolset.rs:190`, `render_body` calls
`macro_document_model::markdown_to_html(body, &Default::default())`. It is a synchronous
CPU call, so it needs no `.await` or reqwest. Flip it behind the backend config switch
from the migration plan, then delete `lexical_client::markdown_to_html`
(`crates/lexical_client/src/parse_markdown.rs:582`) and `RenderedBody`
(`parse_markdown.rs:49`).

**Byte-exactness acceptance (corpus diff).**
- Generator: `services/lexical-service/scripts/html-corpus.ts`, run with bun. It imports
  `markdownToHtml` from lexical-service **after** the Q1 JS fix (finding 2) has landed; until
  then it installs the linkedom `HTMLElement`, `DocumentFragment`, `Text` and `Node` globals,
  which is the same output. It writes
  `crates/client/lexical/macro_document_model/tests/corpus/html.jsonl`, one
  `{name, markdown, html, text}` or `{name, markdown, error}` per line. Once
  lexical-service is deleted, the file is frozen and checked in.
- Inputs:
  - every markdown fixture string in `packages/lexical-core/markdown-golden.ts` and the
    markdown tests;
  - one sample per row of `md-regex.tsv`;
  - the 3.0 probes;
  - targeted cases: `& < > " '` and NBSP in text, link URLs and titles; tabs; empty
    paragraphs; hard breaks; headings h1..h6 with alignment, indent and dir via
    `PRESERVE_LINES`/HTML transformers; ordered lists starting at != 1; three-deep and
    mixed check lists; tables with empty cells and alignment; fenced code with and without
    a language; unsafe link protocols (`javascript:` → `about:blank`); bare and email
    autolinks; every Macro mention or decorator XML form with `"` and `&` in attribute
    values; images with constrained sizes; equations (Latin-1 only for comparison; non-Latin-1
    cases assert the UTF-8 rule); html-render; classed-block; bullet, numbered and check lists
    (Q1, against the fixed JS).
- Test: `tests/html_corpus.rs` asserts `html` and `text` are byte-equal for every success
  line, and `Err` for every error line.
- Exemptions:
  - None for `html-render`: it is compared byte for byte (Q22). The corpus adds unbalanced
    `<div>`, stray `</template>`, `<script>`, comments, entities and attribute edge cases, and
    `fragment.rs` gets a differential fuzz against linkedom (§6.4).
  - Non-Latin-1 equations are excluded, since JS throws.
- Port `services/lexical-service/src/lib/html.test.ts` cases 1-4 as unit tests. Case 5,
  global restore, does not apply.

### 3.10 Mapping table

| Rust item | Ports | Source (file:line) | Notes |
| --- | --- | --- | --- |
| `HtmlExporter::generate_html_from_nodes` | `$generateHtmlFromNodes` | `packages/lexical-html/src/index.ts:241` | no headless invariant |
| `HtmlExporter::generate_dom_from_nodes` | `$generateDOMFromNodes` | `packages/lexical-html/src/index.ts:180` | RenderContextExport flag dropped |
| `walk::append_nodes_to_html` | `$appendNodesToHTML` | `packages/lexical-html/src/index.ts:258` | 3.7 |
| `DomExportOutput` | `DOMExportOutput` | `packages/lexical/src/LexicalNode.ts:402` | after/append/$getChildNodes |
| `ExportRegistryBuilder::override_export` | `HTMLConfig.export` / `DOMExportOutputMap` | `packages/lexical/src/LexicalEditor.ts:255`, `packages/lexical/src/LexicalNode.ts:397`, `packages/lexical/src/LexicalEditor.ts:875` | keyed by TYPE |
| `DomRenderConfig`, `DefaultDomRenderConfig` | `EditorDOMRenderConfig` export hooks, `DEFAULT_EDITOR_DOM_CONFIG` | `packages/lexical/src/LexicalEditor.ts:279`, `:748` | `$shouldInclude/$shouldExclude/$extractWithChild/$exportDOM` |
| `selection::is_selected` | `LexicalNode.isSelected` | `packages/lexical/src/LexicalNode.ts:696` | |
| `selection::slice_selected_text` | `$sliceSelectedTextNodeContent` | `packages/lexical-selection/src/lexical-node.ts:44` | export-local; lexical_selection may re-export |
| `ExportDom::export_dom` default chain | `LexicalNode.exportDOM` | `packages/lexical/src/LexicalNode.ts:1204` | = createDOM |
| `ExportDom::exclude_from_copy` | `ElementNode.excludeFromCopy` | `packages/lexical/src/nodes/LexicalElementNode.ts:703` | |
| `ExportDom::extract_with_child` | `ElementNode.extractWithChild` | `packages/lexical/src/nodes/LexicalElementNode.ts:742` | |
| `nodes::element_export_dom` | `ElementNode.exportDOM` | `packages/lexical/src/nodes/LexicalElementNode.ts:611` | |
| `ParagraphNode: ExportDom` | `ParagraphNode.createDOM/exportDOM` | `packages/lexical/src/nodes/LexicalParagraphNode.ts:62`, `:88` | |
| `nodes::text_create_dom` | `TextNode.createDOM`, `getElementOuterTag`, `getElementInnerTag`, `$createTextInnerDOM` | `packages/lexical/src/nodes/LexicalTextNode.ts:505`, `:112`, `:128`, `:277` | |
| (in `text_create_dom`) | `setTextThemeClassNames` | `packages/lexical/src/nodes/LexicalTextNode.ts:138` | prev = 0 |
| `nodes::text_export_dom` | `TextNode.exportDOM`, `wrapElementWith` | `packages/lexical/src/nodes/LexicalTextNode.ts:661`, `:295` | |
| `TabNode: ExportDom` | `TabNode.createDOM` | `packages/lexical/src/nodes/LexicalTabNode.ts:46` | |
| `LineBreakNode: ExportDom` | `LineBreakNode.createDOM` | `packages/lexical/src/nodes/LexicalLineBreakNode.ts:46` | |
| `css::get_style_object_from_css` | `getStyleObjectFromCSS` | `packages/lexical/src/utils/setDOMStyle.ts:18` | |
| `css::set_dom_style_from_css` | `setDOMStyleFromCSS`, `setDOMStyleProperty` | `packages/lexical/src/utils/setDOMStyle.ts:182`, `:142` | priority dropped (linkedom) |
| `css::normalize_class_names`, `add_class_names` | `normalizeClassNames`, `addClassNamesToElement` | `packages/lexical/src/utils/classNames.ts:10`, `:32` | |
| (theme lookup) | `getCachedClassNameArray` | `packages/lexical/src/LexicalUtils.ts:1252` | no cache needed |
| `EditorTheme` | `EditorThemeClasses` | `packages/lexical/src/LexicalEditor.ts:147` | subset used by export |
| `HeadingNode: ExportDom` | `HeadingNode.createDOM/exportDOM` | `packages/lexical-rich-text/src/index.ts:260`, `:330` | |
| `QuoteNode: ExportDom` | `QuoteNode.createDOM/exportDOM` | `packages/lexical-rich-text/src/index.ts:144`, `:162` | |
| `ListNode: ExportDom` | `ListNode.createDOM/exportDOM`, `$setListThemeClassNames`, `extractWithChild` | `packages/lexical-list/src/LexicalListNode.ts:126`, `:164`, `:233`, `:218` | |
| `ListItemNode: ExportDom` | `ListItemNode.createDOM/updateListItemDOM/exportDOM`, `applyMarkerStyles`, `$setListItemThemeClassNames`, `updateListItemChecked`, `extractWithChild` | `packages/lexical-list/src/LexicalListItemNode.ts:168`, `:174`, `:213`, `:65`, `:557`, `:613`, `:529` | value not emitted |
| (ListItem after) | `isNestedListNode` | `packages/lexical-list/src/utils.ts:131` | |
| `LinkNode: ExportDom` | `LinkNode.createDOM/updateLinkDOM/extractWithChild` | `packages/lexical-link/src/LexicalLinkNode.ts:123`, `:130`, `:273` | |
| `lexical_link::sanitize_url`, `format_url` | `sanitizeUrl`, `formatUrl` | `packages/lexical-link/src/LexicalLinkNode.ts:184`, `:940` | owned by lexical_link section |
| `AutoLinkNode: ExportDom` | `AutoLinkNode.createDOM` | `packages/lexical-link/src/LexicalLinkNode.ts:528` | |
| `CodeNode: ExportDom` | `CodeNode.exportDOM` | `packages/lexical-code-core/src/CodeNode.ts:185` | attr names `:74-76` |
| `CodeHighlightNode: ExportDom` | `CodeHighlightNode.createDOM`, `getHighlightThemeClass` | `packages/lexical-code-core/src/CodeHighlightNode.ts:82`, `:148` | no tokenizer |
| `TableNode: ExportDom` | `TableNode.createDOM/updateTableElement/exportDOM/extractWithChild`, `updateColgroup`, `setRowStriping`, `alignTableElement` | `packages/lexical-table/src/LexicalTableNode.ts:277`, `:323`, `:374`, `:255`, `:66`, `:87`, `:131` | |
| `TableRowNode: ExportDom` | `TableRowNode.createDOM/extractWithChild` | `packages/lexical-table/src/LexicalTableRowNode.ts:85`, `:97` | |
| `TableCellNode: ExportDom` | `TableCellNode.createDOM/exportDOM`, `getTag`, `isValidVerticalAlign`, `COLUMN_WIDTH` | `packages/lexical-table/src/LexicalTableCellNode.ts:141`, `:169`, `:231`, `:326`; `packages/lexical-table/src/constants.ts:13` | colspan deviation |
| (table after) | `$computeTableMapSkipCellCheck` | `packages/lexical-table/src/LexicalTableUtils.ts:1040` | from lexical_table |
| `MarkNode: ExportDom` | `MarkNode.excludeFromCopy/extractWithChild` | `packages/lexical-mark/src/MarkNode.ts:187`, `:164` | |
| `serialize::inner_html` | linkedom `Element.toString`, `Attr.toString`, `escape` | `node_modules/linkedom/esm/interface/element.js:439`, `interface/attr.js:43`, `shared/text-escaper.js:22` | 0.18.13 |
| `css::uhyphen` | uhyphen | `node_modules/uhyphen/esm/index.js:1` | |
| `markdown_to_html` | `markdownToHtml` | `services/lexical-service/src/lib/html.ts:61` | |
| `RenderedBody` | `RenderedBody`; `lexical_client::RenderedBody` | `services/lexical-service/src/lib/html.ts:27`; `crates/lexical_client/src/parse_markdown.rs:49` | |
| Macro `AccountManagerRequestNode` | exportDOM | `packages/lexical-core/nodes/AccountManagerRequestNode.ts:113` | text const `:24` |
| Macro `AgentActivityNode` | exportDOM, `agentActivityText` | `packages/lexical-core/nodes/AgentActivityNode.ts:206`, `:132` | |
| Macro `AgentContextNode` | exportDOM | `packages/lexical-core/nodes/AgentContextNode.ts:116` | skip |
| Macro `AgentSessionMentionNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/AgentSessionMentionNode.ts:206`, `:196` | |
| Macro `AwaitNode` | exportDOM | `packages/lexical-core/nodes/AwaitNode.ts:131` | skip |
| Macro `BookingLinkMentionNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/BookingLinkMentionNode.ts:191`, `:181` | |
| Macro `ClassedBlockNode` | exportDOM | `packages/lexical-core/nodes/ClassedBlockNode.ts:116` | |
| Macro `CompletionNode` | exportDOM | `packages/lexical-core/nodes/CompletionNode.ts:57` | skip |
| Macro `ConnectAppNode` | exportDOM | `packages/lexical-core/nodes/ConnectAppNode.ts:158` | |
| Macro `ContactMentionNode` | exportDOM, getDataAttrs, formatDisplayName | `packages/lexical-core/nodes/ContactMentionNode.ts:213`, `:130`, `:172` | |
| Macro `CursorSystemNotificationNode` | exportDOM | `packages/lexical-core/nodes/CursorSystemNotificationNode.ts:177` | |
| Macro `DatabaseQueryNode` | exportDOM, createDOM, getTextContent, isInline | `packages/lexical-core/nodes/DatabaseQueryNode.ts:145`, `:134`, `:142`, `:82` | |
| Macro `DateMentionNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/DateMentionNode.ts:158`, `:123` | |
| Macro `DiffNode` | createDOM (via ElementNode.exportDOM) | `packages/lexical-core/nodes/DiffNode.ts:60` | factory fallback |
| Macro `DiffDeleteNode` | createDOM | `packages/lexical-core/nodes/DiffDeleteNode.ts:25` | |
| Macro `DiffInsertNode` | createDOM | `packages/lexical-core/nodes/DiffInsertNode.ts:61` | |
| Macro `DiffTextNode` | createDOM | `packages/lexical-core/nodes/DiffTextNode.ts:42` | |
| Macro `DocumentCardNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/DocumentCardNode.ts:256`, `:243` | |
| Macro `DocumentMentionNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/DocumentMentionNode.ts:217`, `:203` | |
| Macro `EquationNode` | exportDOM | `packages/lexical-core/nodes/EquationNode.ts:87` | btoa |
| Macro `GroupMentionNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/GroupMentionNode.ts:118`, `:89` | |
| Macro `HorizontalRuleNode` | exportDOM | `packages/lexical-core/nodes/HorizontalRuleNode.ts:50` | |
| Macro `HtmlRenderNode` | exportDOM | `packages/lexical-core/nodes/HtmlRenderNode.ts:135` | Raw |
| Macro `ImageNode` | exportDOM | `packages/lexical-core/nodes/ImageNode.ts:131` | |
| Macro `MediaNode` | exportDOM, `calculateEffectiveDimensions` | `packages/lexical-core/nodes/MediaNode.ts:178`; `packages/lexical-core/utils/media.ts:21` | |
| Macro `InlineSearchNode` | createDOM | `packages/lexical-core/nodes/InlineSearchNode.ts:148` | |
| Macro `MagicChipNode` | exportDOM | `packages/lexical-core/nodes/MagicChipNode.ts:176` | |
| Macro `PasteNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/PasteNode.ts:155`, `:147` | |
| Macro `PullRequestMentionNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/PullRequestMentionNode.ts:181`, `:171` | |
| Macro `ReplyTargetNode` | exportDOM | `packages/lexical-core/nodes/ReplyTargetNode.ts:191` | |
| Macro `SnapshotNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/SnapshotNode.ts:187`, `:175` | |
| Macro `TagMentionNode` | exportDOM | `packages/lexical-core/nodes/TagMentionNode.ts:169` | |
| Macro `TaskListNode` | exportDOM, createDOM | `packages/lexical-core/nodes/TaskListNode.ts:95`, `:81` | bar never emitted; fixes ReferenceError |
| Macro `ThemeMentionNode` | exportDOM | `packages/lexical-core/nodes/ThemeMentionNode.ts:129` | |
| Macro `UnknownMentionNode` | exportDOM | `packages/lexical-core/nodes/UnknownMentionNode.ts:114` | |
| Macro `UnlinkedTextNode` | exportDOM | `packages/lexical-core/nodes/UnlinkedTextNode.ts:42` | = TextNode |
| Macro `UserMentionNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/UserMentionNode.ts:188`, `:149` | |
| Macro `VideoNode` | exportDOM | `packages/lexical-core/nodes/VideoNode.ts:133` | |
| Macro `WatermarkNode` | exportDOM, getDataAttrs | `packages/lexical-core/nodes/WatermarkNode.ts:127`, `:96` | |
| Macro `CommentNode`, `SearchMatchNode` | inherit MarkNode exclude | `packages/lexical-core/nodes/CommentNode.ts:153`, `packages/lexical-core/nodes/SearchMatchNode.ts:18` | hoisted |
| Macro `CustomCodeNode` | inherits CodeNode.exportDOM | `packages/lexical-core/nodes/CustomCodeNode.ts:84` | createDOM `:142` unused |

### 3.11 Not ported (stays JS)

- `$generateNodesFromDOM`: `packages/lexical-html/src/index.ts:144`
- `getConversionFunction`: `packages/lexical-html/src/index.ts:342`
- `$createNodesFromDOM`: `packages/lexical-html/src/index.ts:370`
- `wrapContinuousInlines`: `packages/lexical-html/src/index.ts:493`
- `$unwrapArtificialNodes`: `packages/lexical-html/src/index.ts:527`
- `isDomNodeBetweenTwoInlineNodes`: `packages/lexical-html/src/index.ts:548`
- `IGNORE_TAGS`: `packages/lexical-html/src/index.ts:137`
- `$generateDOMFromRoot` (only meaningful with DOMRenderExtension's RootNode export): `packages/lexical-html/src/index.ts:211`
- `DOMImportExtension`: `packages/lexical-html/src/import/DOMImportExtension.ts:123`
- `$generateNodesFromDOMViaExtension`: `packages/lexical-html/src/import/DOMImportExtension.ts:213`
- `CoreImportExtension`: `packages/lexical-html/src/import/CoreImportExtension.ts:23`
- `defineImportRule`: `packages/lexical-html/src/import/defineImportRule.ts:29`
- `parseSelector` (CSS selector import rules): `packages/lexical-html/src/import/parseCss.ts:160`
- the rest of `import/`, all import-only: `compileImportRules.ts`, `coreImportRules.ts`, `defineOverlayRules.ts`, `HorizontalRuleImportExtension.ts`, `ImportContext.ts`, `inlineStylesFromStyleSheets.ts`, `runImport.ts`, `schemas.ts`, `sel.ts`
- `DOMRenderExtension`: `packages/lexical-html/src/DOMRenderExtension.ts:38`
- `domOverride`: `packages/lexical-html/src/domOverride.ts:30`
- `compileDOMRenderConfigOverrides`: `packages/lexical-html/src/compileDOMRenderConfigOverrides.ts:392`
- `DOMRenderRuntimeImpl`: `packages/lexical-html/src/DOMRenderRuntime.ts:161`
- Render context: `createRenderState` (`packages/lexical-html/src/RenderContext.ts:36`), `$getRenderContextValue` (`:84`), `$withRenderContext` (`:162`), `ContextRecord.ts`
- `HTMLConfig.import` and `initializeConversionCache`: `packages/lexical/src/LexicalEditor.ts:257`, `:898`
- `EditorDOMRenderConfig` view hooks `$createDOM`, `$getDOMSlot`, `$decorateDOM`, `$updateDOM`: `packages/lexical/src/LexicalEditor.ts:281-325`
- `static importDOM` on core nodes:
  - LineBreak: `packages/lexical/src/nodes/LexicalLineBreakNode.ts:58`
  - Paragraph: `packages/lexical/src/nodes/LexicalParagraphNode.ts:79`
  - Tab: `packages/lexical/src/nodes/LexicalTabNode.ts:42`
  - Text: `packages/lexical/src/nodes/LexicalTextNode.ts:591`
- Heading, Quote, List, ListItem, Link, Code and Table `importDOM` and their `$convert*Element` functions: in each node file
- Macro node `importDOM`: 34 nodes, `packages/lexical-core/nodes/*.ts`
- Scrollable-table wrapper and frozen rows/columns (never active headless): `packages/lexical-table/src/LexicalTableNode.ts:287-297`, `:101-130`, `:154`
- `data-highlight-language` (view-only highlighter state): `packages/lexical-code-core/src/CodeNode.ts:121`
- TaskListNode bar mount (`.mdtl-bar-mount`), removed again at export: `packages/lexical-core/nodes/TaskListNode.ts:81`
- The browser-flavour serializer: Chrome attribute order, `style` spacing, `li value`, lowercased attribute names. The web composer (`apps/web/src/features/email-compose/primitives/email-composer.ts:795`) keeps using JS `$generateHtmlFromNodes`.
## 4. macro_document_model

Everything `packages/lexical-core` and `services/lexical-service` do headless: the custom nodes,
the Macro transformers, nodeId/peerId, the comment-only gate, the exports (plaintext, search,
cognition, markdown, embedding, comment-mark, XML), Notion import, the composers, mention
extraction, and the route replacements. Server crates call it natively. sync-service links it with
`default-features = false` (gate only). `crates/lexical_client` and `services/lexical-service`
are deleted after M1.

```
crates/client/lexical/macro_document_model/src/
  lib.rs
  editor.rs            presets (EditorType: PlainText, Markdown, MarkdownSync, Chat, Calendar, Title)  §4.1a
  nodes/               the 41 custom nodes                                                       §4.1a, §4.1b
  transformers/        Macro transformers + INTERNAL/EXTERNAL/ALL lists, xml_util, js_json         §4.2
  ids/  peer/          nodeId / peerId                                                            §4.3.1–4.3.2
  comment_gate.rs                                                                                 §4.3.3
  export/              plaintext, search, cognition, markdown, embedding, comment_mark             §4.3.4
  xml/                 XML codec; xml/builder.rs is the one fast-xml-parser port                  §4.3.5, §4.4
  notion/  snapshot.rs markdown/Notion → SerializedEditorState for Loro snapshots                 §4.3.6
  sync.rs              (R2.1) MacroSyncPolicy, synced_json, draft lift/restore commands            §4.3.7
  headless.rs  composers/  mentions/                                                              §4.4
  html/                markdown_to_html, macro_export_registry (uses lexical_html)                §3.9
```

Shared pieces that must exist only once:
- **XML builder:** `xml/builder.rs`, specified in §4.4 and used by `/xml` (§4.3.5) and the
  composers. Where §4.3.5 restates its signatures, the §4.4 text decides.
- **JS-compatible JSON and number writer:** `js_json::to_string` (§4.2, `transformers/xml_util`)
  and `lexical_html::js::js_number_to_string` (§3.4) are one implementation: S1's
  `lexical_model::json::{to_js_json_string, js_number}` (S1 §13.1, §13.5; CR-13), re-exported. It hoists integer-like keys first, as
  JS objects do.
- **Hostname for external links:** the "no `window`" case (§4.2, `E_SNAPSHOT_NODE` and the
  mentions) takes an explicit `host: Option<&str>` argument. See Q8.

### 4.0 Node registries and editor configurations (`editor.rs`)

Which classes and which replacements an editor registers changes stored JSON and gate verdicts
(F2b-8, P3-1), so every Rust entry point names one of these, and nothing else builds a registry:

```rust
/// Classes registered, and whether `NodeReplacements` are applied.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditorConfig {
    /// `createHeadlessEditor({ nodes: SupportedNodeTypes })`, no replacements, no plugins
    /// (`services/lexical-service/src/lib/editor.ts:4-8`). `"code"` stays CodeNode, `"list"` stays
    /// ListNode (CR-17); CustomCodeNode/TaskListNode exist only for JSON typed `custom-code` /
    /// `task-list`.
    Export,
    /// `[...SupportedNodeTypes, ...NodeReplacements]`: `.replace::<CodeNode, CustomCodeNode>(CustomCodeNode::from)` and
    /// `.replace::<ListNode, TaskListNode>(TaskListNode::from)` (`node-list.ts:135`).
    Headless,
    /// Web presets: `RegisteredNodesByType[ty]` plus the `NodeReplacements` whose `replace` and
    /// `withKlass` are both in the preset
    /// (`apps/web/.../LexicalMarkdown/context/LexicalWrapperContext.tsx:92-104`).
    Preset(EditorType),
}
/// Each builds with `Editor::builder(mode)` (S1 §4.2; no default mode): Export and Headless use
/// `EditorMode::Headless`; Preset uses `EditorMode::ViewAttached`. None of them calls
/// `opaque_unknown_types`; a collaborative document session adds `.opaque_unknown_types(true)` to
/// the builder it gets from `preset_builder`/`headless_builder` (S1 D-23 ruling, S7 §2.2).
pub fn export_registry() -> Editor;            // EditorConfig::Export (an Editor owns its Registry)
pub fn headless_editor() -> Editor;            // EditorConfig::Headless (§4.4 headless.rs)
pub fn preset_editor(ty: EditorType) -> Editor; // EditorConfig::Preset
pub fn headless_builder() -> EditorBuilder;    // what headless_editor() builds
pub fn preset_builder(ty: EditorType) -> EditorBuilder; // what preset_editor(ty) builds
```

| EditorType | Classes | Replacements |
| --- | --- | --- |
| `PlainText` | ParagraphNode, TextNode | none (no CodeNode/ListNode) |
| `Title` | ParagraphNode, TextNode, InlineSearchNode | none |
| `Markdown`, `MarkdownSync` | all 57 SupportedNodeTypes | both |
| `Chat` | SupportedNodeTypes − VideoNode | both |
| `Calendar` | SupportedNodeTypes − HtmlRenderNode, ImageNode, VideoNode | both |

Who uses which:

| Config | Callers |
| --- | --- |
| `Export` | comment-only gate (§4.3.3); every doc-id export route and its Rust replacement: `/markdown`, `/search`, `/cognitionv2`, `/comment-mark` (`lib/convsersions.ts:20,40,47,74,165`), and the dropped `/plaintext`, `/cognition` |
| `Headless` | `/html` (`lib/html.ts:63`), composers (`utils/agent-*.ts`, `markdown-mentions.ts:16`), `/snapshot/markdown` (`utils/markdown-state.ts:30,60`), `/snapshot/notion` (`notion-markdown.ts:27`), ai-editing-worker (`session.ts:35`) |
| `Preset(ty)` | the web/wasm editors |
| `Headless` + DiffTextNode | `buildDiffState` (`utils/buildDiffState.ts:29`) |

Consequence the tests pin (§6.3): through `Export`, a stored `"type":"list"` / `"code"` node
round-trips as `list` / `code` in `/search` `rawContent` and `/cognitionv2` `tag`, with no
`previewEnabled` key; through `Headless` the same JSON becomes `task-list` / `custom-code`.

Unknown node types (Q11, S1 D-23): the core's `EditorBuilder::opaque_unknown_types(true)` imports
an unregistered `type` as an opaque framework record that round-trips its JSON verbatim, so
documents written by newer clients survive in Loro and the sync server. S3 defines no node type
for it. Ruling: collaborative document sessions (S7 `EditorSurface`, its comment fork, the
ai-editing-worker's session) turn it on; every route replacement and the comment gate build
through `export_registry()`/`headless_editor()`, which leave it off, so `parse_editor_state`
returns `Err(Error::UnknownSerializedType)` for an unknown type, as JS throws (gate: refuse).
JS never writes such a record, so stored data is unaffected.

### 4.1a Custom nodes (A–D)

Crate `macro_document_model`, module `nodes`. Ports the first 22 files of
`packages/lexical-core/nodes/` (A–D, plus `databaseQueryData.ts` and the abstract
`DecoratorBlockNode`). Macro paths below are relative to the Macro repo root; upstream
paths are relative to the Lexical repo root.

#### Registration facts (from `packages/lexical-core/node-list.ts`)

- `SupportedNodeTypes` (`node-list.ts:75`) lists 57 classes: 16 upstream
  (`ParagraphNode, TextNode, CodeNode, HeadingNode, LinkNode, AutoLinkNode, ListNode, ListItemNode,
  QuoteNode, LineBreakNode, CodeHighlightNode, TabNode, TableNode, TableCellNode, TableRowNode, MarkNode`)
  and **41 custom** classes. That is 41, not 40: `AccountManagerRequestNode` (`node-list.ts:126`) is the new one.
- `DecoratorBlockNode` is abstract. It is not registered.
- `NodeReplacements` (`node-list.ts:135`) has `CodeNode -> CustomCodeNode` (`with: new CustomCodeNode(node.getLanguage())`)
  and `ListNode -> TaskListNode`. Rust registers `.replace::<CodeNode, CustomCodeNode>(CustomCodeNode::from)`. `CodeNode` itself stays
  registered, so a stored `"type":"code"` still parses. Under a registry with replacements (`Headless`, `Preset`),
  `$applyNodeReplacement` turns it into a `custom-code` node; under `Export` (lexical-service's doc-id routes and
  the gate) it stays a CodeNode (§4.0).
- Presets (`RegisteredNodesByType`, `node-list.ts:158`): `plain-text` and `title` contain none of the nodes in this section.
  `markdown`, `markdown-sync`, `chat` (excludes only `VideoNode`) and `calendar` (excludes `HtmlRenderNode, ImageNode,
  VideoNode`) contain **all 21 registered nodes of this section**.

```rust
/// Node sets per editor preset. Mirrors `RegisteredNodesByType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditorType { PlainText, Markdown, MarkdownSync, Chat, Title, Calendar }

/// Registers this section's nodes and transforms for `cfg` (§4.0). Replacements are added only by
/// `EditorConfig::Headless` and `Preset`; `Export` registers CodeNode, CustomCodeNode, ListNode and
/// TaskListNode as four independent classes.
pub fn register_nodes_a_to_d(builder: EditorBuilder, cfg: EditorConfig) -> EditorBuilder;
```

#### Module layout

```
crates/client/lexical/macro_document_model/src/nodes/
  mod.rs                      // re-exports, register_nodes_a_to_d, SearchText, ImportedState
  account_manager_request.rs
  agent_activity.rs
  agent_context.rs
  agent_session_mention.rs    // + transform
  await_node.rs               // `await` is a keyword
  booking_link_mention.rs
  classed_block.rs
  comment.rs                  // + mark-text/context helpers, draft lift/restore/strip
  completion.rs
  connect_app.rs
  contact_mention.rs          // + format_display_name
  cursor_system_notification.rs
  custom_code.rs
  database_query/mod.rs       // node
  database_query/data.rs      // databaseQueryData.ts (Lexical-free, serde only)
  date_mention.rs             // + parse_date_mention_body
  decorator_block.rs          // DecoratorBlockData
  diff.rs                     // DiffNode + accept/reject/delete_at_start
  diff_delete.rs
  diff_insert.rs
  diff_text.rs
  document_card.rs            // + mention<->card conversion
  document_mention.rs
```

#### Cross-cutting rules for these nodes

1. **Key order and framework fields.** For a DecoratorNode, the framework writes `type`, `version`, then `$` (NodeState,
   omitted when empty), then the node's own fields in the order its struct declares them. For an ElementNode the
   order is `children, direction, format, indent, type, version, $, textFormat?, textStyle?`, then the node's
   fields. For a TextNode it is `detail, format, mode, style, text, type, version, $`, then the node's fields.
   Where an `exportJSON` reassigns `type`/`version` after its spread, the key keeps its first position. Each struct
   below declares its fields in the order exportJSON emits them.
2. **`undefined` fields (absent in, absent out).** Every consumer stringifies with `JSON.stringify`, which drops
   keys whose value is `undefined`. A TS field typed `T | undefined` becomes `Option<T>` with
   `#[serde(default, skip_serializing_if = "Option::is_none")]`. Below this is written as `#[opt]`, which stands
   for those two attributes. **The same applies to every field that JS `importJSON` hands to the constructor or a
   setter without a default**, whatever its TS type: JS loads a document missing that key and re-exports it
   without the key, so a required Rust field would fail the whole document instead. These fields are therefore
   `Option<T>` + `#[opt]`, and this list overrides any struct below that shows them as required:
   UserMention `email`; ContactMention `isCompany`, `emailOrDomain`; TagMention `scope`, `name`;
   DocumentMention and DocumentCard `documentName`, `blockName`; DiffText `author` (`DiffTextNode.ts:64-74`);
   DiffInsert `markdown`; Watermark `content`; UnknownMention `name`; GroupMention `groupAlias`;
   AgentActivity `sealed`, `turn`, `segment` (inside the ordered payload map, Q21); AccountManagerRequest
   `grantId`; Snapshot `content`; Media `srcType`, `id`, `url`, `width`, `height` (`MediaNode.ts:213-219`).
   Where JS interpolates such a field into a string (markdown, XML, search text, data attributes), `None` renders
   as the literal `undefined`, as JS `String(undefined)` does; where JS tests it by truthiness, `None` is falsy.
   Before tightening any of these to a required type, the corpus histogram (§6.2) must show the key is never
   absent. A field JS can hold as `null` and re-emits as `null` uses `double_option` (or `Value`), never plain
   `Option` (rule 9 of §0.2).
3. **Numbers.** JS numbers that may be non-integral (`height`, `previewBox` items, `previewData`) use
   `serde_json::Number` or `Value`, so integral values print as `400`, not `400.0`. Integer-only fields
   (`turn`, `segment`, `threadId`, `createdAt`) use `u32`, `i64` or `i64`.
4. **String maps** (`blockParams`, `attributes`) and every pass-through object (`card`, activity rows, the
   GitHub payload, `previewData`) are written in **JS own-property order** (Q18: copy): integer-like keys
   (canonical decimal strings of `0..=2^32-2`) first in ascending numeric order, then the other keys in insertion
   order. The ordered-map writer (`js_json`, CR-13) does this for every map it writes. Input that came from
   `JSON.stringify` is already in that order; the reorder matters for values that come from Loro map order or
   are built by Rust callers.
5. **NodeState (`$`) on import.** Most `importJSON` implementations do not call `updateFromJSON`. They copy only
   `$.id` (via `$applyIdFromSerialized`, `packages/lexical-core/plugins/nodeIdPlugin.ts:72`), and sometimes
   `$.peerId`/`$.sharedPeerIds` (via `$applyPeerIdFromSerialized`, `plugins/peerIdPlugin.ts:94`). They drop every
   other `$` key. Model this per node:

```rust
/// Which `$` NodeState keys survive `importJSON`. The framework applies this after deserialize.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportedState {
    /// `updateFromJSON` path: the whole `$` map.
    Full,
    /// Only `$.id`.
    IdOnly,
    /// `$.id`, `$.peerId` and `$.sharedPeerIds`.
    IdAndPeer,
    /// Nothing; the node starts with empty state.
    None,
}
pub trait ImportPolicy { const IMPORTED_STATE: ImportedState; const IMPORT_ELEMENT_DATA: bool = true; }
```

   `ImportPolicy` / `ImportedState` is the **only** import-policy mechanism for all 41 nodes (§4.1a and §4.1b).
   `Full` keeps every `$` key; `IdOnly` keeps `$.id` when it is a non-empty string; `IdAndPeer` keeps `$.id`,
   `$.peerId` (non-empty strings) and `$.sharedPeerIds` (array); `None` keeps nothing.
   `IMPORT_ELEMENT_DATA = false` marks ElementNodes whose `importJSON` skips `updateFromJSON`. On import they
   lose `format/indent/direction/textFormat/textStyle`, which reset to defaults. Port this bug-compatibly.
   Lowering onto S1 (CR-12, S1 §3.2 `NodeType::import`, §13.1, §7.3): one generic
   `import_with_policy::<T: ImportPolicy>(tx, json)` is each node's `NodeType::import` override. It creates the
   node with replacement from `T::import_json(json)`, then calls `tx.update_from_json_with(key, json,
   JsonImport { state, base_fields: T::IMPORT_ELEMENT_DATA, own_fields: true })` with `state` =
   `Full → StateImportFilter::All`, `IdOnly → Only(&["id"])`, `IdAndPeer → Only(&["id", "peerId",
   "sharedPeerIds"])`, `None → StateImportFilter::None`, and, **for `IdOnly`/`IdAndPeer` only** (R2), finally clears `$.id`/`$.peerId` values that are not
   non-empty strings; `Full` keeps them as imported (the JS truthiness checks of `$applyIdFromSerialized`/`$applyPeerIdFromSerialized`). Do not
   add a second mechanism.
6. **Search text.** `services/lexical-service/src/lib/search-text.ts:13` (`$extractSearchText`) uses
   `getSearchText()` when a node defines it. Otherwise it uses `getTextContent()` for leaves and recurses with
   `"\n\n"` between non-inline element children.

```rust
/// Macro-only text used for the search index. `None` means "use text_content / recurse".
/// The one `SearchText` trait for §4.1a and §4.1b. Import policy is the separate `ImportPolicy`.
pub trait SearchText { fn search_text(&self) -> Option<Cow<'_, str>> { None } }
```

7. **Decorator caches.** `__cachedDecoratorSignature` and `__cachedDecoratorComponent` are view-only. They are not
   ported.
8. **Validation on import.** Use `#[serde(try_from = "Raw")]` / `#[serde(from = "Raw")]` for field-level defaults
   and sanitising. An upstream `throw` in `importJSON` becomes a deserialize `Error`, never a panic.

---

#### AccountManagerRequestNode

```rust
pub const ACCOUNT_MANAGER_REQUEST_TAG: &str = "m-account-manager-request";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AccountManagerRequestNode {
    #[serde(rename = "grantId")] pub grant_id: String,
}
impl AccountManagerRequestNode { pub const TYPE: &'static str = "account-manager-request"; pub const VERSION: u32 = 1; }
impl ImportPolicy for AccountManagerRequestNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for AccountManagerRequestNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> String { "Account manager request".into() }
}
impl SearchText for AccountManagerRequestNode {}
pub fn create_account_manager_request_node(tx: &mut Transaction, grant_id: String) -> Id<AccountManagerRequestNode>;
/// Case-insensitive `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
pub fn is_account_manager_grant_id(value: &str) -> bool;
```
```json
{"type":"account-manager-request","version":1,"$":{"id":"Ab3x"},"grantId":"0b9e…-…"}
```
- DecoratorNode. `importJSON` does not validate `grantId`. The transformer layer calls `is_account_manager_grant_id`.
- Stays in JS: `createDOM` (span with `data-account-manager-request`), `updateDOM`, `decorate`. `importDOM` returns
  null. exportDOM: **Y** (span, textContent `"Account manager request"`).

#### AgentActivityNode

```rust
pub const AGENT_ACTIVITY_NODE_TYPE: &str = "agent-activity";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentActivityStatus { Running, Completed, Failed, Interrupted }

/// One row, stored as the ordered map it arrived as (Q21): rows pass through importJSON verbatim
/// (`AgentActivityNode.ts:176`), so key order, unknown keys and `"card": null` survive byte for byte.
/// A struct with `#[serde(flatten)] extra` cannot keep arrival order, so it is not used.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentActivityRow(pub serde_json::Map<String, serde_json::Value>);
impl AgentActivityRow {
    pub fn id(&self) -> Option<&str>;
    pub fn label(&self) -> Option<&str>;
    pub fn detail(&self) -> Option<&str>;
    pub fn status(&self) -> Option<AgentActivityStatus>;
    /// Absent -> None; `null` -> Some(&Value::Null).
    pub fn card(&self) -> Option<&serde_json::Value>;
    /// Composer constructor: inserts `id, label, status, detail?, card?` in that order, the order
    /// `agent-chat-reply.ts:118-124` and the web use.
    pub fn new(id: String, label: String, status: AgentActivityStatus, detail: Option<String>,
               card: Option<serde_json::Value>) -> Self;
}

/// The payload `__data`, stored as an ordered map (P3-13): `exportComponentProps()` returns
/// `this.__data`, the caller's object, so the top-level key order follows the caller. Own fields
/// are written in the map's order after `type, version, $?`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentActivityNode(pub serde_json::Map<String, serde_json::Value>);
impl AgentActivityNode {
    pub fn agent_session_id(&self) -> Option<&str>;
    pub fn turn(&self) -> Option<u32>;
    pub fn segment(&self) -> Option<u32>;
    pub fn rows(&self) -> Vec<AgentActivityRow>;
    pub fn sealed(&self) -> Option<bool>;
    /// Composer constructor: `agentSessionId, turn, segment, rows, sealed`, the order every
    /// `$createAgentActivityNode` caller builds (to confirm by grep in the M1 PR; §6.3 pins it).
    pub fn new(agent_session_id: String, turn: u32, segment: u32, rows: Vec<AgentActivityRow>,
               sealed: bool) -> Self;
}
impl AgentActivityNode { pub const TYPE: &'static str = AGENT_ACTIVITY_NODE_TYPE; pub const VERSION: u32 = 1; }
impl ImportPolicy for AgentActivityNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for AgentActivityNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { false }
    fn text_content(&self) -> String { String::new() } // steps are not prose
}
impl SearchText for AgentActivityNode {} // falls back to text_content == ""

/// A card this version can show: an object with `kind == "view"` and a `view` key.
pub fn is_agent_activity_card(value: &serde_json::Value) -> bool;
pub fn is_agent_activity_status(value: &serde_json::Value) -> bool;
/// Full payload check: index fields are non-negative integers, rows are well formed, `sealed` is a bool.
/// A row's `card` may be absent, null or any object.
pub fn parse_agent_activity_data(value: &serde_json::Value) -> Option<AgentActivityNode>;
/// One line per row: `"{label} {detail}"` when detail is non-empty, else `label`. Lines joined with '\n'.
pub fn agent_activity_text(rows: &[AgentActivityRow]) -> String;
pub fn create_agent_activity_node(tx: &mut Transaction, data: AgentActivityNode) -> Id<AgentActivityNode>;
```
```json
{"type":"agent-activity","version":1,"agentSessionId":"s1","turn":0,"segment":1,
 "rows":[{"id":"r1","label":"Ran","detail":"ls","status":"completed","card":null}],"sealed":true}
```
- DecoratorNode. `importJSON` does **not** validate (`isAgentActivityData` is used by the transformers). Rust
  deserialize must stay lenient enough to accept what JS accepts. If strict serde rejects a shape, keep `rows` as
  `Vec<Value>`.
- Stays in JS: `createDOM` (div with `data-agent-activity`), `updateDOM`, `decorate` (with signature cache).
  `importDOM` returns null. exportDOM: **Y** (div, textContent `agentActivityText(rows)`).

#### AgentContextNode

```rust
pub const AGENT_CONTEXT_NODE_TYPE: &str = "agent-context";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentContextNode { pub text: String }
impl AgentContextNode { pub const TYPE: &'static str = AGENT_CONTEXT_NODE_TYPE; pub const VERSION: u32 = 1; }
impl ImportPolicy for AgentContextNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for AgentContextNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { false }
    fn text_content(&self) -> String { String::new() }
    fn exclude_from_copy(&self, _destination: CopyDestination) -> bool { true }
}
impl SearchText for AgentContextNode { fn search_text(&self) -> Option<String> { Some(String::new()) } }
/// `version == 1 && text is string`.
pub fn is_agent_context_data(value: &serde_json::Value) -> bool;
pub fn create_agent_context_node(tx: &mut Transaction, text: String) -> Id<AgentContextNode>;
```
```json
{"type":"agent-context","version":1,"$":{"id":"q9"},"text":"private context"}
```
- `version` is part of the payload. `importJSON` throws `invalid agent context data` unless `version === 1` and
  `text` is a string (`AgentContextNode.ts:66`). Rust returns `Err` when `version != 1`.
- Stays in JS: `createDOM` (hidden div), `updateDOM`, `decorate`. `importDOM` returns null. exportDOM: **Y**,
  returning `{element: null}`, so the node is omitted from HTML.

#### AgentSessionMentionNode

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentSessionMentionNode {
    pub id: String,
    #[opt] pub label: Option<String>,
    #[serde(rename = "mentionUuid")] #[opt] pub mention_uuid: Option<String>,
    /// Emitted only when true (`AgentSessionMentionNode.ts:136`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")] pub expanded: bool,
}
impl AgentSessionMentionNode { pub const TYPE: &'static str = "agent-session-mention"; pub const VERSION: u32 = 3; }
impl ImportPolicy for AgentSessionMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for AgentSessionMentionNode {
    fn is_inline(&self) -> bool { !self.expanded }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> String { self.label.clone().filter(|l| !l.is_empty()).unwrap_or_else(|| "Agent session".into()) }
}
impl SearchText for AgentSessionMentionNode { fn search_text(&self) -> Option<String> { Some(self.text_content()) } }

/// `<m-agent-session-mention>{json}</m-agent-session-mention>`. JSON key order is id, label?, mentionUuid?,
/// expanded?, and every '<' is replaced by the 6 chars `<`.
pub fn build_agent_session_mention_markdown(info: &AgentSessionMentionNode) -> String;
pub fn create_agent_session_mention_node(tx: &mut Transaction, info: AgentSessionMentionNode) -> Id<AgentSessionMentionNode>;
pub fn set_agent_session_label(tx: &mut Transaction, id: Id<AgentSessionMentionNode>, label: Option<String>) -> Result<()>;
pub fn set_agent_session_expanded(tx: &mut Transaction, id: Id<AgentSessionMentionNode>, expanded: bool) -> Result<()>;
pub fn set_agent_session_mention_uuid(tx: &mut Transaction, id: Id<AgentSessionMentionNode>, uuid: Option<String>) -> Result<()>;

/// Registered with `.transform::<AgentSessionMentionNode>(agent_session_mention_transform)`.
pub fn agent_session_mention_transform(tx: &mut Transaction, id: Id<AgentSessionMentionNode>) -> Result<()>;
```
```json
{"type":"agent-session-mention","version":3,"id":"sess_1","label":"Fix CI","mentionUuid":"u-1","expanded":true}
```
Transform algorithm (`AgentSessionMentionNode.ts:60-86`). It keeps an expanded card as a direct child of the
root (or shadow root), and keeps a collapsed chip inside a paragraph:
1. If the node has no parent, return.
2. Let `parent` be the node's parent, captured **before** any move.
3. If `expanded` and `parent` is **not** root or shadow root:
   1. Call `lexical_rich_nodes::utils::insert_node_to_nearest_root_at_caret(tx, node, SiblingCaret::new(node, Direction::Previous))`.
      The caret is the position immediately before the node. The util flips it to `next`, removes the node (with
      `preserve_empty_parent`), splits every ancestor at that point up to the nearest root or shadow root, and
      inserts the node there. The node is block, because `is_inline()` is `!expanded`, so it is not wrapped in a
      paragraph.
   2. If the original `parent` was a `ParagraphNode`, look at the node's **new** previous and next siblings, in that
      order. Remove each one that is a `ParagraphNode` and empty (`is_empty()`: zero children). If the parent was
      not a paragraph (for example a list item), no cleanup runs.
4. Else, if `!expanded` and `parent` **is** root or shadow root:
   `paragraph = create(ParagraphNode)`, then `tx.replace(node, paragraph, false)`, then `tx.append(paragraph, node)`.
5. Otherwise do nothing. An expanded card inside a table cell (a shadow root) stays where it is.
- Stays in JS: `createDOM` (div if expanded, else span; `data-agent-session-mention`), `updateDOM` (true when
  `expanded` changes), `decorate`, `importDOM` (div/span/a with `data-agent-session-mention`; reads
  `data-agent-session-id/-label`, `data-mention-uuid`, `data-agent-session-expanded`). `getDataAttrs` feeds
  `lexical_html`. exportDOM: **Y**.

#### AwaitNode

```rust
pub const AWAIT_NODE_TYPE: &str = "await";
pub const AWAIT_ID_LENGTH: usize = 21;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AwaitNode {
    #[serde(rename = "awaitId")] pub await_id: String,
    #[opt] pub text: Option<String>,
    /// Always emitted. Default on import is `true` (`$createAwaitNode`: `inline ?? true`).
    #[serde(default = "default_true")] pub inline: bool,
}
impl AwaitNode { pub const TYPE: &'static str = AWAIT_NODE_TYPE; pub const VERSION: u32 = 1; }
impl ImportPolicy for AwaitNode { const IMPORTED_STATE: ImportedState = ImportedState::IdAndPeer; }
impl DecoratorNode for AwaitNode {
    fn is_inline(&self) -> bool { self.inline }
    fn is_keyboard_selectable(&self) -> bool { false }
    fn text_content(&self) -> String { String::new() }
}
impl SearchText for AwaitNode {}
/// Missing `await_id` -> nanoid(21) (url-safe alphabet), drawn from the editor's RNG.
pub fn create_await_node(tx: &mut Transaction, await_id: Option<String>, text: Option<String>, inline: bool) -> Id<AwaitNode>;
pub fn set_await_text(tx: &mut Transaction, id: Id<AwaitNode>, text: Option<String>) -> Result<()>;
/// `$getLocal(node) ?? true`. Reads the `local` NodeState key (S1 `StateKey<bool>`).
pub fn await_is_local(state: &EditorState, id: Id<AwaitNode>) -> bool;
```
```json
{"type":"await","version":1,"$":{"id":"a1","peerId":"p7"},"awaitId":"V1StGXR8_Z5jdHi6B-myT","text":"Creating task","inline":true}
```
- Missing `awaitId` on import: JS `new AwaitNode(undefined)` generates a nanoid. Rust does the same with
  `#[serde(default = ...)]` from the editor RNG.
- Stays in JS: `createDOM` (span or div, `data-await-id`, class `macro-await-node`, `local` toggle), `updateDOM`,
  `decorate`. `importDOM` returns null. exportDOM: **Y**, returning `{element: null}` (the node is ephemeral).

#### BookingLinkMentionNode

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "RawBookingLinkMention")]
pub struct BookingLinkMentionNode {
    #[serde(rename = "profileId")] pub profile_id: String,
    #[opt] pub slug: Option<String>,
    #[opt] pub label: Option<String>,
    pub url: String,
}
impl BookingLinkMentionNode { pub const TYPE: &'static str = "booking-link-mention"; pub const VERSION: u32 = 1; }
impl ImportPolicy for BookingLinkMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for BookingLinkMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    /// `label || slug || "Booking link"`; empty strings fall through.
    fn text_content(&self) -> String;
}
impl SearchText for BookingLinkMentionNode { fn search_text(&self) -> Option<String> { Some(self.text_content()) } }

/// ECMAScript pattern, run with `regress`:
/// `^https?:\/\/(?:www\.)?(?:macro\.com|localhost:\d+|dev\.macro\.com|staging\.macro\.com)\/app\/book\/([^/?#]+)(?:\/([^/?#]+))?(?:[?#].*)?$`
pub fn is_macro_booking_url(url: &str) -> bool;
/// Groups 1 and 2, each `decodeURIComponent`-ed. A decode failure throws in JS; Rust returns None.
pub fn parse_booking_url(url: &str) -> Option<(String /*profile_id*/, Option<String> /*slug*/)>;
pub fn create_booking_link_mention_node(tx: &mut Transaction, data: BookingLinkMentionNode) -> Id<BookingLinkMentionNode>;
pub fn set_booking_label(tx: &mut Transaction, id: Id<BookingLinkMentionNode>, label: Option<String>) -> Result<()>;
pub fn set_booking_url(tx: &mut Transaction, id: Id<BookingLinkMentionNode>, url: String) -> Result<()>;
```
```json
{"type":"booking-link-mention","version":1,"profileId":"wolf","slug":"30min","label":"Book 30 min","url":"https://macro.com/app/book/wolf/30min"}
```
- Constructor default for `url` (`BookingLinkMentionNode.ts:101`):
  `url || buildBookingUrl(profileId, slug) || "https://macro.com/app/book/" + profileId`.
  `buildBookingUrl` reads `window.location.hostname` and returns undefined when there is no `window`. Rust takes
  the host explicitly (Q9/R-6): the editor config carries `host: Option<String>` (the same one Q8 uses), read in the
  CR-11 load hook, in `create_booking_link_mention_node` and in `after_clone` (CR-16; the JS constructor
  runs on every clone, but only changes an empty url). S1's `after_clone(&self)` has no transaction or
  config access, so the load hook and the create fn copy the host into a `#[serde(skip)] host:
  Option<Arc<str>>` field (excluded from `PartialEq`, never serialized) that `after_clone` reads. With `Some(h)`: `clean = if h == "localhost"
  { "dev.macro.com" } else { h.replacen("www.", "", 1) }`; path `/app/book/{encodeURIComponent(profile_id)}`
  plus `/{encodeURIComponent(slug)}` when the slug is truthy; url `https://{clean}{path}`. With `None` (server
  routes, lexical-service parity): `https://macro.com/app/book/{profile_id}` with **no** encoding and the slug
  ignored. The empty-url test is truthiness (`url || ..`, rule 8). The web wasm editor passes `location.hostname`.
- Stays in JS: `createDOM`, `updateDOM`, `decorate`, `importDOM` (span/a with `data-booking-link-mention`; needs
  `data-booking-profile-id` and `data-booking-url`), `buildBookingUrl` (browser host). exportDOM: **Y**.

#### ClassedBlockNode

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ClassedBlockTag { #[default] Div, P, Span, Blockquote }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "RawClassedBlock")]
pub struct ClassedBlockNode {
    /// Unknown tag on import -> `div` (`ClassedBlockNode.ts:75`).
    pub tag: ClassedBlockTag,
    /// Missing on import -> `[]`.
    pub classes: Vec<String>,
    /// Emitted when present, but **dropped by importJSON** (`ClassedBlockNode.ts:74` does not pass it).
    #[opt] pub attributes: Option<IndexMap<String, String>>,
}
impl ClassedBlockNode { pub const TYPE: &'static str = "classed-block"; pub const VERSION: u32 = 1; }
impl ImportPolicy for ClassedBlockNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = false;
}
impl ElementNode for ClassedBlockNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { true }
}
impl SearchText for ClassedBlockNode {}
pub fn is_allowed_tag_name(name: &str) -> bool; // div | p | span | blockquote
pub fn create_classed_block_node(tx: &mut Transaction, tag: ClassedBlockTag, classes: Vec<String>,
    attributes: Option<IndexMap<String, String>>) -> Id<ClassedBlockNode>;
```
```json
{"children":[],"direction":null,"format":"","indent":0,"type":"classed-block","version":1,
 "tag":"div","classes":["callout"],"attributes":{"data-x":"1"}}
```
- Import is lossy: `attributes` and the ElementData fields are reset (`RawClassedBlock` sets
  `attributes: None`). Port bug-compatibly.
- `getTextContent` is the ElementNode default.
- Stays in JS: `createDOM` (`data-classed-block`, classes, attributes), `updateDOM`, `importDOM` (allowed tags with
  `data-classed-block`). exportDOM: **Y**.

#### CommentNode (extends MarkNode)

Subclass: the struct embeds upstream `lexical_rich_nodes::mark::MarkNode` (`ids`) with `type Parent = MarkNode`
(CR-2). It inherits MarkNode's hooks and overrides only `insert_new_after`.

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CommentNode {
    #[serde(flatten)] pub mark: lexical_rich_nodes::mark::MarkNode, // "ids": [String]; type Parent = MarkNode
    #[serde(rename = "threadId")] #[opt] pub thread_id: Option<i64>,
    /// Always emitted. Missing on import -> false.
    #[serde(rename = "isDraft", default)] pub is_draft: bool,
}
impl CommentNode { pub const TYPE: &'static str = "comment-mark"; pub const VERSION: u32 = 1; }
impl ImportPolicy for CommentNode { const IMPORTED_STATE: ImportedState = ImportedState::Full; } // updateFromJSON path
impl ElementNode for CommentNode {
    // Inherited from MarkNode through `Parent` (packages/lexical-mark/src/MarkNode.ts:148-189):
    // can_insert_text_before/after = false, can_be_empty = false, is_inline = true,
    // extract_with_child(child, sel, dest) = range selection && dest != Html && anchor and focus inside self
    //   && self.text_content_size == |focus.offset - anchor.offset|,
    // exclude_from_copy(dest) = dest != Clone.
    /// Creates `CommentNode { ids, thread_id, is_draft }` right after self (restore_selection default true).
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot, restore_selection: bool) -> Result<Option<NodeKey>, Error>;
}
impl SearchText for CommentNode {}
pub fn create_comment_node(tx: &mut Transaction, ids: Vec<String>, thread_id: Option<i64>, is_draft: bool) -> Id<CommentNode>;
pub fn set_comment_thread_id(tx: &mut Transaction, id: Id<CommentNode>, thread_id: Option<i64>) -> Result<()>;
pub fn set_comment_is_draft(tx: &mut Transaction, id: Id<CommentNode>, is_draft: bool) -> Result<()>;
/// `$getLocal(node) ?? true`.
pub fn comment_is_local(state: &EditorState, id: Id<CommentNode>) -> bool;
/// `fromMarkNode` / `toMarkNode`: copy ids; thread_id None, is_draft false.
pub fn comment_from_mark(mark: &MarkNode) -> CommentNode;
pub fn comment_to_mark(comment: &CommentNode) -> MarkNode;

pub fn get_comment_mark_text(state: &EditorState, mark_id: &str) -> String;
pub struct CommentMarkContext { pub marked_text: String, pub surrounding_text: String }
pub struct CommentMarkLimits { pub marked: usize /*1000*/, pub surrounding: usize /*2000*/ } // UTF-16 units
pub fn get_comment_mark_context(state: &EditorState, mark_id: &str, limits: CommentMarkLimits) -> Option<CommentMarkContext>;
/// Pure JSON transform on a serialized editor state.
pub fn strip_draft_comment_marks(state: &serde_json::Value) -> std::borrow::Cow<'_, serde_json::Value>;
pub struct LiftedDraftCommentMark { pub mark: Id<CommentNode>, pub child_keys: Vec<NodeKey> }
pub fn lift_draft_comment_marks(tx: &mut Transaction) -> Result<Vec<LiftedDraftCommentMark>>;
pub fn restore_draft_comment_marks(tx: &mut Transaction, lifted: &[LiftedDraftCommentMark]) -> Result<()>;
```
```json
{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"hi","type":"text","version":1}],
 "direction":null,"format":"","indent":0,"type":"comment-mark","version":1,"$":{"id":"c1","peerId":"p1"},
 "ids":["m-1"],"threadId":42,"isDraft":false}
```
- `importJSON` (`CommentNode.ts:230`) runs `$createCommentNode({ids:[]}).updateFromJSON(json)`, which applies
  ElementData, `ids`, `threadId` and `isDraft ?? false`, plus `$` in full, then re-applies id and peer. The mark
  type is `comment-mark`, distinct from upstream `mark`. Both are registered. `getTextContent` is the ElementNode
  default.
- `get_comment_mark_text` (`:48`): DFS from root over every CommentNode whose ids contain `mark_id`. Each node's
  top-level-element key decides grouping: the same key as the **previous match** appends that node's text content
  to the last chunk, otherwise a new chunk starts. Chunks are joined with `"\n"`, then `trim()` (JS trim).
- `get_comment_mark_context` (`:123`):
  - `offset` is `text_before(first matching node)`. `text_before` (`:101`) walks up from the node while its parent
    is not root or shadow root, adding the UTF-16 length of every previous sibling's text content at each level.
    It adds no `"\n\n"` separators.
  - `blocks` holds the distinct top-level elements of the matches, in first-seen order. If there are none, return
    None.
  - `marked = get_comment_mark_text(..)`.
  - `joined` is the blocks' text content joined with `"\n"`, `leading` is `joined.len - joined.trimStart().len`,
    and `surrounding = joined.trim()`.
  - The result is `marked_text = clip(marked, marked_limit)` and
    `surrounding_text = window_around(surrounding, max(0, offset - leading), marked.len, surrounding_limit)`.
  - `clip(t, n)`: when longer than n units, the first n units plus `…` (U+2026).
  - `window_around(t, at, focus_len, limit)`: when longer than limit,
    `pad = floor((limit - min(focus_len, limit)) / 2)`, `start = max(0, min(at - pad, len - limit))` and
    `end = start + limit`. The window gets a `…` prefix when `start > 0` and a `…` suffix when `end < len`.
  - All lengths and slices are in UTF-16 code units, and a slice may split a surrogate pair, exactly as JS does.
- `strip_draft_comment_marks` (`:319`): post-order. For every node with a `children` array, first strip each child.
  A stripped child with `type == "comment-mark" && isDraft === true` is replaced by its children (spliced).
  Return the input unchanged (`Cow::Borrowed`) when nothing changed.
- `lift_draft_comment_marks` (`:336`): collect every draft CommentNode in DFS order. For each one, move every child
  before the mark (`insert_before`), remove the mark with `preserve_empty_parent = true`, and record its child keys.
- `restore_draft_comment_marks` (`:354`): iterate the lifted marks in **reverse**. For each child key in order:
  - If the child is missing or detached, set `run = None` and continue.
  - If `run` is None or `run.next_sibling != child`, the first time reuse the original mark node and afterwards
    create a new draft CommentNode with the same ids and thread_id. Insert it before the child, then make it the
    new `run`.
  - Then append the child to `run`.
- Stays in JS: `createDOM` (adds `comment`, `draft`, `local` classes and `data-thread-id`) and `updateDOM`.
  exportDOM: **N** (inherits MarkNode, which has none in v0.45; `lexical_html` uses the `mark` rule).

#### CompletionNode

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompletionNode {
    /// Not serialized; import yields `true` (`CompletionNode.ts:31` ignores all input).
    #[serde(skip, default = "default_true")] pub is_transparent: bool,
}
impl CompletionNode { pub const TYPE: &'static str = "completion"; pub const VERSION: u32 = 1; }
impl ImportPolicy for CompletionNode { const IMPORTED_STATE: ImportedState = ImportedState::None; const IMPORT_ELEMENT_DATA: bool = false; }
impl ElementNode for CompletionNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { false }
    fn exclude_from_copy(&self, _destination: CopyDestination) -> bool { true }
}
impl SearchText for CompletionNode {}
/// Creates the node and appends `children` in order.
pub fn create_completion_node(tx: &mut Transaction, children: &[NodeKey], is_transparent: bool) -> Result<Id<CompletionNode>>;
```
```json
{"children":[…],"direction":null,"format":"","indent":0,"type":"completion","version":1}
```
- The TS `SerializedCompletionNode.text` is never emitted. The sync pipeline drops `completion` nodes before
  writing to Loro (see notes-macro.md). Children are still parsed by the generic element path.
- Stays in JS: `createDOM` (div with `opacity-50` or `opacity-100`), `updateDOM`. `importDOM` returns null.
  exportDOM: **Y** (`{element: null}`).

#### ConnectAppNode

```rust
pub const CONNECT_APP_TAG: &str = "m-connect-app";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConnectAppTarget { #[default] Connections, Harness }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ConnectAppNode {
    #[serde(rename = "appSlug")] pub app_slug: String,
    pub name: String,
    /// Missing or unknown value on import -> `connections` (`ConnectAppNode.ts:116`). Needs a lenient deserializer.
    #[serde(default, deserialize_with = "target_or_default")] pub target: ConnectAppTarget,
}
impl ConnectAppNode { pub const TYPE: &'static str = "connect-app"; pub const VERSION: u32 = 2; }
impl ImportPolicy for ConnectAppNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for ConnectAppNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> String { format!("Connect {}", self.name) }
}
impl SearchText for ConnectAppNode {}
/// `^[a-z0-9_-]+$`.
pub fn is_connect_app_slug(value: &str) -> bool;
pub fn is_connect_app_target(value: &serde_json::Value) -> bool;
pub fn create_connect_app_node(tx: &mut Transaction, app_slug: String, name: String, target: ConnectAppTarget) -> Id<ConnectAppNode>;
```
```json
{"type":"connect-app","version":2,"appSlug":"linear","name":"Linear","target":"connections"}
```
- Stays in JS: `createDOM` (span with `data-connect-app`), `updateDOM`, `decorate`. `importDOM` returns null.
  exportDOM: **Y** (textContent `Connect {name}`).

#### ContactMentionNode

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ContactMentionNode {
    #[serde(rename = "contactId")] pub contact_id: String,
    pub name: String,
    #[serde(rename = "emailOrDomain")] pub email_or_domain: String,
    #[serde(rename = "isCompany")] pub is_company: bool,
    #[serde(rename = "mentionUuid")] #[opt] pub mention_uuid: Option<String>,
}
impl ContactMentionNode { pub const TYPE: &'static str = "contact-mention"; pub const VERSION: u32 = 1; }
impl ImportPolicy for ContactMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for ContactMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> String { format_contact_display_name(&self.name, &self.email_or_domain, self.is_company) }
}
impl SearchText for ContactMentionNode { fn search_text(&self) -> Option<String> { Some(String::new()) } }
pub fn format_contact_display_name(name: &str, email_or_domain: &str, is_company: bool) -> String;
pub fn create_contact_mention_node(tx: &mut Transaction, data: ContactMentionNode) -> Id<ContactMentionNode>;
// setters: set_contact_id, set_contact_name, set_contact_email_or_domain, set_contact_is_company, set_contact_mention_uuid
```
```json
{"type":"contact-mention","version":1,"contactId":"c1","name":"User, Example Q.","emailOrDomain":"user@example.com","isCompany":false}
```
`format_contact_display_name` (`ContactMentionNode.ts:172`). Its output is what `getTextContent` returns:
1. If `is_company`, return `email_or_domain` verbatim.
2. Set `name = name.trim()`.
3. If `name` contains `,`, split it on `,` and trim each part. Only when there are **exactly 2** parts:
   - `last = parts[0]`, and `tokens = parts[1].split(/\s+/)`. `first = tokens[0]`.
   - `middle` is `tokens[1..]` filtered to tokens of UTF-16 length ≤ 2, or length 3 ending in `.`. Each kept token
     loses its **first** `.` only. The kept tokens are joined with `" "`.
   - Set `name = "{first} {middle} {last}"` when `middle` is non-empty, else `"{first} {last}"`. Tokens that fail
     the filter are dropped, so `"Smith, John Paul"` becomes `"John Smith"`.
4. Split `name` on `/\s+/`. In each word, uppercase the first UTF-16 code unit (`charAt(0).toUpperCase()`, which
   may expand, as in `ß` -> `SS`) and lowercase the rest. Join the words with `" "`.
   An empty name yields `""`. Use `regress` for `\s` (JS whitespace set, which includes U+FEFF) and for JS
   `trim()` semantics.
- Stays in JS: `createDOM` (plain span), `updateDOM`, `decorate`, `importDOM` (span with `data-contact-mention`;
  needs id, name and email; ignores the uuid). `getDataAttrs` feeds `lexical_html`. exportDOM: **Y**.

#### CursorSystemNotificationNode

```rust
pub const CURSOR_SYSTEM_NOTIFICATION_NODE_TYPE: &str = "system-notification";
pub const CURSOR_SYSTEM_NOTIFICATION_TAG: &str = "system_notification";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CursorSystemNotificationNode {
    pub source: String,
    /// Every opening-tag attribute except `source`, in tag order. Values must be strings, or import fails.
    pub attributes: IndexMap<String, String>,
    pub text: String,
}
impl CursorSystemNotificationNode { pub const TYPE: &'static str = CURSOR_SYSTEM_NOTIFICATION_NODE_TYPE; pub const VERSION: u32 = 1; }
impl ImportPolicy for CursorSystemNotificationNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for CursorSystemNotificationNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> String { self.text.clone() }
}
impl SearchText for CursorSystemNotificationNode { fn search_text(&self) -> Option<String> { Some(self.text.clone()) } }
pub fn is_cursor_system_notification_data(value: &serde_json::Value) -> bool;
pub fn create_cursor_system_notification_node(tx: &mut Transaction, data: CursorSystemNotificationNode) -> Id<CursorSystemNotificationNode>;
```
```json
{"type":"system-notification","version":1,"source":"github","attributes":{"repo":"github.com/o/r","conclusion":"success"},"text":"All 27 CI checks completed without failures."}
```
- `importJSON` throws `invalid system notification data` on a bad shape (`:122`). Rust returns `Err`. Strict
  serde types give this behaviour.
- Stays in JS: `createDOM` (div with `data-system-notification`), `updateDOM`, `decorate`. `importDOM` returns
  null. exportDOM: **Y** (textContent = text).

#### CustomCodeNode (replaces CodeNode)

Subclass: the struct embeds `CodeNode` (`language`, `theme`; the non-serialized `isSyntaxHighlightSupported`
stays in the view) from the S3 code module, with `type Parent = CodeNode` (CR-2). It inherits the CodeNode
overrides in `packages/lexical-code-core/src/CodeNode.ts`: `insert_new_after` (`:297`), `can_indent = false` (`:370`) and
`collapse_at_start` (`:374`). Code highlighting is view-only (S3 decision), so Rust never creates or merges
`code-highlight` children.

```rust
pub const DEFAULT_LANGUAGE: &str = "plaintext";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CustomCodeNode {
    #[serde(flatten)] pub code: CodeNode, // "language"?: String (omitted when None), "theme"?: String
    /// Always emitted. Missing -> false.
    #[serde(rename = "previewEnabled", default)] pub preview_enabled: bool,
}
impl CustomCodeNode {
    pub const TYPE: &'static str = "custom-code";
    /// Emitted version is 1. `exportJSON` never sets VERSION (=2), so the LexicalNode default wins.
    pub const VERSION: u32 = 1;
}
impl ImportPolicy for CustomCodeNode { const IMPORTED_STATE: ImportedState = ImportedState::Full; }
// NodeType: type Kind = ElementKind; type Parent = CodeNode; as_parent(_mut) → self.code;
// json_version() → Self::VERSION; after_clone() normalizes `language` (CR-16, below).
impl From<CodeNode> for CustomCodeNode { /* NodeReplacements `with`: copy language, preview off */ }
impl ElementNode for CustomCodeNode {}   // CodeNode's overrides are inherited
impl SearchText for CustomCodeNode {}

/// Constructor: `None` -> DEFAULT_LANGUAGE, then `normalized_language` when `is_supported_language`
/// (utils/languageSupport.ts:276,283). Unsupported names are kept verbatim.
pub fn create_custom_code_node(tx: &mut Transaction, language: Option<&str>) -> Id<CustomCodeNode>;
/// `getLatest().getTextContent()`.
pub fn custom_code_get_code(state: &EditorState, id: Id<CustomCodeNode>) -> Result<String>;
/// Sets `language` (raw, `"" -> None`). If preview is on and `language.to_lowercase() != "svg"`, also clears preview.
pub fn custom_code_set_language(tx: &mut Transaction, id: Id<CustomCodeNode>, language: Option<&str>) -> Result<()>;
/// Sets `language` raw (no `"" -> None`), applies the same preview rule, and replaces all children with one TextNode(code).
pub fn custom_code_set_code(tx: &mut Transaction, id: Id<CustomCodeNode>, language: Option<&str>, code: &str) -> Result<()>;
pub fn custom_code_set_preview_enabled(tx: &mut Transaction, id: Id<CustomCodeNode>, enabled: bool) -> Result<()>;
/// Any ancestor (or self) is a CodeNode or CustomCodeNode.
pub fn is_child_of_code(state: &EditorState, key: NodeKey) -> bool;
pub fn is_selection_inside_code(state: &EditorState, selection: &RangeSelection) -> bool; // focus or anchor
```
```json
{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"let x = 1;","type":"text","version":1}],
 "direction":null,"format":"","indent":0,"type":"custom-code","version":1,"$":{"id":"k2"},
 "language":"javascript","previewEnabled":false}
```
Import (`CustomCodeNode.ts:122`, `:105`):
1. If `version != 2`, which is every stored doc, and the JSON has a string `code`, set `text = code`. This is the
   v1 migration.
2. `create_custom_code_node(None)`, which gives `plaintext`.
3. Apply the CodeNode `updateFromJSON`: ElementData plus `$`, then `setLanguage(json.language)` raw, with
   `"" | null | absent -> None`, then `setTheme`.
4. Only if `type == "custom-code"`: `set_preview_enabled(previewEnabled ?? false)`. Then, if `children` is missing
   or empty and `text` is defined, run `set_code(json.language, text)`. This is the legacy text-only form; it may
   clear preview again.
5. Re-apply peer and id.
- Lazy normalization (Q6: copy exactly). JS normalizes `language` only in the constructor, and therefore on every
  `clone`, which happens at the first `getWritable()` of the node itself in an update
  (`CustomCodeNode.ts:91-100`). An imported raw alias such as `"js"` serializes unchanged until the node is next
  written, and then becomes `"javascript"`. Rust: keep the raw value on import and in `set_language`; normalize in
  `create_custom_code_node` and in `after_clone` (CR-16), which runs once per transaction on the first
  writable copy. There is no fallback: normalizing at create only would leave a Rust peer storing `"js"` where a
  JS peer stores `"javascript"`, and the Loro value would flip between clients. CR-16 is blocking for this node.
- Stays in JS: `createDOM`/`updateDOM` (theme class; `preview-mode` with `contentEditable=false` when preview is
  on), Prism tokenizer setup. exportDOM: **N** (inherits CodeNode's; `lexical_html` code rule).

#### DatabaseQueryNode (+ `database_query::data`)

```rust
// data.rs — Lexical-free; also used by services.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseQueryDisplayMode { Scalar, Table, Bar, Line, Area, Scatter, Pie }
pub const DATABASE_QUERY_MAX_SERIES: usize = 5;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DatabaseQueryChart {
    pub x: String,
    pub y: Vec<String>,
    #[opt] pub title: Option<String>,
    #[opt] pub color: Option<String>,
    /// Emitted only when true.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")] pub stack: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DatabaseQueryData {
    #[serde(rename = "queryId")] pub query_id: String,       // "" while draft
    #[serde(rename = "databaseId")] #[opt] pub database_id: Option<String>, // "" -> None
    #[serde(rename = "tableId")] #[opt] pub table_id: Option<String>,       // "" -> None
    #[opt] pub title: Option<String>,                                       // "" -> None
    pub prompt: String,
    #[serde(rename = "displayMode")] pub display_mode: DatabaseQueryDisplayMode,
    #[opt] pub chart: Option<DatabaseQueryChart>,
    #[opt] pub height: Option<serde_json::Number>,
}
pub fn is_database_query_chart_mode(value: &serde_json::Value) -> bool; // bar|line|area|scatter|pie
pub fn is_database_query_display_mode(value: &serde_json::Value) -> bool;
pub fn parse_database_query_chart(value: &serde_json::Value) -> Option<DatabaseQueryChart>;
pub fn parse_database_query_data(value: &serde_json::Value) -> Option<DatabaseQueryData>;

// mod.rs
pub const DATABASE_QUERY_TAG: &str = "m-db-query";
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DatabaseQueryNode { #[serde(flatten)] pub data: DatabaseQueryData }
impl DatabaseQueryNode { pub const TYPE: &'static str = "database-query"; pub const VERSION: u32 = 2; }
impl ImportPolicy for DatabaseQueryNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for DatabaseQueryNode {
    fn is_inline(&self) -> bool { self.data.display_mode == DatabaseQueryDisplayMode::Scalar }
    fn is_keyboard_selectable(&self) -> bool { true }
    /// `title || prompt || "Database answer"`.
    fn text_content(&self) -> String;
}
impl SearchText for DatabaseQueryNode {}
/// `JSON.parse` then `parse_database_query_data`. Malformed -> None.
pub fn parse_database_query_json(json: &str) -> Option<DatabaseQueryData>;
/// Re-validates (Err "Invalid database query"), stringifies in the key order above, replaces every '<' with `<`,
/// and wraps the result in `<m-db-query>…</m-db-query>`.
pub fn database_query_markdown(data: &DatabaseQueryData) -> Result<String>;
pub fn create_database_query_node(tx: &mut Transaction, data: DatabaseQueryData) -> Id<DatabaseQueryNode>;
pub fn set_database_query(tx: &mut Transaction, id: Id<DatabaseQueryNode>, data: DatabaseQueryData) -> Result<()>;
```
```json
{"type":"database-query","version":2,"queryId":"q_1","databaseId":"db_1","title":"Open tasks","prompt":"How many open tasks?","displayMode":"scalar"}
```
`parse_database_query_data` (`databaseQueryData.ts:113`) is the validator. JSON `null` for `title`, `chart` and
`height` counts as absent. It rejects the input when any of these hold:
- `queryId` or `prompt` is not a string.
- `databaseId`, `tableId` or `title` is not a string or undefined. Note that a `null` `databaseId` is **rejected**.
- `height` is present but not a finite number in [96, 1600].
- `displayMode` is unknown.
- `chart` is present but does not parse.

Empty `databaseId`, `tableId` or `title` is dropped. `title` and `prompt` pass through `decodeHtmlEntities`
(`utils/html-entities.ts:16`) **on every import**, so `&amp;amp;` decays one level per round-trip. Port faithfully.

`parse_database_query_chart` (`:76`) rejects the chart unless all of these hold:
- `x` is a non-blank string.
- `y` has 1 to 5 entries, all non-blank, distinct, and none equal to `x`.
- `title` is a string or absent.
- `color`, if present, is a non-blank string, not equal to `x`, used only with exactly one `y` entry, and not in `y`.
- `stack` is a bool or absent.

It emits `stack` only when true.

Import (`DatabaseQueryNode.ts:88`): if the payload fails validation, import returns a **different node**:
`UnknownMentionNode { name: "Unavailable database question" }`. That node is used as-is when
`json.displayMode == "scalar"`, else it is wrapped in a new `ParagraphNode`. No id is applied. This needs the S1
import hook that may return a substitute subtree. If S1 lacks one, do it in a post-parse fix-up over raw JSON
before `EditorState` parse.
- Stays in JS: `createDOM` (span if scalar, else div; `data-database-query`), `updateDOM` (true when
  `displayMode` changes), `decorate`. `importDOM` returns null. exportDOM: **Y** (createDOM element plus textContent).

#### DateMentionNode

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DateMentionNode {
    pub date: String,                                     // ISO date or timestamp
    #[serde(rename = "displayFormat")] pub display_format: String,
    #[serde(rename = "mentionUuid")] #[opt] pub mention_uuid: Option<String>,
}
impl DateMentionNode { pub const TYPE: &'static str = "date-mention"; pub const VERSION: u32 = 1; }
impl ImportPolicy for DateMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::Full; } // updateFromJSON
impl DecoratorNode for DateMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> String { self.display_format.clone() }
}
impl SearchText for DateMentionNode { fn search_text(&self) -> Option<String> { Some(self.display_format.clone()) } }
pub fn create_date_mention_node(tx: &mut Transaction, data: DateMentionNode) -> Id<DateMentionNode>;
// setters: set_date_mention_date, set_date_mention_display_format, set_date_mention_uuid
pub fn parse_date_mention_body(body: &str) -> Option<DateMentionNode>;
```
```json
{"type":"date-mention","version":1,"$":{"id":"d1"},"date":"2026-11-13","displayFormat":"Nov 13, 2026"}
```
`parse_date_mention_body` (`DateMentionNode.ts:278`):
1. Trim the body. If it starts with `{`, `JSON.parse` it. Any error, a non-object, a missing `date` or
   `displayFormat`, or either of those not being a string gives None. `mentionUuid` is kept only when it is a string.
2. Otherwise the body must match `BARE_DATE` (`:250`):
   `^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$`.
   Reject month outside 1–12, or day outside 1 to the number of days in that month (Gregorian, via UTC).
   The label is `"{Mon} {day}, {year}"`, where `day` has no leading zero and `Mon` comes from
   `Jan`…`Dec`. When there is a time: reject hour > 23 or minute > 59. Append `", {h12}:{mm} {AM|PM}"`, where
   `h12 = hour % 12 || 12`, `mm` is the raw two digits, and the period is AM when hour < 12. The offset is not
   applied. Return `{ date: trimmed, display_format: label, mention_uuid: None }`.
   `crates/mention_utils` already implements the same labelling. Reuse it rather than duplicating it.
- Stays in JS: `createDOM`, `updateDOM`, `decorate`, `importDOM` (span with `data-date-mention`; needs `data-date`
  and `data-display-format`). exportDOM: **Y**.

#### DecoratorBlockNode (abstract base; Macro's own copy)

```rust
/// Embedded by block decorators. Macro's copy (`DecoratorBlockNode.ts`) has no exportJSON/importJSON override,
/// so unlike upstream `@lexical/react` it **never serializes `format`**.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct DecoratorBlockData { pub format: ElementFormat } // in-memory only; constructor default ""
/// Implemented by block decorators. `is_inline` is false and `can_indent` is false.
pub trait DecoratorBlock: DecoratorNode {
    fn block(&self) -> &DecoratorBlockData;
    fn block_mut(&mut self) -> &mut DecoratorBlockData;
}
pub fn set_decorator_block_format<T: DecoratorBlock>(tx: &mut Transaction, id: Id<T>, format: ElementFormat) -> Result<()>;
pub fn is_decorator_block(state: &EditorState, key: NodeKey) -> bool;
```
- Embed it as `#[serde(skip)] pub block: DecoratorBlockData`. `DocumentCardNode` always constructs it with
  `"center"`, and the format is lost on any reload.
- Stays in JS: `createDOM` (div), `updateDOM`. No exportDOM.

#### DiffDeleteNode

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct DiffDeleteNode {}
impl DiffDeleteNode { pub const TYPE: &'static str = "diff-delete"; pub const VERSION: u32 = 1; }
impl ImportPolicy for DiffDeleteNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; const IMPORT_ELEMENT_DATA: bool = false; }
impl ElementNode for DiffDeleteNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { true }
}
impl SearchText for DiffDeleteNode {}
pub fn create_diff_delete_node(tx: &mut Transaction) -> Id<DiffDeleteNode>; // no $applyNodeReplacement
/// Self or nearest ancestor that is a DiffDeleteNode.
pub fn find_diff_delete_node_ancestor(state: &EditorState, key: NodeKey) -> Option<Id<DiffDeleteNode>>;
```
```json
{"children":[…],"direction":null,"format":"","indent":0,"type":"diff-delete","version":1}
```
- Stays in JS: `createDOM` (div `md-diff-delete`), `updateDOM`. No exportDOM or importDOM.

#### DiffInsertNode

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DiffInsertNode { pub markdown: String }
impl DiffInsertNode { pub const TYPE: &'static str = "diff-insert"; pub const VERSION: u32 = 1; }
impl ImportPolicy for DiffInsertNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for DiffInsertNode {
    fn is_isolated(&self) -> bool { true }
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { true }
    // text_content: LexicalNode default "" (not overridden)
}
impl SearchText for DiffInsertNode {}
pub fn create_diff_insert_node(tx: &mut Transaction, markdown: String) -> Id<DiffInsertNode>;
pub fn set_diff_insert_markdown(tx: &mut Transaction, id: Id<DiffInsertNode>, markdown: String) -> Result<()>;
```
```json
{"type":"diff-insert","version":1,"markdown":"## New heading\n\nBody"}
```
- Stays in JS: `createDOM` (div), `updateDOM`, `decorate`. No exportDOM or importDOM.

#### DiffNode

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DiffNode {
    #[serde(rename = "userId")] pub user_id: String,
    /// Always emitted. Missing on import -> "AI Suggestion".
    #[serde(default = "default_diff_label")] pub label: String,
}
impl DiffNode { pub const TYPE: &'static str = "diff"; pub const VERSION: u32 = 1; }
impl ImportPolicy for DiffNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; const IMPORT_ELEMENT_DATA: bool = false; }
impl ElementNode for DiffNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { true }
}
impl SearchText for DiffNode {}
pub fn create_diff_node(tx: &mut Transaction, user_id: String, label: Option<String>) -> Id<DiffNode>;
pub fn set_diff_label(tx: &mut Transaction, id: Id<DiffNode>, label: String) -> Result<()>;
pub fn set_diff_user_id(tx: &mut Transaction, id: Id<DiffNode>, user_id: String) -> Result<()>;
/// `handleAccept`. Needs `macro_markdown` (ALL_TRANSFORMERS).
pub fn diff_accept(tx: &mut Transaction, id: Id<DiffNode>) -> Result<()>;
/// `handleReject`.
pub fn diff_reject(tx: &mut Transaction, id: Id<DiffNode>) -> Result<()>;
/// `$diffNodeDeleteAtStart`. Returns whether it handled the delete.
pub fn diff_node_delete_at_start(tx: &mut Transaction) -> Result<bool>;
```
```json
{"children":[{"type":"diff-delete",…},{"type":"diff-insert","version":1,"markdown":"…"}],
 "direction":null,"format":"","indent":0,"type":"diff","version":1,"userId":"u1","label":"AI Suggestion"}
```
- `diff_accept` (`DiffNode.ts:115`): find the first child that is a DiffInsertNode; if there is none, return.
  Clear the node's children. Run `convert_from_markdown_string(markdown, ALL_TRANSFORMERS, node,
  preserve_new_lines=false)` into the node. Record the last child, run `lexical_rich_nodes::utils::unwrap_node(node)`, then
  `select_end` on that last child if it exists.
- `diff_reject` (`:137`): find the first child with type `diff-delete`. If there is none, remove the node and return.
  Otherwise move every child of the delete node, in order, to before the DiffNode, keeping the last one moved.
  Remove the DiffNode, which takes the delete node and the insert node with it. Then `select_end` the last moved
  child.
- `diff_node_delete_at_start` (`:176`): return false unless all of these hold:
  - the selection is a collapsed RangeSelection;
  - `anchor.offset == 0`;
  - the focus node is the first child of its parent `P`;
  - `find_diff_delete_node_ancestor(P)` gives `D`;
  - `D`'s parent is a DiffNode `N`.

  Then collect `D`'s element children as `E`. JS (`DiffNode.ts:212-216`) runs `S.insert_after(e)` for each `e`
  (when `N` has a previous sibling `S`) or `N.insert_before(E[i])` from last to first, and **both branches leave
  `E` in reverse order**. Q4 ruling: **fix, in JS and Rust together** (interactive only, no route or stored-data
  surface). Rust inserts `E` in document order: `N.insert_before(e)` for each `e` in `E`, first to last. Then
  `select_start` on `E[0]` if `E` is non-empty, remove `N`, and return true. The JS fix lands in the same PR so
  the two editors agree.
- Stays in JS: `createDOM` (via `createDOMWithFactory`: div `md-diff`, `data-diff-user-id`, `data-diff-label`),
  `updateDOM`. `handleAccept`/`handleReject` keep JS wrappers that call `editor.update`. No exportDOM.

#### DiffTextNode (extends TextNode)

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffStatus { Insert, Delete }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DiffTextNode {
    #[serde(rename = "diffStatus")] pub diff_status: DiffStatus,
    pub author: String, // user id
}
impl DiffTextNode { pub const TYPE: &'static str = "diff-text"; pub const VERSION: u32 = 1; }
/// importJSON (`DiffTextNode.ts:64`) sets text/format/detail/mode/style only: no `$`, not even `$.id`.
impl ImportPolicy for DiffTextNode { const IMPORTED_STATE: ImportedState = ImportedState::None; }
impl TextNode for DiffTextNode {} // no model overrides; text_content = text
impl SearchText for DiffTextNode {}
pub fn create_diff_text_node(tx: &mut Transaction, text: String, status: DiffStatus, author: String) -> Id<DiffTextNode>;
```
```json
{"detail":0,"format":0,"mode":"normal","style":"","text":"added","type":"diff-text","version":1,"diffStatus":"insert","author":"u1"}
```
- Text merging: upstream `TextNode` normalization merges adjacent simple text nodes only when their types and
  props match. Rust's `can_merge_with` default must compare `diff_status` and `author`, or a struct-equality
  predicate must exclude them. Confirm against S1's merge rule.
- Stays in JS: `createDOM`/`updateDOM` (class `diff-{status}`, `data-diff-status`, `data-diff-author`). No
  exportDOM override; `lexical_html` uses the text rule.

#### DocumentCardNode (extends DecoratorBlockNode)

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PreviewDim { Str(String), Num(serde_json::Number) }
pub type PreviewBox = [PreviewDim; 2];
/// `["100%", "400px"]`.
pub fn default_preview_box() -> PreviewBox;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentCardNode {
    #[serde(skip, default = "center_block")] pub block: DecoratorBlockData, // format "center", never serialized
    #[serde(rename = "documentId")] pub document_id: String,
    #[serde(rename = "documentName")] pub document_name: String,
    #[serde(rename = "blockName")] pub block_name: String,
    /// Always emitted. Missing or falsy on import -> {}.
    #[serde(rename = "blockParams", default)] pub block_params: IndexMap<String, String>,
    /// Always emitted. Missing or falsy -> default_preview_box().
    #[serde(rename = "previewBox", default = "default_preview_box")] pub preview_box: PreviewBox,
    /// `{view:{x,y,scale}}` (canvas) or `{poll:{optionCount}}`. Kept opaque, never validated.
    #[serde(rename = "previewData")] #[opt] pub preview_data: Option<serde_json::Value>,
    #[serde(rename = "mentionUuid")] #[opt] pub mention_uuid: Option<String>,
}
impl DocumentCardNode { pub const TYPE: &'static str = "document-card"; pub const VERSION: u32 = 1; }
impl ImportPolicy for DocumentCardNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for DocumentCardNode {
    fn is_inline(&self) -> bool { false }            // DecoratorBlock
    fn can_indent(&self) -> bool { false }           // DecoratorBlock
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> String { self.document_name.clone() }
}
impl DecoratorBlock for DocumentCardNode { /* block / block_mut */ }
impl SearchText for DocumentCardNode { fn search_text(&self) -> Option<String> { Some(String::new()) } }
pub fn create_document_card_node(tx: &mut Transaction, data: DocumentCardNode) -> Id<DocumentCardNode>;
// setters: set_card_document_id, _document_name, _block_name, _block_params, _preview_box, _preview_data, _mention_uuid
pub fn convert_mention_to_card(tx: &mut Transaction, mention: Id<DocumentMentionNode>,
    preview_box: Option<PreviewBox>, preview_data: Option<serde_json::Value>) -> Result<Id<DocumentCardNode>>;
pub fn convert_card_to_mention(tx: &mut Transaction, card: Id<DocumentCardNode>) -> Result<Id<DocumentMentionNode>>;
pub enum DocumentNodeId { Mention(Id<DocumentMentionNode>), Card(Id<DocumentCardNode>) }
pub fn toggle_document_node_type(tx: &mut Transaction, node: NodeKey,
    preview_box: Option<PreviewBox>, preview_data: Option<serde_json::Value>) -> Result<DocumentNodeId>;
```
```json
{"type":"document-card","version":1,"$":{"id":"dc1"},"documentId":"doc_1","documentName":"Roadmap",
 "blockName":"md","blockParams":{},"previewBox":["100%","400px"],"mentionUuid":"u-9"}
```
- `convert_mention_to_card` (`DocumentCardNode.ts:420`):
  1. Build the card from the mention's id, name, block name, block params and uuid, plus the arguments. Return Err
     when the mention has no parent.
  2. If the parent is root or shadow root, `replace(mention, card)` and return.
  3. Otherwise `[before, after] = split_node(parent, mention_index)` (upstream `$splitNode`, which splits up to the
     root). Let `parent_after = mention.parent` after the split. Run `after.insert_before(card)`, then
     `mention.remove()`.
  4. Run `remove_empty_element_chain(parent, stop = before)` and `remove_empty_element_chain(parent_after,
     stop = after)`. `remove_empty_element_chain` (`:393`) walks upward from `node` while it is not root or shadow
     root: break if the node has children; otherwise remove it, break if it is `stop`, and continue with its parent.
- `convert_card_to_mention` (`:471`) creates a mention, which stamps `createdAt` = now (see DocumentMentionNode),
  wraps it in a new ParagraphNode, and replaces the card with that paragraph.
- `toggle_document_node_type` (`:491`) dispatches on type and returns Err for any other type.
- Stays in JS: `createDOM` (block div, `data-document-card`), `updateDOM`, `decorate` (signature ignores
  `blockParams` when `blockName == "database"`), `importDOM` (div with `data-document-card`), the
  preview-component cache (`setDocumentCardPreviewComponent` `:74`, `unsetDocumentCardPreviewCache` `:85`).
  exportDOM: **Y** (`getDataAttrs`; JSON-stringified params, box and data; `previewData || {}`).

#### DocumentMentionNode

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentMentionNode {
    #[serde(rename = "documentId")] pub document_id: String,
    #[serde(rename = "documentName")] pub document_name: String,
    #[serde(rename = "blockName")] pub block_name: String,
    /// Always emitted. Missing -> {}.
    #[serde(rename = "blockParams", default)] pub block_params: IndexMap<String, String>,
    #[serde(rename = "mentionUuid")] #[opt] pub mention_uuid: Option<String>,
    /// Always emitted. Missing -> false.
    #[serde(default)] pub collapsed: bool,
    #[serde(rename = "channelType")] #[opt] pub channel_type: Option<String>,
    /// Epoch ms. See the import note: a missing value is stamped with "now".
    #[serde(rename = "createdAt")] #[opt] pub created_at: Option<i64>,
}
impl DocumentMentionNode { pub const TYPE: &'static str = "document-mention"; pub const VERSION: u32 = 2; }
impl ImportPolicy for DocumentMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl DecoratorNode for DocumentMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> String { self.document_name.clone() }
}
impl SearchText for DocumentMentionNode { fn search_text(&self) -> Option<String> { Some(String::new()) } }
/// `created_at: None` -> `tx.now_ms()` (`DocumentMentionNode.ts:352`, `params.createdAt ?? Date.now()`).
pub fn create_document_mention_node(tx: &mut Transaction, data: DocumentMentionNode) -> Id<DocumentMentionNode>;
// setters: set_mention_document_id, _document_name, _block_name, _block_params, _mention_uuid, _collapsed, _channel_type, _created_at
```
```json
{"type":"document-mention","version":2,"$":{"id":"m1"},"documentId":"doc_1","documentName":"Roadmap","blockName":"md",
 "blockParams":{},"collapsed":false,"createdAt":1762473600000}
```
- **Non-idempotent import**: `importJSON` goes through `$createDocumentMentionNode`, so a stored mention without
  `createdAt` gets `Date.now()` at load time, and its next export differs from the stored bytes. Rust needs an
  injected clock: `tx.now_ms()`, an S3 helper over the `NodeClock` `ExtensionState` (`tx.extension::<NodeClock>()?`,
  holding `Arc<dyn Fn() -> u64 + Send + Sync>`; the host installs the wall clock, tests a fixed one). S1's core
  reads no clock (S1 §12, D-B9), so this lives in `macro_document_model`, as a `fn now_ms(tx: &Transaction) ->
  Result<u64>` extension trait method. Q3 ruling: **copy**, with the
  injected clock. Do not drop the stamp: `/snapshot/markdown` output carries it today (markdown import goes through
  `$createDocumentMentionNode`, `:352`), and the first JS write after load persists it to Loro. No markdown,
  plaintext or search export reads `createdAt`, so text routes are unaffected. Fixtures inject a fixed clock on
  both sides instead of masking (Q20).
- Stays in JS: `createDOM` (span with `data-document-mention`), `updateDOM`, `decorate`, `importDOM` (span/div/a with
  `data-document-mention`; needs id and block name; `data-created-at` parsed with `parseInt`). exportDOM: **Y**
  (`getDataAttrs`, empty values skipped, textContent = name).

---

#### Node mapping

| Rust struct | TS class | file:line (class decl) | kind | registered in presets |
| --- | --- | --- | --- | --- |
| `AccountManagerRequestNode` | AccountManagerRequestNode | `packages/lexical-core/nodes/AccountManagerRequestNode.ts:53` | DecoratorNode | markdown, markdown-sync, chat, calendar |
| `AgentActivityNode` | AgentActivityNode | `packages/lexical-core/nodes/AgentActivityNode.ts:139` | DecoratorNode (block) | markdown, markdown-sync, chat, calendar |
| `AgentContextNode` | AgentContextNode | `packages/lexical-core/nodes/AgentContextNode.ts:45` | DecoratorNode (block, hidden) | markdown, markdown-sync, chat, calendar |
| `AgentSessionMentionNode` | AgentSessionMentionNode | `packages/lexical-core/nodes/AgentSessionMentionNode.ts:41` | DecoratorNode (inline unless expanded) + transform | markdown, markdown-sync, chat, calendar |
| `AwaitNode` | AwaitNode | `packages/lexical-core/nodes/AwaitNode.ts:47` | DecoratorNode | markdown, markdown-sync, chat, calendar |
| `BookingLinkMentionNode` | BookingLinkMentionNode | `packages/lexical-core/nodes/BookingLinkMentionNode.ts:60` | DecoratorNode (inline) | markdown, markdown-sync, chat, calendar |
| `ClassedBlockNode` | ClassedBlockNode | `packages/lexical-core/nodes/ClassedBlockNode.ts:35` | ElementNode (block) | markdown, markdown-sync, chat, calendar |
| `CommentNode` | CommentNode | `packages/lexical-core/nodes/CommentNode.ts:153` | ElementNode, MarkNode subclass (`Parent = MarkNode`) | markdown, markdown-sync, chat, calendar |
| `CompletionNode` | CompletionNode | `packages/lexical-core/nodes/CompletionNode.ts:19` | ElementNode (block) | markdown, markdown-sync, chat, calendar |
| `ConnectAppNode` | ConnectAppNode | `packages/lexical-core/nodes/ConnectAppNode.ts:72` | DecoratorNode (inline) | markdown, markdown-sync, chat, calendar |
| `ContactMentionNode` | ContactMentionNode | `packages/lexical-core/nodes/ContactMentionNode.ts:38` | DecoratorNode (inline) | markdown, markdown-sync, chat, calendar |
| `CursorSystemNotificationNode` | CursorSystemNotificationNode | `packages/lexical-core/nodes/CursorSystemNotificationNode.ts:85` | DecoratorNode (block) | markdown, markdown-sync, chat, calendar |
| `CustomCodeNode` | CustomCodeNode | `packages/lexical-core/nodes/CustomCodeNode.ts:84` | ElementNode, CodeNode subclass (`Parent = CodeNode`); replacement for CodeNode | markdown, markdown-sync, chat, calendar |
| `DatabaseQueryNode` | DatabaseQueryNode | `packages/lexical-core/nodes/DatabaseQueryNode.ts:53` | DecoratorNode (inline iff scalar) | markdown, markdown-sync, chat, calendar |
| `DateMentionNode` | DateMentionNode | `packages/lexical-core/nodes/DateMentionNode.ts:35` | DecoratorNode (inline) | markdown, markdown-sync, chat, calendar |
| `DecoratorBlockData` / `DecoratorBlock` | DecoratorBlockNode | `packages/lexical-core/nodes/DecoratorBlockNode.ts:26` | abstract DecoratorNode base | not registered |
| `DiffDeleteNode` | DiffDeleteNode | `packages/lexical-core/nodes/DiffDeleteNode.ts:8` | ElementNode (block) | markdown, markdown-sync, chat, calendar |
| `DiffInsertNode` | DiffInsertNode | `packages/lexical-core/nodes/DiffInsertNode.ts:31` | DecoratorNode (block, isolated) | markdown, markdown-sync, chat, calendar |
| `DiffNode` | DiffNode | `packages/lexical-core/nodes/DiffNode.ts:34` | ElementNode (block) | markdown, markdown-sync, chat, calendar |
| `DiffTextNode` | DiffTextNode | `packages/lexical-core/nodes/DiffTextNode.ts:19` | TextNode subclass | markdown, markdown-sync, chat, calendar |
| `DocumentCardNode` | DocumentCardNode | `packages/lexical-core/nodes/DocumentCardNode.ts:91` | DecoratorBlockNode subclass | markdown, markdown-sync, chat, calendar |
| `DocumentMentionNode` | DocumentMentionNode | `packages/lexical-core/nodes/DocumentMentionNode.ts:42` | DecoratorNode (inline) | markdown, markdown-sync, chat, calendar |

#### Function and item mapping

| Rust item | Ports | Source (file:line) | Notes |
| --- | --- | --- | --- |
| `register_nodes_a_to_d`, `EditorType` | `SupportedNodeTypes`, `NodeReplacements`, `RegisteredNodesByType` | `packages/lexical-core/node-list.ts:75,135,158` | 41 custom nodes total |
| `ImportPolicy`, `ImportedState` | `$applyIdFromSerialized`, `$applyPeerIdFromSerialized` | `packages/lexical-core/plugins/nodeIdPlugin.ts:72`, `plugins/peerIdPlugin.ts:94` | per-node `$` survival |
| `SearchText` | `getSearchText` / `$extractSearchText` | `services/lexical-service/src/lib/search-text.ts:13` | |
| `is_account_manager_grant_id` | `isAccountManagerGrantId` | `packages/lexical-core/nodes/AccountManagerRequestNode.ts:44` | |
| `create_account_manager_request_node` | `$createAccountManagerRequestNode` | `…/AccountManagerRequestNode.ts:143` | |
| `AccountManagerRequestNode::text_content` | `getTextContent` | `…/AccountManagerRequestNode.ts:120` | constant |
| `is_agent_activity_card` | `isAgentActivityCard` | `…/AgentActivityNode.ts:57` | |
| `is_agent_activity_status` | `isAgentActivityStatus` | `…/AgentActivityNode.ts:92` | |
| `parse_agent_activity_data` | `isAgentActivityData` (+ `isAgentActivityRow`) | `…/AgentActivityNode.ts:116,98` | |
| `agent_activity_text` | `agentActivityText` | `…/AgentActivityNode.ts:132` | |
| `create_agent_activity_node` | `$createAgentActivityNode` | `…/AgentActivityNode.ts:246` | |
| `is_agent_context_data` | `isAgentContextData` | `…/AgentContextNode.ts:26` | |
| `AgentContextNode` import validation | `importJSON` | `…/AgentContextNode.ts:63` | Err on bad shape |
| `create_agent_context_node` | `$createAgentContextNode` | `…/AgentContextNode.ts:143` | |
| `agent_session_mention_transform` | `static transform` | `…/AgentSessionMentionNode.ts:60` | uses `insert_node_to_nearest_root_at_caret` (`packages/lexical-utils/src/index.ts:541`) |
| `build_agent_session_mention_markdown` | `buildAgentSessionMentionMarkdown` | `…/AgentSessionMentionNode.ts:284` | |
| `create_agent_session_mention_node` | `$createAgentSessionMentionNode` | `…/AgentSessionMentionNode.ts:291` | |
| `set_agent_session_label/expanded/mention_uuid` | `setLabel`, `setExpanded`, `setMentionUuid` | `…/AgentSessionMentionNode.ts:234,244,254` | |
| `create_await_node` | `$createAwaitNode` + constructor | `…/AwaitNode.ts:176,67` | nanoid(21) default |
| `set_await_text`, `await_is_local` | `setText`, `isLocal` | `…/AwaitNode.ts:147,157` | |
| `is_macro_booking_url`, `parse_booking_url` | `isMacroBookingUrl`, `parseBookingUrl` | `…/BookingLinkMentionNode.ts:35,40` | regex `:31` |
| `RawBookingLinkMention` url default | constructor | `…/BookingLinkMentionNode.ts:101` | headless fallback |
| `create_booking_link_mention_node`, `set_booking_label/url` | `$createBookingLinkMentionNode`, `setLabel`, `setUrl` | `…/BookingLinkMentionNode.ts:264,227,232` | |
| `is_allowed_tag_name` | `isAllowedTagName` | `…/ClassedBlockNode.ts:20` | |
| `RawClassedBlock` | `importJSON` | `…/ClassedBlockNode.ts:73` | drops attributes and ElementData |
| `create_classed_block_node` | `$createClassedBlockNode` | `…/ClassedBlockNode.ts:147` | |
| `create_comment_node` | `$createCommentNode` | `…/CommentNode.ts:29` | |
| `get_comment_mark_text` | `$getCommentMarkText` | `…/CommentNode.ts:48` | |
| `get_comment_mark_context` (+ private `clip`, `window_around`, `text_before`) | `$getCommentMarkContext` | `…/CommentNode.ts:123,74,79,101` | UTF-16 lengths |
| `set_comment_thread_id/is_draft`, `comment_is_local` | `setThreadId`, `setIsDraft`, `getIsLocal` | `…/CommentNode.ts:172,182,192` | |
| `comment_from_mark`, `comment_to_mark` | `fromMarkNode`, `toMarkNode` | `…/CommentNode.ts:196,201` | |
| `CommentNode::insert_new_after` | `insertNewAfter` | `…/CommentNode.ts:267` | |
| `CommentNode` mark delegation | MarkNode overrides | `packages/lexical-mark/src/MarkNode.ts:148-189` | upstream |
| `strip_draft_comment_marks` | `stripDraftCommentMarks` (+ `FromNode`) | `…/CommentNode.ts:319,294` | |
| `lift_draft_comment_marks` | `$liftDraftCommentMarks` | `…/CommentNode.ts:336` | |
| `restore_draft_comment_marks` | `$restoreDraftCommentMarks` | `…/CommentNode.ts:354` | |
| `create_completion_node` | `$createCompletionNode` | `…/CompletionNode.ts:70` | |
| `is_connect_app_slug`, `is_connect_app_target` | `isConnectAppSlug`, `isConnectAppTarget` | `…/ConnectAppNode.ts:57,61` | |
| `create_connect_app_node` | `$createConnectAppNode` | `…/ConnectAppNode.ts:196` | |
| `format_contact_display_name` | `formatDisplayName` (private) | `…/ContactMentionNode.ts:172` | feeds getTextContent `:222` |
| `create_contact_mention_node` + setters | `$createContactMentionNode`, `set*` | `…/ContactMentionNode.ts:289,234-273` | |
| `is_cursor_system_notification_data` | `isCursorSystemNotificationData` | `…/CursorSystemNotificationNode.ts:51` | |
| `create_cursor_system_notification_node` | `$createCursorSystemNotificationNode` | `…/CursorSystemNotificationNode.ts:212` | |
| `create_custom_code_node` | `$createCustomCodeNode` + constructor | `…/CustomCodeNode.ts:221,91` | normalizes language |
| `CustomCodeNode` import | `importJSON`, `updateFromJSON` | `…/CustomCodeNode.ts:122,105` | v1 `code` -> `text` |
| `custom_code_get_code`, `custom_code_set_language`, `custom_code_set_code`, `custom_code_set_preview_enabled` | `getCode`, `setLanguage`, `setCode`, `setPreviewEnabled` | `…/CustomCodeNode.ts:169,173,189,210` | |
| `is_child_of_code`, `is_selection_inside_code` | `$isChildOfCode`, `$isSelectionInsideCode` | `…/CustomCodeNode.ts:243,250` | |
| `CustomCodeNode` code delegation | CodeNode `insertNewAfter`, `canIndent`, `collapseAtStart` | `packages/lexical-code-core/src/CodeNode.ts:297,370,374` | upstream |
| `parse_database_query_json`, `database_query_markdown` | `parseDatabaseQueryJson`, `databaseQueryMarkdown` | `…/DatabaseQueryNode.ts:35,45` | |
| `DatabaseQueryNode` import fallback | `importJSON` | `…/DatabaseQueryNode.ts:88` | substitute UnknownMentionNode |
| `create_database_query_node`, `set_database_query` | `$createDatabaseQueryNode`, `setQuery` | `…/DatabaseQueryNode.ts:166,123` | |
| `is_database_query_chart_mode`, `is_database_query_display_mode` | same | `packages/lexical-core/nodes/databaseQueryData.ts:55,61` | |
| `parse_database_query_chart`, `parse_database_query_data` | same | `…/databaseQueryData.ts:76,113` | entity decode on import |
| `parse_date_mention_body` (+ private `bare_date_label`) | `parseDateMentionBody`, `bareDateLabel` | `…/DateMentionNode.ts:278,258` | regex `:250` |
| `create_date_mention_node` + setters | `$createDateMentionNode`, `setDate`, `setDisplayFormat`, `setMentionUuid` | `…/DateMentionNode.ts:215,179,188,197` | |
| `DecoratorBlock`, `set_decorator_block_format`, `is_decorator_block` | `DecoratorBlockNode`, `setFormat`, `$isDecoratorBlockNode` | `…/DecoratorBlockNode.ts:26,46,56` | format not serialized |
| `create_diff_delete_node`, `find_diff_delete_node_ancestor` | `$createDiffDeleteNode`, `$findDiffDeleteNodeAncestor` | `…/DiffDeleteNode.ts:46,59` | |
| `create_diff_insert_node`, `set_diff_insert_markdown` | `$createDiffInsertNode`, `setMarkdown` | `…/DiffInsertNode.ts:113,95` | |
| `create_diff_node`, `set_diff_label`, `set_diff_user_id` | `$createDiffNode`, `setLabel`, `setUserId` | `…/DiffNode.ts:163,99,109` | |
| `diff_accept`, `diff_reject` | `handleAccept`, `handleReject` | `…/DiffNode.ts:115,137` | |
| `diff_node_delete_at_start` | `$diffNodeDeleteAtStart` | `…/DiffNode.ts:176` | reverse-order bug fixed (Q4), JS fixed too |
| `create_diff_text_node` | `$createDiffTextNode` | `…/DiffTextNode.ts:87` | |
| `default_preview_box` | `DEFAULT_PREVIEW_BOX` | `…/DocumentCardNode.ts:27` | |
| `create_document_card_node` + setters | `$createDocumentCardNode`, `set*` | `…/DocumentCardNode.ts:372,303-336` | |
| `convert_mention_to_card` (+ private `remove_empty_element_chain`) | `$convertMentionToCard`, `$removeEmptyElementChain` | `…/DocumentCardNode.ts:420,393` | |
| `convert_card_to_mention` | `$convertCardToMention` | `…/DocumentCardNode.ts:471` | |
| `toggle_document_node_type` | `$toggleDocumentNodeType` | `…/DocumentCardNode.ts:491` | |
| `create_document_mention_node` + setters | `$createDocumentMentionNode`, `set*` | `…/DocumentMentionNode.ts:341,269-314` | `createdAt ?? now` |
| `$is*Node` helpers (all 22) | `$isXNode` | each file, after its `$create*` | `state.get::<T>(k).is_some()`; no separate fn |

#### Not ported (view / DOM; stay in JS)

- `decorate` and decorator caches: `AccountManagerRequestNode.ts:128`, `AgentActivityNode.ts:223`, `AgentContextNode.ts:128`, `AgentSessionMentionNode.ts:260`, `AwaitNode.ts:161`, `BookingLinkMentionNode.ts:237`, `ConnectAppNode.ts:181`, `ContactMentionNode.ts:275`, `CursorSystemNotificationNode.ts:197`, `DatabaseQueryNode.ts:153`, `DateMentionNode.ts:202`, `DiffInsertNode.ts:100`, `DocumentCardNode.ts:338`, `DocumentMentionNode.ts:317`
- `createDOM`/`updateDOM`: every node above (for example `ClassedBlockNode.ts:130`, `CommentNode.ts:205,245`, `CompletionNode.ts:47`, `CustomCodeNode.ts:142,152`, `DecoratorBlockNode.ts:38`, `DiffDeleteNode.ts:25`, `DiffNode.ts:60`, `DiffTextNode.ts:42,55`, `DocumentCardNode.ts:189`)
- `importDOM`: `AgentSessionMentionNode.ts:161`, `BookingLinkMentionNode.ts:149`, `ClassedBlockNode.ts:96`, `ContactMentionNode.ts:141`, `DateMentionNode.ts:132`, `DocumentCardNode.ts:200`, `DocumentMentionNode.ts:161`; the other nodes return null
- `exportDOM` (moves to `lexical_html`, not this crate): `AccountManagerRequestNode.ts:113`, `AgentActivityNode.ts:206`, `AgentContextNode.ts:116`, `AgentSessionMentionNode.ts:206`, `AwaitNode.ts:131`, `BookingLinkMentionNode.ts:191`, `ClassedBlockNode.ts:116`, `CompletionNode.ts:57`, `ConnectAppNode.ts:158`, `ContactMentionNode.ts:213`, `CursorSystemNotificationNode.ts:177`, `DatabaseQueryNode.ts:145`, `DateMentionNode.ts:158`, `DocumentCardNode.ts:256`, `DocumentMentionNode.ts:217`
- `getDataAttrs` (HTML attribute builders, used by `lexical_html`): `AgentSessionMentionNode.ts:196`, `BookingLinkMentionNode.ts:181`, `ContactMentionNode.ts:130`, `DateMentionNode.ts:123`, `DocumentCardNode.ts:243`, `DocumentMentionNode.ts:203`
- `buildBookingUrl` (reads `window.location`): `BookingLinkMentionNode.ts:253`
- `setDocumentCardPreviewComponent` / `unsetDocumentCardPreviewCache` (view cache): `DocumentCardNode.ts:74,85`
- `exportComponentProps` (decorator props): every DecoratorNode. Rust props are the struct fields.
- `PrismTokenizer.defaultLanguage` setup and prism imports: `CustomCodeNode.ts:46,82`
- `DiffNode.handleAccept/handleReject` `editor.update` wrappers: `DiffNode.ts:115,137` (the model logic is ported as `diff_accept`/`diff_reject`)
### 4.1b Custom nodes (E–W)

Crate `macro_document_model`, module `nodes`. Covers the 21 files `EquationNode` .. `WatermarkNode` in
`packages/lexical-core/nodes/` (20 concrete nodes + abstract `MediaNode`), plus `utils/media.ts`.

#### Module layout

```
src/nodes/
  mod.rs                 // re-exports; JsNumber. ImportPolicy/ImportedState and SearchText are 4.1a's (rule 5, 6)
  equation.rs            // EquationNode
  group_mention.rs       // GroupMentionNode
  horizontal_rule.rs     // HorizontalRuleNode
  html_render.rs         // HtmlRenderNode
  media.rs               // MediaData, MediaType, MediaNode trait, calculate_effective_dimensions, constrain_image_dimensions
  image.rs               // ImageNode
  video.rs               // VideoNode
  inline_search.rs       // InlineSearchNode, InlineSearchNodesType, trigger helpers
  magic_chip.rs          // MagicChipNode + status/author/message types
  paste.rs               // PasteNode, PasteOrigin, convert_paste_to_text, insert_referenced_paste
  pull_request_mention.rs
  reply_target.rs        // ReplyTargetNode + markdown helpers
  search_match.rs        // SearchMatchNode (wraps lexical_rich_nodes::mark::MarkNode)
  snapshot.rs
  tag_mention.rs
  task_list.rs           // TaskListNode (replaces lexical_rich_nodes::list::ListNode), TASK_LIST_VIEW state key
  theme_mention.rs
  unknown_mention.rs
  unlinked_text.rs
  user_mention.rs
  watermark.rs
```

#### Shared conventions for this section

Facts that hold for every node below (verified against upstream v0.45.0):

- Wire key order: `exportJSON` spreads `super.exportJSON()` first, so decorators emit
  `type, version, $?, <own fields in the order listed>`; overwriting `type`/`version` later keeps their
  position. TextNode subclasses emit `detail, format, mode, style, text, type, version, $?`
  (`packages/lexical/src/nodes/LexicalTextNode.ts:699`). Element subclasses emit
  `children, direction, format, indent, type, version, $?, textFormat?, textStyle?, <own>`
  (`packages/lexical/src/nodes/LexicalElementNode.ts:639`). The framework writes base keys and `$`;
  our structs serialize only own fields, in declared order.
- `undefined` fields vanish under `JSON.stringify`: every TS `field?: T` / `T | undefined` emitted by
  `exportJSON` maps to `Option<T>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`.
  A key that holds `null` in stored JSON round-trips as `null` when JS keeps it (for example
  `MagicChipNode.promptedMessage` and `channelId`, AgentActivity row `"card": null`, which pass
  through); see §0.2 rule 9. There is no global "only X emits null" rule: each field says.
- `DecoratorBlockNode` (owned by 4.1a, `packages/lexical-core/nodes/DecoratorBlockNode.ts:26`) has no
  `exportJSON` override: `format` is **never serialized**. It is the constructor constant
  (`HorizontalRuleNode` `""`, `MediaNode`/`PasteNode` `"center"`, `HtmlRenderNode` `"left"`) and is
  never restored on import. Model it as a non-serialized `#[serde(skip, default = ...)]` field or a
  `const DEFAULT_FORMAT: ElementFormat` per 4.1a's choice; `is_inline() -> false`, `can_indent() -> false`.
- `version` is never checked on import; always emit the node's constant.
- NodeState `$` import differs per node because most `importJSON`s skip `updateFromJSON`. Byte-identical
  round-trip with lexical-service requires reproducing it:

Import policy and search text use the **single** §4.1a mechanisms: `ImportPolicy { IMPORTED_STATE:
ImportedState, IMPORT_ELEMENT_DATA }` (rule 5) and `SearchText { fn search_text(&self) ->
Option<Cow<'_, str>> }` (rule 6). Each node below has one `impl ImportPolicy` and one `impl SearchText`
(empty when it has no `getSearchText` override).

```rust

/// A JS `number` that serializes like `JSON.stringify` (integral values without `.0`,
/// shortest round-trip otherwise). Use `lexical_model`'s type if the core spec defines one.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd, Default)]
pub struct JsNumber(pub f64);
impl Serialize for JsNumber { /* integral & |v| < 2^53 -> i64; else f64 */ }
impl<'de> Deserialize<'de> for JsNumber { /* any JSON number -> f64 */ }
```

- `$create*` ports are `fn create_x(tx: &mut Transaction, ..) -> Result<Id<X>>` = `tx.create(X::new(..))`
  (`tx.create` applies node replacement like `$applyNodeReplacement`). `$is*` guards are not ported as
  functions: use the core `is::<X>()`. They are listed in the mapping table for completeness.
- Setters on JS nodes (`setUrl`, `setLabel`, ..) become `pub` fields mutated through `tx.get_mut::<X>(k)`.
  Getters become field reads. The `rerender` argument of media setters and all
  `__componentDirty`/`__cachedDecorator*` fields are view caches: not ported.
- `exportComponentProps()` and the decorator prop types (`*DecoratorProps`) are view-only; the Rust
  struct fields are the props. `getDataAttrs()` moves into `lexical_html` with `exportDOM`.

---

#### EquationNode — `equation.rs`

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EquationNode {
    /// importJSON: `$createEquationNode(equation = '')` default param.
    #[serde(default)]
    pub equation: String,
    /// constructor `inline ?? false`.
    #[serde(default)]
    pub inline: bool,
}
impl EquationNode { pub const TYPE: &'static str = "equation"; pub const VERSION: u32 = 1; }
impl DecoratorNode for EquationNode {
    // is_inline: DecoratorNode default `true` (NOT overridden; block equations are still inline nodes
    // in the model — only createDOM picks div vs span).
    fn text_content(&self) -> Cow<'_, str> { Cow::Borrowed(&self.equation) }
}
impl ImportPolicy for EquationNode { const IMPORTED_STATE: ImportedState = ImportedState::Full; }
impl SearchText for EquationNode {}

pub fn create_equation_node(tx: &mut Transaction, equation: &str, inline: bool) -> Result<Id<EquationNode>>;
```

`{"type":"equation","version":1,"equation":"e^{i\\pi}+1=0","inline":false}`

View: createDOM (`div`/`span` by `inline`), updateDOM (replace when `inline` changes), decorate, importDOM.
exportDOM: Y — `lexical_html::js::btoa_or_utf8(equation)` (§3.4, Q7 fix): byte-identical `btoa` when every
UTF-16 unit is <= U+00FF; JS throws `InvalidCharacterError` otherwise, and Rust then encodes the UTF-8 bytes.

#### GroupMentionNode — `group_mention.rs`

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GroupMentionNode {
    #[serde(rename = "groupAlias")]
    pub group_alias: String,
}
impl GroupMentionNode { pub const TYPE: &'static str = "group-mention"; pub const VERSION: u32 = 1; }
impl DecoratorNode for GroupMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> Cow<'_, str> { format!("@{}", self.group_alias).into() }
}
impl ImportPolicy for GroupMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for GroupMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> { Some("".into()) }
}
pub fn create_group_mention_node(tx: &mut Transaction, group_alias: &str) -> Result<Id<GroupMentionNode>>;
```

`{"type":"group-mention","version":1,"groupAlias":"everyone"}`

View: createDOM (`span`), updateDOM, decorate, importDOM (`span[data-group-mention]`). exportDOM: Y
(`span` with `data-group-mention="true"`, `data-group-alias`, text `@alias`).

#### HorizontalRuleNode — `horizontal_rule.rs`

No `exportJSON` override: the inherited `LexicalNode.exportJSON` (`packages/lexical/src/LexicalNode.ts:1216`)
emits `{type, version: 1, $?}` only (`DecoratorBlockNode` adds nothing).

```rust
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HorizontalRuleNode {}   // block-decorator base (4.1a); format "" not serialized
impl HorizontalRuleNode { pub const TYPE: &'static str = "horizontalrule"; pub const VERSION: u32 = 1; }
impl DecoratorNode for HorizontalRuleNode {
    fn is_inline(&self) -> bool { false }
    // is_keyboard_selectable: default true
    fn text_content(&self) -> Cow<'_, str> { "\n".into() }
}
impl ImportPolicy for HorizontalRuleNode { const IMPORTED_STATE: ImportedState = ImportedState::Full; }
impl SearchText for HorizontalRuleNode {}
pub fn create_horizontal_rule_node(tx: &mut Transaction) -> Result<Id<HorizontalRuleNode>>;
```

`{"type":"horizontalrule","version":1}`

View: createDOM (`div`), updateDOM, decorate, importDOM (`hr`, priority 0). exportDOM: Y (`<hr>`).

#### HtmlRenderNode — `html_render.rs`

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HtmlRenderNode {           // block-decorator base, format "left" not serialized
    pub html: String,
    /// Display-only hint; `None` = decide from content.
    #[serde(rename = "adaptColors", default, skip_serializing_if = "Option::is_none")]
    pub adapt_colors: Option<bool>,
}
impl HtmlRenderNode { pub const TYPE: &'static str = "html-render"; pub const VERSION: u32 = 1; }
impl DecoratorNode for HtmlRenderNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> Cow<'_, str> { "".into() }
}
impl ImportPolicy for HtmlRenderNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for HtmlRenderNode {}
pub fn create_html_render_node(tx: &mut Transaction, html: String, adapt_colors: Option<bool>) -> Result<Id<HtmlRenderNode>>;
```

`{"type":"html-render","version":1,"html":"<p>hi</p>","adaptColors":true}`

View: createDOM, updateDOM, decorate, importDOM (`div[data-html-render]` or `.macro_html_render`; reads DSD
`template[shadowrootmode]`, `data-html` JSON, or innerHTML). exportDOM: Y (`div` host + class markers +
`<template shadowrootmode="open">` with raw html).

#### Media base + ImageNode + VideoNode — `media.rs`, `image.rs`, `video.rs`

`MediaNode<T>` is an abstract `DecoratorBlockNode` (format `"center"`). Model by composition: a
flattened `MediaData` in each concrete struct plus a `MediaNode` trait with default methods. No
`is::<MediaNode>` is needed (no code tests `instanceof MediaNode`; guards are per concrete class).

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaType { Image, Video }

/// Serialized MediaInfo. Field order = MediaNode.exportJSON order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MediaData {
    /// Absent in, absent out (`setSrcType(undefined)`, `MediaNode.ts:213-219`; §4.1a rule 2).
    #[serde(rename = "srcType", default, skip_serializing_if = "Option::is_none")]
    pub src_type: Option<String>,
    /// Media (storage) id; unrelated to the `$.id` node id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<JsNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<JsNumber>,
    /// updateFromJSON: `scale || 1` (0, NaN, missing -> 1).
    #[serde(default = "one", deserialize_with = "scale_or_one")]
    pub scale: JsNumber,
    #[serde(rename = "constrainedWidth", default, skip_serializing_if = "Option::is_none")]
    pub constrained_width: Option<JsNumber>,
    #[serde(rename = "constrainedHeight", default, skip_serializing_if = "Option::is_none")]
    pub constrained_height: Option<JsNumber>,
}

pub trait MediaNode: DecoratorNode {
    const MEDIA_TYPE: MediaType;
    fn media(&self) -> &MediaData;
    fn media_mut(&mut self) -> &mut MediaData;
    /// `getEffectiveDimensions`.
    fn effective_dimensions(&self) -> Dimensions {
        let m = self.media();
        // JS reads `undefined` here, and arithmetic on it gives NaN; `calculate_effective_dimensions` takes NaN.
        calculate_effective_dimensions(m.width.map_or(f64::NAN, |v| v.0), m.height.map_or(f64::NAN, |v| v.0),
            m.constrained_width.map(|v| v.0), m.constrained_height.map(|v| v.0))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dimensions { pub width: f64, pub height: f64 }

/// utils/media.ts. No constraint (None or 0 for both) -> unchanged; width/height <= 0 -> unchanged;
/// scale = min(cw/w, ch/h) with a missing/0 side = +inf; scale >= 1 or inf -> unchanged;
/// else round both with JS `Math.round` (`(x + 0.5).floor()`).
pub fn calculate_effective_dimensions(width: f64, height: f64, constrained_width: Option<f64>, constrained_height: Option<f64>) -> Dimensions;

pub enum LooseDimension<'a> { Str(&'a str), Num(f64) }
/// utils/media.ts. Strings go through JS `Number.parseInt(s, 10)` (skip leading JS whitespace,
/// optional sign, leading decimal digits, else NaN). Returns None when either side is
/// missing/NaN/0/negative.
pub fn constrain_image_dimensions(width: Option<LooseDimension<'_>>, height: Option<LooseDimension<'_>>, max_width: Option<f64>, max_height: Option<f64>) -> Option<Dimensions>;

/// `createSerializedMediaTypeGuard(t)`: `node["type"] == t`.
pub fn is_serialized_media_node(node: &serde_json::Value, media_type: MediaType) -> bool;
```

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImageNode {
    #[serde(flatten)]
    pub media: MediaData,
    /// updateFromJSON: `alt ?? ''`.
    #[serde(default)]
    pub alt: String,
}
impl ImageNode { pub const TYPE: &'static str = "image"; pub const VERSION: u32 = 1; }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VideoNode {
    #[serde(flatten)]
    pub media: MediaData,
    /// updateFromJSON: `controls ?? true`.
    #[serde(default = "yes")]
    pub controls: bool,
}
impl VideoNode { pub const TYPE: &'static str = "video"; pub const VERSION: u32 = 1; }

// Both:
impl DecoratorNode for ImageNode /* VideoNode */ {
    fn is_inline(&self) -> bool { false }            // DecoratorBlockNode
    fn is_keyboard_selectable(&self) -> bool { true } // MediaNode
    // text_content: LexicalNode default "" (not overridden)
}
impl MediaNode for ImageNode { const MEDIA_TYPE: MediaType = MediaType::Image; /* media()/media_mut() */ }
impl MediaNode for VideoNode { const MEDIA_TYPE: MediaType = MediaType::Video; }
impl ImportPolicy for ImageNode /* VideoNode */ { const IMPORTED_STATE: ImportedState = ImportedState::Full; }
impl SearchText for ImageNode /* VideoNode */ {}

pub struct CreateMedia { pub src_type: String, pub id: Option<String>, pub url: Option<String>,
    pub width: Option<f64>, pub height: Option<f64>, pub constrained_width: Option<f64>,
    pub constrained_height: Option<f64>, pub scale: Option<f64> }
/// Defaults: id/url/alt "", width/height 0, scale 1, controls true.
pub fn create_image_node(tx: &mut Transaction, media: CreateMedia, alt: Option<String>) -> Result<Id<ImageNode>>;
pub fn create_video_node(tx: &mut Transaction, media: CreateMedia, controls: Option<bool>) -> Result<Id<VideoNode>>;
pub fn is_serialized_image_node(node: &serde_json::Value) -> bool; // type == "image"
pub fn is_serialized_video_node(node: &serde_json::Value) -> bool; // type == "video"
```

`{"type":"image","version":1,"srcType":"sfs","id":"f1","url":"https://…","width":800,"height":600,"scale":1,"constrainedWidth":400,"alt":"diagram"}`
`{"type":"video","version":1,"srcType":"sfs","id":"v1","url":"https://…","width":1280,"height":720,"scale":1,"controls":true}`

Import semantics: `ImageNode.importJSON` runs `$createImageNode(serialized).updateFromJSON(serialized)`, and
`MediaNode.updateFromJSON` calls `setId(serialized.id)` etc. **without defaults**, so a missing `srcType`/
`id`/`url`/`width`/`height` key round-trips as missing in JS, and Rust's `Option` fields do the same (no
divergence). Data attributes and markdown that interpolate a missing field render `undefined`, as JS does
(§4.1a rule 2). `width`/`height`/`scale` must be
`JsNumber`: `f64` via serde_json writes `800.0` and breaks byte identity.

View: createDOM (`div`), updateDOM, decorate (+ cache), importDOM (`img`/`video` p1, wrapper `div` p2),
`getDOMElement`, `createNodeFromParams`. exportDOM: Y (wrapper `div` > `img`/`video` with `src`,
effective `width`/`height`, `data-src-type`, `data-{image|video}-id`, `data-scale`,
`data-constrained-*`; image adds `alt`, video adds `controls="true|false"`).

#### InlineSearchNode — `inline_search.rs`

TextNode subclass, no own fields. All base data lives in `TextData`.

```rust
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct InlineSearchNode {}
impl InlineSearchNode { pub const TYPE: &'static str = "inline-search"; pub const VERSION: u32 = 1; }
impl TextNode for InlineSearchNode {
    // No model-affecting overrides. `isInline()` (already true on TextNode) and
    // `isKeyboardSelectable()` (only consulted on DecoratorNode carets upstream) are inert.
}
impl ImportPolicy for InlineSearchNode { const IMPORTED_STATE: ImportedState = ImportedState::Full; }
impl SearchText for InlineSearchNode {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InlineSearchNodesType { Mentions, Emojis, Actions, Snippets, Tags }
impl InlineSearchNodesType {
    /// '@' ':' '/' ';' '#'
    pub const fn trigger(self) -> &'static str;
    /// SEARCH_NODE_TYPE_VALUES: "@@" "::" "//" ";;" "##"
    pub const fn doubled(self) -> &'static str;
}

/// `$createInlineSearchNode`: text `text.unwrap_or("")`; when the selection is a RangeSelection,
/// copy its `format` (not style) onto the node.
pub fn create_inline_search_node(tx: &mut Transaction, text: Option<&str>) -> Result<Id<InlineSearchNode>>;

/// `$handleInlineSearchNodeTransform`: if text starts with `ty.doubled()`, drop the first UTF-16 unit
/// and select the node's end. Called by the JS mention/emoji plugins' transforms.
pub fn handle_inline_search_node_transform(tx: &mut Transaction, id: Id<InlineSearchNode>, ty: InlineSearchNodesType) -> Result<()>;

/// `$collapseInlineSearch`: DFS from root; every InlineSearchNode passing `validator` (None = all)
/// is replaced by a plain `TextNode` with the same text. Format, style and `$` are NOT carried over.
/// Returns whether any node was replaced.
pub fn collapse_inline_search(tx: &mut Transaction, validator: Option<&PeerIdValidator>) -> Result<bool>;

/// `$removeInlineSearch`: same walk, removes matching nodes. Returns whether any was removed.
pub fn remove_inline_search(tx: &mut Transaction, validator: Option<&PeerIdValidator>) -> Result<bool>;

/// `validTriggerPosition` without the editor wrapper. False unless the selection is a RangeSelection
/// whose anchor node is not an InlineSearchNode and not inside a code node (`is_child_of_code`).
/// before-text: element anchor -> concatenated text_content of children[..offset]; text anchor ->
/// text[..offset] (UTF-16), and if that is "" use the previous sibling's whole text when it is a
/// TextNode. False if before-text ends with '`' or is non-empty and does not match `before`.
/// `after == None` -> true. after-text: children[offset..] / text[offset..]; true iff empty or matches.
/// Defaults: `before = /\s$/`, `after = Some(/^\s/)` (regress, ECMAScript `\s`).
pub fn valid_trigger_position(state: &EditorState, before: &regress::Regex, after: Option<&regress::Regex>) -> bool;
```

`{"detail":0,"format":0,"mode":"normal","style":"","text":"@jo","type":"inline-search","version":1}`

Text normalization: `isSimpleText()` is `__type === 'text' && __mode === 0`
(`packages/lexical/src/nodes/LexicalTextNode.ts:463`), so for this node it is always false. The core
`normalize_text_node` therefore (a) never merges it with a neighbour in either direction, (b) never
merges neighbours into it, and (c) never removes it when its text is `""`
(`packages/lexical/src/LexicalNormalization.ts:51-90`, `LexicalUpdates.ts:236`). The core must key
"simple text" on the exact registered type `"text"`, not on `NodeKind::Text`. Upstream autolink
(`LexicalAutoLinkExtension.ts:380,514,571`) and `$sliceSelectedText…` (`lexical-selection/src/lexical-node.ts:195-216`)
also skip non-simple text. No `isUnmergeable`/`isTextEntity`/`canInsertText*` overrides.

View: createDOM (theme class `inline-search`). `$handleInlineSearchNodeMutation` (mutation-listener
driven) stays in JS. exportDOM: N (inherits TextNode).

#### MagicChipNode — `magic_chip.rs`

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, strum::EnumString, strum::IntoStaticStr)]
#[serde(rename_all = "snake_case")] #[strum(serialize_all = "snake_case")]
pub enum MagicChipStatus { NoMessages, Booting, AcpReady, ShuttingDown, Disconnected }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, strum::EnumString)]
#[serde(rename_all = "lowercase")]
pub enum MagicChipAuthor { User, Agent }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MagicChipMessage { pub turn: u64, pub author: MagicChipAuthor }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MagicChipNode {
    #[serde(rename = "agentSessionId")]
    pub agent_session_id: String,
    /// Tri-state like `promptedMessage`: `MagicChipNode.ts:158-160` tests `=== undefined`, so a
    /// stored `null` round-trips as `null`. `serde_with::rust::double_option`.
    #[serde(rename = "channelId", default, skip_serializing_if = "Option::is_none", with = "serde_with::rust::double_option")]
    pub channel_id: Option<Option<String>>,
    /// Tri-state on the wire: absent (importJSON leaves it `undefined`, re-export omits it),
    /// `null` (follow latest turn), or a message. `serde_with::rust::double_option`.
    #[serde(rename = "promptedMessage", default, skip_serializing_if = "Option::is_none", with = "serde_with::rust::double_option")]
    pub prompted_message: Option<Option<MagicChipMessage>>,
    pub status: MagicChipStatus,
}
impl MagicChipNode { pub const TYPE: &'static str = "magic-chip"; pub const VERSION: u32 = 5; }
impl DecoratorNode for MagicChipNode {
    fn is_inline(&self) -> bool { false }   // block decorator without DecoratorBlockNode
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> Cow<'_, str> { <&'static str>::from(self.status).into() }
}
impl ImportPolicy for MagicChipNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for MagicChipNode {}

pub const MAGIC_CHIP_NODE_TYPE: &str = "magic-chip";
pub fn create_magic_chip_node(tx: &mut Transaction, data: MagicChipNode) -> Result<Id<MagicChipNode>>;
/// `isMagicChipMessage`: object with integer `turn >= 0` and valid `author`.
pub fn is_magic_chip_message(value: &serde_json::Value) -> bool;
// isMagicChipAuthor / isMagicChipStatus -> `MagicChipAuthor::from_str` / `MagicChipStatus::from_str`.
```

`{"type":"magic-chip","version":5,"agentSessionId":"s1","channelId":"c1","promptedMessage":{"turn":2,"author":"user"},"status":"acp_ready"}`

JS `importJSON` does not validate `status`/`promptedMessage`; Rust rejects unknown values with `Error`
(open item).

View: createDOM (`div[data-magic-chip]`), updateDOM, decorate (+ signature cache), importDOM (`null`).
exportDOM: Y (`div[data-magic-chip=<sessionId>]`, text = status).

#### PasteNode — `paste.rs`

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PasteOrigin { #[default] Pasted, Referenced }
/// `normalizePasteOrigin`: exactly "referenced" -> Referenced; anything else (missing, null,
/// other strings, non-strings) -> Pasted. Implement Deserialize via this.
impl<'de> Deserialize<'de> for PasteOrigin { /* lenient */ }
pub fn normalize_paste_origin(value: Option<&serde_json::Value>) -> PasteOrigin;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PasteNode {                 // block-decorator base, format "center" not serialized
    pub content: String,
    #[serde(default)]
    pub origin: PasteOrigin,           // always emitted
}
impl PasteNode { pub const TYPE: &'static str = "paste"; pub const VERSION: u32 = 1; }
impl DecoratorNode for PasteNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> Cow<'_, str> { Cow::Borrowed(&self.content) }
}
impl ImportPolicy for PasteNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for PasteNode {
    fn search_text(&self) -> Option<Cow<'_, str>> { Some(Cow::Borrowed(&self.content)) }
}

pub fn create_paste_node(tx: &mut Transaction, content: String, origin: PasteOrigin) -> Result<Id<PasteNode>>;

/// `$convertPasteToText`: replace the paste node with a fresh ParagraphNode, run
/// `lexical_markdown::convert_from_markdown_string(tx, content, &ALL_TRANSFORMERS, Some(wrapper), false)`
/// (shouldPreserveNewLines = false), remember the wrapper's last child, unwrap the wrapper
/// (`lexical_rich_nodes::utils::unwrap_node`), then select the end of that last child if any.
pub fn convert_paste_to_text(tx: &mut Transaction, id: Id<PasteNode>) -> Result<()>;

/// `$insertReferencedPaste`: trim with JS `String.prototype.trim` semantics (JS whitespace set,
/// includes U+FEFF; NOT `str::trim`); empty -> no-op. Create a Referenced paste node, insert before
/// root's first child (or append to empty root). Walk forward past consecutive PasteNodes; if the next
/// sibling is an element, select its end; otherwise insert a new ParagraphNode after the last paste
/// node and select its end.
pub fn insert_referenced_paste(tx: &mut Transaction, content: &str) -> Result<()>;
```

`{"type":"paste","version":1,"content":"long text…","origin":"pasted"}`

View: createDOM, updateDOM, decorate, importDOM (`div[data-paste-node]`, `data-content`,
`data-paste-origin`). exportDOM: Y (`div` with non-empty data attrs, text = content).

#### PullRequestMentionNode — `pull_request_mention.rs`

```rust
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PullRequestMentionNode {
    /// Macro foreign-entity id; "" when authored from a URL alone. Always emitted.
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(rename = "mentionUuid", skip_serializing_if = "Option::is_none")]
    pub mention_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}
/// Deserialize through `PullRequestMentionNode::new` (the JS constructor normalization).
impl<'de> Deserialize<'de> for PullRequestMentionNode { /* wire struct -> new() */ }
impl PullRequestMentionNode {
    pub const TYPE: &'static str = "pr-mention"; pub const VERSION: u32 = 1;
    /// If `is_github_pull_request_url(id)`: id = "" and url = url-if-non-empty else Some(id).
    /// Otherwise id kept and url = url-if-non-empty else None (JS `url || …`: "" counts as absent).
    pub fn new(id: String, label: Option<String>, mention_uuid: Option<String>, url: Option<String>) -> Self;
}
impl DecoratorNode for PullRequestMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    /// `label || 'Pull request'` ("" label -> fallback).
    fn text_content(&self) -> Cow<'_, str>;
}
impl ImportPolicy for PullRequestMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for PullRequestMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> { Some(self.text_content()) }
}
/// regress: `^https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*(?:[/?#]\S*)?$`
pub fn is_github_pull_request_url(url: &str) -> bool;
pub fn create_pull_request_mention_node(tx: &mut Transaction, id: String, label: Option<String>, mention_uuid: Option<String>, url: Option<String>) -> Result<Id<PullRequestMentionNode>>;
```

`{"type":"pr-mention","version":1,"id":"","label":"Fix login","url":"https://github.com/macro-inc/macro/pull/42"}`

View: createDOM, updateDOM, decorate, importDOM (`span|a[data-pr-mention]`; accepts id or GitHub URL).
exportDOM: Y (`span` with non-empty `data-pr-*`/`data-mention-uuid`, text = text_content).

#### ReplyTargetNode — `reply_target.rs`

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplyTargetParentType { Channel, Document, Initiative, CrmCompany, CrmContact, Call }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReplyTargetParent {
    #[serde(rename = "type")]
    pub kind: ReplyTargetParentType,
    pub id: String,                    // must be non-empty
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReplyTargetNode {
    pub parent: ReplyTargetParent,
    #[serde(rename = "targetMessageId")] pub target_message_id: String,
    #[serde(rename = "targetThreadId")]  pub target_thread_id: String,
    #[serde(rename = "displayText")]     pub display_text: String,
    #[serde(rename = "senderId")]        pub sender_id: String,
}
/// Via `read_reply_target_data`; invalid -> Error("invalid reply-target data") (JS throws).
impl<'de> Deserialize<'de> for ReplyTargetNode { /* ... */ }
impl ReplyTargetNode { pub const TYPE: &'static str = "reply-target"; pub const VERSION: u32 = 2; }
impl DecoratorNode for ReplyTargetNode {
    fn is_inline(&self) -> bool { false }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> Cow<'_, str> { Cow::Borrowed(&self.display_text) }
}
impl ImportPolicy for ReplyTargetNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for ReplyTargetNode {
    fn search_text(&self) -> Option<Cow<'_, str>> { Some(Cow::Borrowed(&self.display_text)) }
}

pub const REPLY_TARGET_NODE_TYPE: &str = "reply-target";
pub const REPLY_TARGET_NODE_TAG: &str = "m-reply-target";
/// `isReplyTargetData`: parent object with known type and non-empty string id; the four other
/// fields are strings.
pub fn is_reply_target_data(value: &serde_json::Value) -> bool;
/// `readReplyTargetData`: valid -> as is. Legacy (v1): no `parent` key and string `channelId` ->
/// drop `channelId`, set `parent = {type:"channel", id: channelId}`, re-validate. Else None.
pub fn read_reply_target_data(value: &serde_json::Value) -> Option<ReplyTargetNode>;
/// `<m-reply-target>{json}</m-reply-target>`, json = struct-order serialization with every `<`
/// replaced by `<`.
pub fn build_reply_target_markdown(data: &ReplyTargetNode) -> String;
/// Remove one leading match of regress `^\s*<m-reply-target>.*?<\/m-reply-target>\s*` (flag `s`).
pub fn strip_leading_reply_target_markdown(markdown: &str) -> String;
pub fn create_reply_target_node(tx: &mut Transaction, data: ReplyTargetNode) -> Result<Id<ReplyTargetNode>>;
```

`{"type":"reply-target","version":2,"parent":{"type":"channel","id":"ch1"},"targetMessageId":"m1","targetThreadId":"t1","displayText":"see above","senderId":"u1"}`

Notes: legacy `channelId` docs re-export in v2 shape. JS copies `parent` with `{...parent}`, so extra
keys inside `parent` survive in JS; Rust drops them (open item). `build_reply_target_markdown` uses
struct field order; JS uses the caller object's key order (all in-repo callers build it in struct order).

View: createDOM, updateDOM, decorate, importDOM (`null`). exportDOM: Y (`div[data-reply-target-node]`, text = displayText).

#### SearchMatchNode — `search_match.rs`

Subclass of `MarkNode` (both registered, not a replacement). JS `$isMarkNode(searchMatch)` is true, so
mark helpers (`$unwrapMarkNode`, `$wrapSelectionInMarkNode` merging, comment-only gate) treat it as a
mark. Model by composition plus the core subtype relation (`type Parent = MarkNode`, CR-2):

```rust
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SearchMatchNode {
    #[serde(flatten)]
    pub mark: lexical_rich_nodes::mark::MarkNode,   // `ids: Vec<String>`
}
/// Faithful to importJSON: `$createSearchMatchNode([])` without updateFromJSON. ElementData reset is
/// `IMPORT_ELEMENT_DATA = false` (the shared mechanism); the `ids` reset is `#[serde(from = "RawSearchMatch")]`
/// where `RawSearchMatch` ignores `ids`. Children are still appended by the parser.
impl From<RawSearchMatch> for SearchMatchNode { /* ids = [] */ }
impl SearchMatchNode { pub const TYPE: &'static str = "search-match"; pub const VERSION: u32 = 1; }
// NodeType: type Parent = MarkNode; as_parent(_mut) → self.mark (CR-2).
impl ElementNode for SearchMatchNode {
    // Inherited from MarkNode (is_inline true, can_be_empty false, can_insert_text_before/after
    // false, extract_with_child, exclude_from_copy). No own overrides.
}
impl ImportPolicy for SearchMatchNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdAndPeer;
    /// importJSON skips updateFromJSON: ElementData resets to defaults.
    const IMPORT_ELEMENT_DATA: bool = false;
}
impl SearchText for SearchMatchNode {}
pub fn create_search_match_node(tx: &mut Transaction, ids: Vec<String>) -> Result<Id<SearchMatchNode>>;
```

Registration: `.node::<SearchMatchNode>().extends::<SearchMatchNode, MarkNode>()` so `is::<MarkNode>`
and `get::<MarkNode>` (via `AsRef`) succeed, the same mechanism `.replace` uses. If the core spec has no
non-replacement subtype hook, this is an open item for it.

`{"children":[…],"direction":null,"format":"","indent":0,"type":"search-match","version":1,"ids":["q1"]}`

View: createDOM (adds theme `searchMatch` class). exportDOM: N (inherits MarkNode).

#### SnapshotNode — `snapshot.rs`

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SnapshotNode {
    #[serde(rename = "documentId")]   pub document_id: String,
    #[serde(rename = "documentName")] pub document_name: String,
    #[serde(rename = "blockName")]    pub block_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// JS constructor: `snapshotDate || new Date().toISOString()` (truthiness: missing **and** `""` are
    /// stamped). Always emitted. Rust stamps from the injected clock `tx.now_ms()` formatted as JS
    /// `toISOString()` (`YYYY-MM-DDTHH:mm:ss.sssZ`), in the CR-11 load hook and in the constructor.
    #[serde(rename = "snapshotDate", default)] pub snapshot_date: String,
    #[serde(rename = "mentionUuid", default, skip_serializing_if = "Option::is_none")]
    pub mention_uuid: Option<String>,
}
impl SnapshotNode { pub const TYPE: &'static str = "snapshot"; pub const VERSION: u32 = 1; }
impl DecoratorNode for SnapshotNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> Cow<'_, str> { Cow::Borrowed(&self.document_name) }
}
impl ImportPolicy for SnapshotNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for SnapshotNode {
    fn search_text(&self) -> Option<Cow<'_, str>> { Some(Cow::Borrowed(&self.document_name)) }
}
/// An empty `snapshot_date` is stamped from `tx.now_ms()`, as the JS constructor does.
pub fn create_snapshot_node(tx: &mut Transaction, node: SnapshotNode) -> Result<Id<SnapshotNode>>;
```

`{"type":"snapshot","version":1,"documentId":"d1","documentName":"Plan","blockName":"Goals","content":"…","snapshotDate":"2026-11-07T12:00:00.000Z"}`

Missing or empty `snapshotDate` on import: JS stamps "now"; Rust stamps from the same injected clock as
DocumentMention `createdAt` (Q3). Fixtures inject a fixed clock on both sides (Q20); nothing is masked.

View: createDOM, updateDOM, decorate, importDOM (`span[data-snapshot-node]`). exportDOM: Y (non-empty
data attrs, text = documentName).

#### TagMentionNode — `tag_mention.rs`

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TagScope { User, Team }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TagMentionNode {
    #[serde(rename = "optionId")]             pub option_id: String,
    #[serde(rename = "propertyDefinitionId")] pub property_definition_id: String,
    pub scope: TagScope,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}
impl TagMentionNode {
    pub const TYPE: &'static str = "tag-mention"; pub const VERSION: u32 = 1;
    /// `setTagInfo`: overwrite everything except `option_id`.
    pub fn set_tag_info(&mut self, property_definition_id: String, scope: TagScope, name: String, color: Option<String>);
}
impl DecoratorNode for TagMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> Cow<'_, str> { Cow::Borrowed(&self.name) }
}
impl ImportPolicy for TagMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for TagMentionNode {}
pub fn create_tag_mention_node(tx: &mut Transaction, node: TagMentionNode) -> Result<Id<TagMentionNode>>;
```

`{"type":"tag-mention","version":1,"optionId":"o1","propertyDefinitionId":"p1","scope":"team","name":"urgent","color":"#f00"}`

View: createDOM, updateDOM, decorate, importDOM (`span[data-tag-mention]`, scope must be user|team).
exportDOM: Y (`data-tag-*`, color only when truthy, text = name).

#### TaskListNode — `task_list.rs`

Replacement for `lexical_rich_nodes::list::ListNode` (`NodeReplacements`, `packages/lexical-core/node-list.ts:141`).
No `exportJSON` override: the inherited `ListNode.exportJSON` (`packages/lexical-list/src/LexicalListNode.ts:179`)
emits ElementNode keys + `listType`, `start`, `tag`, with `type` = `"task-list"`. Legacy `"list"` nodes
deserialize into TaskListNode through the replacement and re-export as `"task-list"`.

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TaskListNode {
    #[serde(flatten)]
    pub list: lexical_rich_nodes::list::ListNode,   // list_type, start, tag (tag derived from list_type)
}
impl TaskListNode { pub const TYPE: &'static str = "task-list"; pub const VERSION: u32 = 1; }
/// NodeReplacements `with`: `new TaskListNode(node.getListType(), node.getStart())`.
impl From<ListNode> for TaskListNode { fn from(list: ListNode) -> Self; }
// NodeType: type Parent = ListNode; as_parent(_mut) → self.list (CR-2).
impl ElementNode for TaskListNode {
    // Inherited from ListNode (can_be_empty false, can_indent false, …). No model-affecting overrides.
}
impl ImportPolicy for TaskListNode { const IMPORTED_STATE: ImportedState = ImportedState::Full; }
impl SearchText for TaskListNode {}

/// Persisted view settings, stored in NodeState `$.taskListView`. Unknown keys preserved.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TaskListViewSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<TaskListFilters>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TaskListFilters {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub status: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub priority: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub assignees: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub due: Option<Vec<String>>,
    #[serde(flatten)] pub extra: serde_json::Map<String, serde_json::Value>,
}
/// `createState('taskListView', parse)`: non-null, non-array object -> Some; anything else -> None.
pub static TASK_LIST_VIEW: StateKey<TaskListViewSettings>;
pub fn get_task_list_view_settings(state: &EditorState, key: NodeKey) -> Option<TaskListViewSettings>;
pub fn set_task_list_view_settings(tx: &mut Transaction, key: NodeKey, settings: Option<TaskListViewSettings>) -> Result<()>;
pub const TASK_LIST_BAR_CLASS: &str = "mdtl-bar-mount";
```

`StateKey` (not a typed field) because the value lives in the `$` bag on the wire and the setter
accepts any `LexicalNode`.

Transforms: `getTransformSetFromKlass` walks the prototype chain, so ListNode's `$config` `$transform`
(`mergeNextSiblingListIfSameType` + `updateChildrenListItemValue`, `LexicalListNode.ts:63`) also runs on
TaskListNode. The Rust ListNode transform must fire for nodes where `is::<ListNode>` holds.

`{"children":[…],"direction":null,"format":"","indent":0,"type":"task-list","version":1,"$":{"taskListView":{"filters":{"status":["todo"]}}},"listType":"check","start":1,"tag":"ul"}`

View: createDOM (bar mount for `check`), getDOMSlot, importDOM (= ListNode's). exportDOM: Y (ListNode's;
removing the bar is a no-op in `lexical_html`, which never creates it).

#### ThemeMentionNode — `theme_mention.rs`

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThemeMentionNode {
    pub name: String,
    /// Arbitrary object. serde_json `preserve_order`; numbers must re-serialize JS-style (see JsNumber).
    pub data: serde_json::Map<String, serde_json::Value>,
}
impl ThemeMentionNode { pub const TYPE: &'static str = "theme-mention"; pub const VERSION: u32 = 1; }
impl DecoratorNode for ThemeMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> Cow<'_, str> { Cow::Borrowed(&self.name) }
}
impl ImportPolicy for ThemeMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for ThemeMentionNode {}
pub fn create_theme_mention_node(tx: &mut Transaction, name: String, data: serde_json::Map<String, serde_json::Value>) -> Result<Id<ThemeMentionNode>>;
```

`{"type":"theme-mention","version":1,"name":"Dusk","data":{"name":"Dusk","accent":"#7a5"}}`

JS objects order integer-like keys first; `preserve_order` does not, so byte identity holds only for
non-numeric keys.

View: createDOM, updateDOM, decorate, importDOM (`span[data-theme-mention]` + `data-theme-json`).
exportDOM: Y (`data-theme-json` = JSON of data, text = name).

#### UnknownMentionNode — `unknown_mention.rs`

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UnknownMentionNode { pub name: String }
impl UnknownMentionNode { pub const TYPE: &'static str = "unknown-mention"; pub const VERSION: u32 = 1; }
impl DecoratorNode for UnknownMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    fn text_content(&self) -> Cow<'_, str> { "".into() }
}
impl ImportPolicy for UnknownMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for UnknownMentionNode {}
pub fn create_unknown_mention_node(tx: &mut Transaction, name: String) -> Result<Id<UnknownMentionNode>>;
```

`{"type":"unknown-mention","version":1,"name":"Unknown Link"}`

View: createDOM, updateDOM, decorate, importDOM (`div[data-unknown-mention]`, name default `"unknown"`).
exportDOM: Y (`div[data-unknown-mention][data-name]`, no text).

#### UnlinkedTextNode — `unlinked_text.rs`

TextNode subclass, no own fields; keeps URL-shaped text inert.

```rust
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct UnlinkedTextNode {}
impl UnlinkedTextNode {
    pub const TYPE: &'static str = "unlinked-text"; pub const VERSION: u32 = 1;
    /// `isUnlinked()`; no callers, kept for parity.
    pub const fn is_unlinked(&self) -> bool { true }
}
impl TextNode for UnlinkedTextNode {}
impl ImportPolicy for UnlinkedTextNode { const IMPORTED_STATE: ImportedState = ImportedState::Full; }
impl SearchText for UnlinkedTextNode {}
/// `$createUnlinkedTextNode`: text default ""; copy RangeSelection `format` when present.
pub fn create_unlinked_text_node(tx: &mut Transaction, text: Option<&str>) -> Result<Id<UnlinkedTextNode>>;
```

`{"detail":0,"format":1,"mode":"normal","style":"","text":"example.com","type":"unlinked-text","version":1}`

Normalization and autolink: same as InlineSearchNode. `isSimpleText()` is false, so the node is never
merged or empty-removed, and upstream autolink skips it; that is the whole "inert" mechanism. The
markdown `LINK_XML`/`UNLINKED_TEXT` transformers (`packages/lexical-core/transformers/transformers.ts:242,293`)
special-case it (4.x transformers section).

View: createDOM (= TextNode), importDOM (`null`). exportDOM: N (delegates to TextNode).

#### UserMentionNode — `user_mention.rs`

```rust
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct UserMentionNode {
    #[serde(rename = "userId")]      pub user_id: String,
    pub email: String,
    /// Always emitted; normalized on construction.
    #[serde(rename = "displayName")] pub display_name: String,
    #[serde(rename = "mentionUuid", skip_serializing_if = "Option::is_none")]
    pub mention_uuid: Option<String>,
}
impl<'de> Deserialize<'de> for UserMentionNode { /* wire struct -> new() */ }
impl UserMentionNode {
    pub const TYPE: &'static str = "user-mention"; pub const VERSION: u32 = 1;
    /// display_name = given if non-empty, else `email.split('@')[0]` if non-empty, else `email`.
    pub fn new(user_id: String, email: String, display_name: Option<String>, mention_uuid: Option<String>) -> Self;
}
impl DecoratorNode for UserMentionNode {
    fn is_inline(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { true }
    /// `@{display_name}`, or "" when display_name is empty (only when email is "").
    fn text_content(&self) -> Cow<'_, str>;
}
impl ImportPolicy for UserMentionNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for UserMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> { Some("".into()) }
}
pub fn create_user_mention_node(tx: &mut Transaction, user_id: String, email: String, display_name: Option<String>, mention_uuid: Option<String>) -> Result<Id<UserMentionNode>>;
```

`{"type":"user-mention","version":1,"userId":"u1","email":"user@example.com","displayName":"Example User","mentionUuid":"m-1"}`

View: createDOM, updateDOM, decorate, importDOM (`span[data-user-mention]`). exportDOM: Y
(`data-user-mention`, `data-user-id`, `data-email`, `data-display-name`, `data-mention-uuid` always set,
text = text_content).

#### WatermarkNode — `watermark.rs`

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WatermarkNode { pub content: String }
impl WatermarkNode { pub const TYPE: &'static str = "watermark"; pub const VERSION: u32 = 1; }
impl DecoratorNode for WatermarkNode {
    fn is_inline(&self) -> bool { true }
    fn is_isolated(&self) -> bool { true }
    fn is_keyboard_selectable(&self) -> bool { false }
    fn text_content(&self) -> Cow<'_, str> { Cow::Borrowed(&self.content) }
    /// `remove()` is overridden to a no-op: every upstream path that calls `node.remove()`
    /// (selection deletion, `$removeNode` callers via the method, unwrap, …) leaves it in place.
    fn removable(&self) -> bool { false }
}
impl ImportPolicy for WatermarkNode { const IMPORTED_STATE: ImportedState = ImportedState::IdOnly; }
impl SearchText for WatermarkNode {}

pub fn create_watermark_node(tx: &mut Transaction, content: String) -> Result<Id<WatermarkNode>>;
/// `forceRemove`: remove bypassing `removable()`.
pub fn force_remove_watermark(tx: &mut Transaction, id: Id<WatermarkNode>) -> Result<()>;
/// Model half of `$appendWatermarkNodeToLast`: `None`/"" content -> Ok(None). Otherwise insert a new
/// watermark after root's last child (an inline node at root level); empty root -> node is not
/// attached, Ok(None). The returned id is what the JS cleanup closure force-removes.
pub fn append_watermark_node_to_last(tx: &mut Transaction, content: Option<&str>) -> Result<Option<Id<WatermarkNode>>>;
```

(R2) Watermark's no-op `remove()` is a CR-1 mutator override (satisfied by S1 §3.2); there is no
separate `removable()` hook. `$removeAllWatermarkNodes` (mutation listener) and the `editor.update`/`discrete` wrappers stay in JS.

`{"type":"watermark","version":1,"content":"Made with Macro"}`

View: createDOM, updateDOM, decorate, importDOM (`span[data-watermark]`). exportDOM: Y (`span.macro-watermark-node`
with `data-watermark`, `data-content`, text = content).

---

#### Node mapping table

Presets (`packages/lexical-core/node-list.ts:158`): **md** = markdown, **sync** = markdown-sync, **chat**
(all except Video), **cal** = calendar (all except HtmlRender, Image, Video), **title** = Paragraph, Text,
InlineSearch. plain-text has none of these nodes.

| Rust struct | TS class | file:line (class decl) | kind | registered in presets |
| --- | --- | --- | --- | --- |
| `EquationNode` | EquationNode | `packages/lexical-core/nodes/EquationNode.ts:45` | decorator (inline) | md, sync, chat, cal |
| `GroupMentionNode` | GroupMentionNode | `packages/lexical-core/nodes/GroupMentionNode.ts:31` | decorator (inline) | md, sync, chat, cal |
| `HorizontalRuleNode` | HorizontalRuleNode | `packages/lexical-core/nodes/HorizontalRuleNode.ts:21` | decorator block | md, sync, chat, cal |
| `HtmlRenderNode` | HtmlRenderNode | `packages/lexical-core/nodes/HtmlRenderNode.ts:33` | decorator block | md, sync, chat |
| `MediaData` + `trait MediaNode` | MediaNode (abstract) | `packages/lexical-core/nodes/MediaNode.ts:30` | decorator block base | not registered |
| `ImageNode` | ImageNode | `packages/lexical-core/nodes/ImageNode.ts:28` | decorator block (media) | md, sync, chat |
| `VideoNode` | VideoNode | `packages/lexical-core/nodes/VideoNode.ts:28` | decorator block (media) | md, sync |
| `InlineSearchNode` | InlineSearchNode | `packages/lexical-core/nodes/InlineSearchNode.ts:131` | text | md, sync, chat, cal, title |
| `MagicChipNode` | MagicChipNode | `packages/lexical-core/nodes/MagicChipNode.ts:90` | decorator (block) | md, sync, chat, cal |
| `PasteNode` | PasteNode | `packages/lexical-core/nodes/PasteNode.ts:57` | decorator block | md, sync, chat, cal |
| `PullRequestMentionNode` | PullRequestMentionNode | `packages/lexical-core/nodes/PullRequestMentionNode.ts:49` | decorator (inline) | md, sync, chat, cal |
| `ReplyTargetNode` | ReplyTargetNode | `packages/lexical-core/nodes/ReplyTargetNode.ts:102` | decorator (block) | md, sync, chat, cal |
| `SearchMatchNode` | SearchMatchNode | `packages/lexical-core/nodes/SearchMatchNode.ts:18` | element (MarkNode subtype) | md, sync, chat, cal |
| `SnapshotNode` | SnapshotNode | `packages/lexical-core/nodes/SnapshotNode.ts:37` | decorator (inline) | md, sync, chat, cal |
| `TagMentionNode` | TagMentionNode | `packages/lexical-core/nodes/TagMentionNode.ts:37` | decorator (inline) | md, sync, chat, cal |
| `TaskListNode` | TaskListNode | `packages/lexical-core/nodes/TaskListNode.ts:61` | element (replaces ListNode) | md, sync, chat, cal (+ replacement where `NodeReplacements` is spread) |
| `ThemeMentionNode` | ThemeMentionNode | `packages/lexical-core/nodes/ThemeMentionNode.ts:34` | decorator (inline) | md, sync, chat, cal |
| `UnknownMentionNode` | UnknownMentionNode | `packages/lexical-core/nodes/UnknownMentionNode.ts:33` | decorator (inline) | md, sync, chat, cal |
| `UnlinkedTextNode` | UnlinkedTextNode | `packages/lexical-core/nodes/UnlinkedTextNode.ts:24` | text | md, sync, chat, cal |
| `UserMentionNode` | UserMentionNode | `packages/lexical-core/nodes/UserMentionNode.ts:42` | decorator (inline) | md, sync, chat, cal |
| `WatermarkNode` | WatermarkNode | `packages/lexical-core/nodes/WatermarkNode.ts:34` | decorator (inline, isolated) | md, sync, chat, cal |

#### Function / item mapping table

| Rust item | Ports | Source (file:line) | Notes |
| --- | --- | --- | --- |
| `create_equation_node` | `$createEquationNode` | `packages/lexical-core/nodes/EquationNode.ts:154` | |
| `is::<EquationNode>` | `$isEquationNode` | `packages/lexical-core/nodes/EquationNode.ts:162` | core guard |
| `create_group_mention_node` | `$createGroupMentionNode` | `packages/lexical-core/nodes/GroupMentionNode.ts:158` | |
| `is::<GroupMentionNode>` | `$isGroupMentionNode` | `packages/lexical-core/nodes/GroupMentionNode.ts:163` | |
| `create_horizontal_rule_node` | `$createHorizontalRuleNode` | `packages/lexical-core/nodes/HorizontalRuleNode.ts:86` | |
| `is::<HorizontalRuleNode>` | `$isHorizontalRuleNode` | `packages/lexical-core/nodes/HorizontalRuleNode.ts:90` | |
| `create_html_render_node` | `$createHtmlRenderNode` | `packages/lexical-core/nodes/HtmlRenderNode.ts:178` | |
| `is::<HtmlRenderNode>` | `$isHtmlRenderNode` | `packages/lexical-core/nodes/HtmlRenderNode.ts:183` | |
| `MediaNode::effective_dimensions` | `MediaNode.getEffectiveDimensions` | `packages/lexical-core/nodes/MediaNode.ts:161` | |
| `is::<ImageNode>` / `is::<VideoNode>` | `createMediaTypeGuard` | `packages/lexical-core/nodes/MediaNode.ts:240` | generic guard factory, not ported |
| `is_serialized_media_node` | `createSerializedMediaTypeGuard` | `packages/lexical-core/nodes/MediaNode.ts:246` | |
| `calculate_effective_dimensions` | `calculateEffectiveDimensions` | `packages/lexical-core/utils/media.ts:21` | JS `Math.round` |
| `constrain_image_dimensions` | `constrainImageDimensions` | `packages/lexical-core/utils/media.ts:5` | JS `parseInt` semantics |
| `create_image_node` | `$createImageNode` | `packages/lexical-core/nodes/ImageNode.ts:270` | |
| `is::<ImageNode>` | `$isImageNode` | `packages/lexical-core/nodes/ImageNode.ts:296` | |
| `is_serialized_image_node` | `isSerializedImageNode` | `packages/lexical-core/nodes/ImageNode.ts:297` | |
| `create_video_node` | `$createVideoNode` | `packages/lexical-core/nodes/VideoNode.ts:278` | |
| `is::<VideoNode>` | `$isVideoNode` | `packages/lexical-core/nodes/VideoNode.ts:304` | |
| `is_serialized_video_node` | `isSerializedVideoNode` | `packages/lexical-core/nodes/VideoNode.ts:305` | |
| `InlineSearchNodesType` | `InlineSearchNodesType` | `packages/lexical-core/nodes/InlineSearchNode.ts:33` | enum |
| `InlineSearchNodesType::doubled` | `SEARCH_NODE_TYPE_VALUES` | `packages/lexical-core/nodes/InlineSearchNode.ts:41` | |
| `valid_trigger_position` | `validTriggerPosition` (+ `$textBeforeCaret`) | `packages/lexical-core/nodes/InlineSearchNode.ts:77` (`:54`) | takes `&EditorState` |
| `handle_inline_search_node_transform` | `$handleInlineSearchNodeTransform` | `packages/lexical-core/nodes/InlineSearchNode.ts:176` | |
| `create_inline_search_node` | `$createInlineSearchNode` | `packages/lexical-core/nodes/InlineSearchNode.ts:234` | copies selection format |
| `is::<InlineSearchNode>` | `$isInlineSearchNode` | `packages/lexical-core/nodes/InlineSearchNode.ts:243` | |
| `collapse_inline_search` | `$collapseInlineSearch` | `packages/lexical-core/nodes/InlineSearchNode.ts:253` | drops format |
| `remove_inline_search` | `$removeInlineSearch` | `packages/lexical-core/nodes/InlineSearchNode.ts:271` | |
| `MAGIC_CHIP_NODE_TYPE` | `MAGIC_CHIP_NODE_TYPE` | `packages/lexical-core/nodes/MagicChipNode.ts:18` | |
| `MagicChipStatus` | `MAGIC_CHIP_STATUSES` / `MagicChipStatus` | `packages/lexical-core/nodes/MagicChipNode.ts:21` | |
| `MagicChipAuthor` | `MAGIC_CHIP_AUTHORS` / `MagicChipAuthor` | `packages/lexical-core/nodes/MagicChipNode.ts:33` | |
| `MagicChipAuthor::from_str` | `isMagicChipAuthor` | `packages/lexical-core/nodes/MagicChipNode.ts:68` | |
| `is_magic_chip_message` | `isMagicChipMessage` | `packages/lexical-core/nodes/MagicChipNode.ts:73` | |
| `MagicChipStatus::from_str` | `isMagicChipStatus` | `packages/lexical-core/nodes/MagicChipNode.ts:85` | |
| `create_magic_chip_node` | `$createMagicChipNode` | `packages/lexical-core/nodes/MagicChipNode.ts:213` | |
| `is::<MagicChipNode>` | `$isMagicChipNode` | `packages/lexical-core/nodes/MagicChipNode.ts:225` | |
| `PasteOrigin` | `PASTE_ORIGINS` / `DEFAULT_PASTE_ORIGIN` | `packages/lexical-core/nodes/PasteNode.ts:24`, `:26` | |
| `normalize_paste_origin` | `normalizePasteOrigin` | `packages/lexical-core/nodes/PasteNode.ts:46` | |
| `create_paste_node` | `$createPasteNode` | `packages/lexical-core/nodes/PasteNode.ts:207` | |
| `is::<PasteNode>` | `$isPasteNode` | `packages/lexical-core/nodes/PasteNode.ts:215` | |
| `convert_paste_to_text` | `$convertPasteToText` | `packages/lexical-core/nodes/PasteNode.ts:228` | uses markdown import |
| `insert_referenced_paste` | `$insertReferencedPaste` | `packages/lexical-core/nodes/PasteNode.ts:244` | JS `trim` |
| `is_github_pull_request_url` | `isGithubPullRequestUrl` | `packages/lexical-core/nodes/PullRequestMentionNode.ts:35` | regress |
| `PullRequestMentionNode::new` | constructor | `packages/lexical-core/nodes/PullRequestMentionNode.ts:79` | URL-in-id normalization |
| `create_pull_request_mention_node` | `$createPullRequestMentionNode` | `packages/lexical-core/nodes/PullRequestMentionNode.ts:248` | |
| `is::<PullRequestMentionNode>` | `$isPullRequestMentionNode` | `packages/lexical-core/nodes/PullRequestMentionNode.ts:258` | |
| `REPLY_TARGET_NODE_TYPE` / `_TAG` | same | `packages/lexical-core/nodes/ReplyTargetNode.ts:18`, `:19` | |
| `ReplyTargetParentType` | `REPLY_TARGET_PARENT_TYPES` | `packages/lexical-core/nodes/ReplyTargetNode.ts:21` | |
| `is_reply_target_data` | `isReplyTargetData` | `packages/lexical-core/nodes/ReplyTargetNode.ts:45` | |
| `read_reply_target_data` | `readReplyTargetData` | `packages/lexical-core/nodes/ReplyTargetNode.ts:62` | legacy `channelId` |
| `build_reply_target_markdown` | `buildReplyTargetMarkdown` | `packages/lexical-core/nodes/ReplyTargetNode.ts:75` | |
| `strip_leading_reply_target_markdown` | `stripLeadingReplyTargetMarkdown` | `packages/lexical-core/nodes/ReplyTargetNode.ts:81` | regress, `s` flag |
| `create_reply_target_node` | `$createReplyTargetNode` | `packages/lexical-core/nodes/ReplyTargetNode.ts:223` | |
| `is::<ReplyTargetNode>` | `$isReplyTargetNode` | `packages/lexical-core/nodes/ReplyTargetNode.ts:236` | |
| `create_search_match_node` | `$createSearchMatchNode` | `packages/lexical-core/nodes/SearchMatchNode.ts:8` | |
| `is::<SearchMatchNode>` | `$isSearchMatchNode` | `packages/lexical-core/nodes/SearchMatchNode.ts:14` | |
| `create_snapshot_node` | `$createSnapshotNode` | `packages/lexical-core/nodes/SnapshotNode.ts:279` | caller supplies date |
| `is::<SnapshotNode>` | `$isSnapshotNode` | `packages/lexical-core/nodes/SnapshotNode.ts:291` | |
| `TagMentionNode::set_tag_info` | `setTagInfo` | `packages/lexical-core/nodes/TagMentionNode.ts:208` | |
| `create_tag_mention_node` | `$createTagMentionNode` | `packages/lexical-core/nodes/TagMentionNode.ts:234` | |
| `is::<TagMentionNode>` | `$isTagMentionNode` | `packages/lexical-core/nodes/TagMentionNode.ts:245` | |
| `TASK_LIST_VIEW` | `taskListViewState` | `packages/lexical-core/nodes/TaskListNode.ts:27` | StateKey `taskListView` |
| `get_task_list_view_settings` | `$getTaskListViewSettings` | `packages/lexical-core/nodes/TaskListNode.ts:34` | |
| `set_task_list_view_settings` | `$setTaskListViewSettings` | `packages/lexical-core/nodes/TaskListNode.ts:40` | |
| `TASK_LIST_BAR_CLASS` | `TASK_LIST_BAR_CLASS` | `packages/lexical-core/nodes/TaskListNode.ts:48` | for lexical_html/JS parity |
| `From<ListNode> for TaskListNode` | `NodeReplacements[1].with` | `packages/lexical-core/node-list.ts:141` | |
| `is::<TaskListNode>` | `$isTaskListNode` | `packages/lexical-core/nodes/TaskListNode.ts:113` | |
| `create_theme_mention_node` | `$createThemeMentionNode` | `packages/lexical-core/nodes/ThemeMentionNode.ts:164` | |
| `is::<ThemeMentionNode>` | `$isThemeMentionNode` | `packages/lexical-core/nodes/ThemeMentionNode.ts:172` | |
| `create_unknown_mention_node` | `$createUnknownMentionNode` | `packages/lexical-core/nodes/UnknownMentionNode.ts:148` | |
| `is::<UnknownMentionNode>` | `$isUnknownMentionNode` | `packages/lexical-core/nodes/UnknownMentionNode.ts:155` | |
| `is::<UnlinkedTextNode>` | `$isUnlinkedTextNode` | `packages/lexical-core/nodes/UnlinkedTextNode.ts:62` | |
| `create_unlinked_text_node` | `$createUnlinkedTextNode` | `packages/lexical-core/nodes/UnlinkedTextNode.ts:68` | copies selection format |
| `UserMentionNode::new` | constructor (+ `getEmailLocalPart`) | `packages/lexical-core/nodes/UserMentionNode.ts:86` (`:38`) | |
| `create_user_mention_node` | `$createUserMentionNode` | `packages/lexical-core/nodes/UserMentionNode.ts:254` | |
| `is::<UserMentionNode>` | `$isUserMentionNode` | `packages/lexical-core/nodes/UserMentionNode.ts:267` | |
| `WatermarkNode::removable` | `remove()` no-op | `packages/lexical-core/nodes/WatermarkNode.ts:142` | core hook |
| `force_remove_watermark` | `forceRemove` | `packages/lexical-core/nodes/WatermarkNode.ts:145` | |
| `create_watermark_node` | `$createWatermarkNode` | `packages/lexical-core/nodes/WatermarkNode.ts:166` | |
| `is::<WatermarkNode>` | `$isWatermarkNode` | `packages/lexical-core/nodes/WatermarkNode.ts:171` | |
| `append_watermark_node_to_last` | `$appendWatermarkNodeToLast` | `packages/lexical-core/nodes/WatermarkNode.ts:198` | model half only |
| `SearchText::search_text` | `getSearchText` | `GroupMentionNode.ts:131`, `PasteNode.ts:171`, `PullRequestMentionNode.ts:197`, `ReplyTargetNode.ts:206`, `SnapshotNode.ts:203`, `UserMentionNode.ts:201` | all under `packages/lexical-core/nodes/` |

#### Not ported (stays in JS view, or moves to `lexical_html`)

All paths under `packages/lexical-core/nodes/`.

- `createDOM` / `updateDOM` / `decorate`: EquationNode.ts:80,119,141; GroupMentionNode.ts:80,85,144; HorizontalRuleNode.ts:54,67,71; HtmlRenderNode.ts:83,90,164; MediaNode.ts:170,174,205; ImageNode.ts:230; VideoNode.ts:234; InlineSearchNode.ts:148; MagicChipNode.ts:166,172,191; PasteNode.ts:111,118,193; PullRequestMentionNode.ts:128,134,232; ReplyTargetNode.ts:181,187,210; SearchMatchNode.ts:23; SnapshotNode.ts:127,133,261; TagMentionNode.ts:120,126,217; TaskListNode.ts:81; ThemeMentionNode.ts:88,94,149; UnknownMentionNode.ts:82,87,134; UnlinkedTextNode.ts:37; UserMentionNode.ts:140,145,241; WatermarkNode.ts:87,92,153.
- `importDOM`: EquationNode.ts:96; GroupMentionNode.ts:96; HorizontalRuleNode.ts:41; HtmlRenderNode.ts:94; ImageNode.ts:139; VideoNode.ts:143; MagicChipNode.ts:183; PasteNode.ts:122; PullRequestMentionNode.ts:138; ReplyTargetNode.ts:198; SnapshotNode.ts:137; TagMentionNode.ts:130; TaskListNode.ts:77; ThemeMentionNode.ts:98; UnknownMentionNode.ts:91; UnlinkedTextNode.ts:46; UserMentionNode.ts:159; WatermarkNode.ts:103.
- `getDOMSlot` (task-list bar mount): TaskListNode.ts:106. `getDOMElement`: ImageNode.ts:77, VideoNode.ts:79. `createNodeFromParams`: ImageNode.ts:243, VideoNode.ts:251.
- `exportComponentProps` / decorator prop types: GroupMentionNode.ts:74; HtmlRenderNode.ts:76; ImageNode.ts:254; VideoNode.ts:262; MagicChipNode.ts:155; PasteNode.ts:104; PullRequestMentionNode.ts:119; ReplyTargetNode.ts:163; SnapshotNode.ts:116; TagMentionNode.ts:110; ThemeMentionNode.ts:81; UnknownMentionNode.ts:76; WatermarkNode.ts:81.
- Decorator caches (`__componentDirty`, `__cachedDecoratorComponent`, `__cachedDecoratorSignature`): MediaNode.ts:40-42; MagicChipNode.ts:98-99.
- `$handleInlineSearchNodeMutation` (mutation listener): InlineSearchNode.ts:192.
- `$removeAllWatermarkNodes` (mutation listener): WatermarkNode.ts:177; `editor.update` wrapper and cleanup closure of `$appendWatermarkNodeToLast`: WatermarkNode.ts:205-233.
- Moves to `lexical_html` (exportDOM + `getDataAttrs`): EquationNode.ts:87; GroupMentionNode.ts:89,118; HorizontalRuleNode.ts:50; HtmlRenderNode.ts:135; MediaNode.ts:178; ImageNode.ts:131; VideoNode.ts:133; MagicChipNode.ts:176; PasteNode.ts:147,155; PullRequestMentionNode.ts:171,181; ReplyTargetNode.ts:191; SnapshotNode.ts:175,187; TagMentionNode.ts:169; TaskListNode.ts:95; ThemeMentionNode.ts:129; UnknownMentionNode.ts:114; UnlinkedTextNode.ts:42; UserMentionNode.ts:149,188; WatermarkNode.ts:96,127.

#### Open items

1. (R2, closed) Subtype relation: CR-2 (`Parent` on the kind trait, R2-38). WatermarkNode's no-op `remove()`: CR-1 (a `common_node_hooks!` override in `impl DecoratorNode for WatermarkNode`).
2. "Simple text" in core normalization must be keyed on type `"text"` + mode normal, so
   InlineSearchNode, UnlinkedTextNode and DiffTextNode are never merged or empty-pruned.
3. (R2: owner S4 §3.6 corpus; default: divergence kept, ledger entries `divergence-magic-chip-status`
   and `divergence-reply-target-parent-keys`, scans `corpus::scan_magic_chip_status` and
   `corpus::scan_reply_target_parent_keys`.) Divergences from JS: strict enums (`MagicChipNode.status`);
   extra keys inside `ReplyTargetNode.parent` are dropped. (Missing `MediaData` keys and `snapshotDate` are
   no longer divergences: rule 2 and the injected clock.)
4. `ImportPolicy` reproduces how JS drops `$` keys on import. Decided (Q5): M1 keeps that loss while any JS
   writer is live.
### 4.2 Markdown transformers (macro_document_model::transformers)

Source of truth: `packages/lexical-core/transformers/*.ts` (not `xml/`) at worktree commit
`72ae7f6d95`, plus `utils/auto-link.ts`, `utils/html-entities.ts`, `utils/parsers.ts`,
`utils/markdown-mentions.ts`, `utils/quote-markdown.ts`. Counts below were computed by loading the
modules under bun (copy of the worktree, read-only) and comparing object identity against
`@lexical/markdown` 0.45.0 exports.

**Counts (real, this commit):** `INTERNAL_TRANSFORMERS` 63, `EXTERNAL_TRANSFORMERS` 66,
`ALL_TRANSFORMERS` 89; union 93 objects. 13 of them are upstream objects used unchanged (HEADING,
QUOTE, CODE, the 9 text-format transformers, LINK). 80 are Macro objects: 35 element, 42
text-match, 3 multiline-element, 0 text-format. Three of the 80 are separate `listItemImage(..)`
instances, so the lists hold 78 distinct Macro definitions. Two more are exported but sit in no
list (`ORDERED_LIST_ENTER`, `BR_TAG_TO_SPACE`). That makes 79 Rust consts (77 list consts + 2
unlisted) plus one factory fn (`list_item_image`).
The "61/65/87, union 89, 74 custom" figures in SCOPE.md come from an older snapshot. Since then the
two `m-db-query` transformers and others were added. Use the numbers here.

#### Module layout

```
crates/client/lexical/macro_document_model/src/transformers/
  mod.rs              // lists (internal/external/all/custom), re-exports, ConversionOnly
  xml_util.rs         // wrap_xml, xml_matcher, xml_matcher_with_attrs, js_json (JSON.stringify-compatible)
  unknown_fallback.rs // replace_text_with_unknown_mention, replace_element_with_unknown_mention
  unknown_mention.rs  // UNKNOWN_MENTION
  core.rs             // PRESERVE_LINES, BR_TAG_TO_*, HTML_ENTITY_TRANSFORMERS, LINK_XML, UNLINKED_TEXT,
                      // MARK_XML, SEARCH_MATCH, HR, protect_empty_paragraph_lines
  html_text_formats.rs// HTML_TEXT_FORMAT_EXPORTER, HTML_TEXT_FORMAT_IMPORTERS
  custom.rs           // wrapped lists, ORDERED_LIST_ENTER, custom_transformers()
  auto_link.rs        // AUTO_LINK, ESCAPED_AUTO_LINK + AutoLinkMatcher / EscapedAutoLinkMatcher
  mentions.rs         // 23 mention/card transformers
  database_query.rs, snapshot.rs, paste.rs, html_render.rs, await_node.rs, magic_chip.rs,
  agent_activity.rs, reply_target.rs, agent_context.rs, watermark.rs, video.rs, image.rs,
  katex.rs, tables.rs, classed_block.rs, cursor_system_notification.rs
crates/client/lexical/macro_document_model/src/utils/
  auto_link.rs        // normalize_link_url, find_auto_link_matches, AutoLinkMatchMode
  linkify/            // port of linkify-it 5.0.2 (re.rs, schemas.rs, mod.rs), see 4.2.3
  html_entities.rs    // HTML_ENTITIES, decode_html_entities
  parsers.rs          // markdown_to_plain_text, markdown_to_search_text, markdown_to_embedding_text, strip_agent_context, parse_*
  quote_markdown.rs   // quote_markdown
  markdown_mentions.rs// extract_channel_mentions_from_markdown
```

#### 4.2.0 Engine contract assumed (from the `lexical_markdown` section, do not redesign)

```rust
use lexical_markdown::{
    ElementTransformer, MultilineElementTransformer, TextFormatTransformer, TextMatchTransformer,
    Transformer, Transformers, Match, Matcher, Replace, AfterStartMatch, ExportCx, ImportCx,
};
// Match: whole match + positional groups, UTF-16 index, input line.
//   m.index: Utf16Offset; m.get(i) -> Option<&str>; m.input() -> &str.
//   Groups MUST be owned strings, not ranges into input: AUTO_LINK's group 1 is a
//   normalized URL that never appears in the input.
// Replace::{Handled, Declined}: JS `false` is Declined, `undefined` is Handled.
// AfterStartMatch::{Skip /*JS null*/, Fallthrough /*JS undefined*/, Done { imported: bool, last_line: usize }}
// Transformer::{Element(&'static dyn ElementTransformer), Multiline(..), TextFormat(..), TextMatch(..)}
```

Engine semantics that Macro transformers depend on (upstream `MarkdownImport.ts`,
`importTextMatchTransformer.ts`); the Rust engine must keep them exactly:

- Element import (`MarkdownImport.ts:245-253`): for each element transformer in list order,
  `lineText.match(regExp)`. On a match the line's text node is set to
  `lineText.slice(match[0].length)`. The slice starts at the match **length**, not the match end.
  Several Macro element regexes are unanchored (`I_DOCUMENT_CARD`, `I_PASTE_NODE`, `I_MAGIC_CHIP`,
  `I_AGENT_ACTIVITY`, `I_WATERMARK`, `I_TABLE_NODE`, `I_MACRO_QUOTE`, `IMAGE`), so this matters.
  The loop stops at the first `replace` that does not return `false`.
- `/$^/` matches the empty string on an empty line (no `m` flag). Every `/$^/` element
  transformer returns `false`, so it is harmless, but keep the regex. Do not replace it with a
  "never" matcher without checking that the result is identical.
- Multiline import (`MarkdownImport.ts:125-224`): when `replace` returns `false` after a real
  start/end pair, the engine `break`s out of the transformer loop. Later multiline transformers
  are **not** tried for that line, so the list order of multiline transformers is load-bearing.
- Text-match import (`importTextMatchTransformer.ts:28-58`): each transformer runs
  `text.match(importRegExp)` once. The earliest start wins. A later candidate replaces the current
  one only when it starts strictly earlier and wraps it or ends before it. Ties go to the earlier
  transformer.

---

#### 4.2.1 Lists (`transformers/index.ts`)

The order below is exact. `listItemImage(..)` creates a new object at each call site, so each list
gets its own instance.

```rust
/// CUSTOM_TRANSFORMERS (customTransformers.ts:57): 20 entries.
pub fn custom_transformers() -> &'static [Transformer] {
    static LIST: LazyLock<Vec<Transformer>> = LazyLock::new(|| vec![
        // ...HTML_TEXT_FORMAT_TRANSFORMERS (htmlTextFormats.ts:120)
        tm(&HTML_TEXT_FORMAT_EXPORTER),
        tm(&HTML_TEXT_FORMAT_IMPORTERS[0]), // <u>
        tm(&HTML_TEXT_FORMAT_IMPORTERS[1]), // <sup>
        tm(&HTML_TEXT_FORMAT_IMPORTERS[2]), // <sub>
        // ...upstream TRANSFORMERS minus CHECK_LIST/ORDERED_LIST/UNORDERED_LIST
        // (upstream TRANSFORMERS never contained CHECK_LIST; that filter term is a no-op)
        el(&lexical_markdown::HEADING),
        el(&lexical_markdown::QUOTE),
        ml(&lexical_markdown::CODE),
        tf(&lexical_markdown::INLINE_CODE),
        tf(&lexical_markdown::BOLD_ITALIC_STAR),
        tf(&lexical_markdown::BOLD_ITALIC_UNDERSCORE),
        tf(&lexical_markdown::BOLD_STAR),
        tf(&lexical_markdown::BOLD_UNDERSCORE),
        tf(&lexical_markdown::HIGHLIGHT),
        tf(&lexical_markdown::ITALIC_STAR),
        tf(&lexical_markdown::ITALIC_UNDERSCORE),
        tf(&lexical_markdown::STRIKETHROUGH),
        tm(&lexical_markdown::LINK),
        el(&MACRO_ORDERED_LIST),
        el(&MACRO_CHECK_LIST),
        el(&MACRO_UNORDERED_LIST),
    ]);
    &LIST
}

/// INTERNAL_TRANSFORMERS (index.ts:73): 63 entries.
pub fn internal_transformers() -> &'static Transformers {
    static LIST: LazyLock<Transformers> = LazyLock::new(|| Transformers::new([
        el(&I_DATABASE_QUERY_BLOCK),
        tm(&I_DATABASE_QUERY),
        tm(&I_SNAPSHOT_NODE), // Must be before mentions to avoid matching inner tags in snapshot content
        el(&I_PASTE_NODE),    // Must be before mentions to avoid matching inner tags in paste content
        tm(&I_HTML_RENDER),
        el(&PRESERVE_LINES),
        el(&VIDEO_LINK),      // Must be before LINK_XML to catch video URLs
        tm(&LINK_XML),        // Prefer internal xml link to handle []() in link text
        tm(&MARK_XML),
        tm(&SEARCH_MATCH),
        el(&HR),
        el(&I_VIDEO),
        el(&I_IMAGE_CONSTRAINED),
        el(&IMAGE),           // Standard markdown images (fallback)
        tm(list_item_image(&[&I_IMAGE_CONSTRAINED, &IMAGE])),
        tm(&I_USER_MENTION),
        tm(&I_GROUP_MENTION),
        tm(&I_DOCUMENT_MENTION),
        el(&I_DOCUMENT_CARD),
        tm(&I_PR_MENTION),
        tm(&I_BOOKING_LINK_MENTION),
        el(&I_AGENT_SESSION_CARD),
        tm(&I_AGENT_SESSION_MENTION),
        tm(&I_CONTACT_MENTION),
        tm(&I_DATE_MENTION),
        tm(&I_AWAIT_NODE),
        el(&I_MAGIC_CHIP),
        el(&I_AGENT_ACTIVITY),
        el(&I_REPLY_TARGET_NODE),
        el(&I_AGENT_CONTEXT),
        el(&I_TABLE_NODE),
        ml(&HTML_BLOCKQUOTE),
        el(&I_MACRO_QUOTE),
        tm(&I_EQUATION_NODE),
        tm(&I_THEME_MENTION),
        tm(&I_TAG_MENTION),
        tm(&I_CONNECT_APP),
        tm(&I_ACCOUNT_MANAGER_REQUEST),
        el(&I_WATERMARK),
    ].into_iter()
        .chain(custom_transformers().iter().copied())
        .chain([
            tm(&ESCAPED_AUTO_LINK),
            tm(&AUTO_LINK),
            ml(&I_CURSOR_SYSTEM_NOTIFICATION), // After the code fence so a tag quoted in one stays text
            tm(&UNKNOWN_MENTION),              // Must be last to act as fallback for unrecognized XML tags
        ])));
    &LIST
}

/// EXTERNAL_TRANSFORMERS (index.ts:123): 66 entries.
pub fn external_transformers() -> &'static Transformers {
    static LIST: LazyLock<Transformers> = LazyLock::new(|| Transformers::new([
        tm(&UNLINKED_TEXT),
        el(&I_DATABASE_QUERY_BLOCK),
        tm(&I_DATABASE_QUERY),
        el(&HR),
        tm(&MARK_XML),
        el(&VIDEO_LINK),
        el(&I_VIDEO),
        el(&IMAGE),
        tm(list_item_image(&[&IMAGE])),
        tm(&BR_TAG_TO_LINE_BREAK),
        el(&E_TABLE_NODE),
        ml(&HTML_BLOCKQUOTE),
        el(&E_USER_MENTION),
        el(&E_GROUP_MENTION),
        el(&E_PASTE_NODE),        // export raw pasted text to external markdown
        tm(&I_DOCUMENT_MENTION),  // for chat attachments
        el(&E_DOCUMENT_MENTION),
        el(&I_DOCUMENT_CARD),     // for internal representation
        el(&E_DOCUMENT_CARD),
        tm(&I_PR_MENTION),
        tm(&I_BOOKING_LINK_MENTION),
        tm(&I_AGENT_SESSION_MENTION),
        el(&E_PR_MENTION),
        el(&E_BOOKING_LINK_MENTION),
        el(&E_AGENT_SESSION_MENTION),
        el(&E_CONTACT_MENTION),
        el(&E_DATE_MENTION),
        el(&E_REPLY_TARGET_NODE),
        el(&E_TAG_MENTION),
        tm(&I_CONNECT_APP),       // agent replies render in the magic chip through this list
        // order matters
        ml(&E_MULTILINE_BLOCK_EQUATION_NODE),
        tm(&E_BLOCK_EQUATION_NODE),
        tm(&E_INLINE_EQUATION_NODE),
        el(&E_WATERMARK),
        el(&E_SNAPSHOT_NODE),
    ].into_iter()
        .chain(HTML_ENTITY_TRANSFORMERS.iter().map(|t| tm(t)))   // 8
        .chain(custom_transformers().iter().copied())            // 20
        .chain([
            tm(&ESCAPED_AUTO_LINK),
            tm(&AUTO_LINK),
            tm(&UNKNOWN_MENTION), // Must be last to act as fallback for unrecognized XML tags
        ])));
    &LIST
}

/// ALL_TRANSFORMERS (index.ts:170): 89 entries.
pub fn all_transformers() -> &'static Transformers {
    static LIST: LazyLock<Transformers> = LazyLock::new(|| Transformers::new([
        el(&I_DATABASE_QUERY_BLOCK),
        tm(&I_DATABASE_QUERY),
        tm(&I_SNAPSHOT_NODE), // Must be before mentions to avoid matching inner tags in snapshot content
        el(&I_PASTE_NODE),    // Must be before mentions to avoid matching inner tags in paste content
        tm(&I_HTML_RENDER),
        el(&E_PASTE_NODE),
        el(&PRESERVE_LINES),
        el(&VIDEO_LINK),      // Must be before LINK_XML to catch video URLs
        tm(&LINK_XML),        // Prefer internal xml link to handle []() in link text
        tm(&MARK_XML),
        tm(&SEARCH_MATCH),
        el(&HR),
        el(&I_VIDEO),
        el(&I_IMAGE_CONSTRAINED),
        el(&IMAGE),
        tm(list_item_image(&[&I_IMAGE_CONSTRAINED, &IMAGE])),
        tm(&BR_TAG_TO_LINE_BREAK),
        el(&I_TABLE_NODE),
        el(&E_TABLE_NODE),
        ml(&HTML_BLOCKQUOTE),
        el(&E_SNAPSHOT_NODE),
        tm(&I_USER_MENTION),
        el(&E_USER_MENTION),
        tm(&I_GROUP_MENTION),
        el(&E_GROUP_MENTION),
        tm(&I_DOCUMENT_MENTION),
        el(&E_DOCUMENT_MENTION),
        el(&I_DOCUMENT_CARD),
        el(&E_DOCUMENT_CARD),
        tm(&I_PR_MENTION),
        tm(&I_BOOKING_LINK_MENTION),
        el(&I_AGENT_SESSION_CARD),
        tm(&I_AGENT_SESSION_MENTION),
        el(&E_AGENT_SESSION_MENTION),
        el(&E_PR_MENTION),
        el(&E_BOOKING_LINK_MENTION),
        tm(&I_CONTACT_MENTION),
        el(&E_CONTACT_MENTION),
        tm(&I_DATE_MENTION),
        el(&E_DATE_MENTION),
        tm(&I_AWAIT_NODE),
        el(&I_MAGIC_CHIP),
        el(&I_AGENT_ACTIVITY),
        el(&I_REPLY_TARGET_NODE),
        el(&I_AGENT_CONTEXT),
        el(&I_MACRO_QUOTE),
        tm(&I_EQUATION_NODE),
        tm(&I_THEME_MENTION),
        tm(&I_TAG_MENTION),
        tm(&I_CONNECT_APP),
        tm(&I_ACCOUNT_MANAGER_REQUEST),
        el(&I_WATERMARK),
        el(&E_WATERMARK),
        el(&E_TAG_MENTION),
        // order matters
        ml(&E_MULTILINE_BLOCK_EQUATION_NODE),
        tm(&E_BLOCK_EQUATION_NODE),
        tm(&E_INLINE_EQUATION_NODE),
    ].into_iter()
        .chain(HTML_ENTITY_TRANSFORMERS.iter().map(|t| tm(t)))   // 8
        .chain(custom_transformers().iter().copied())            // 20
        .chain([
            tm(&ESCAPED_AUTO_LINK),
            tm(&AUTO_LINK),
            ml(&I_CURSOR_SYSTEM_NOTIFICATION), // After the code fence so a tag quoted in one stays text
            tm(&UNKNOWN_MENTION),              // Must be last to act as fallback for unrecognized XML tags
        ])));
    &LIST
}
```

Differences between the sets: INTERNAL ∖ ALL contains only its own `listItemImage` instance.
EXTERNAL ∖ ALL contains `UNLINKED_TEXT`, its `listItemImage(IMAGE)` instance and
`E_REPLY_TARGET_NODE`. `I_CURSOR_SYSTEM_NOTIFICATION` is in INTERNAL and ALL (index 87) but
not in EXTERNAL.

Multiline order per list (load-bearing, see the engine `break` in 4.2.0):
- INTERNAL: `HTML_BLOCKQUOTE`, `CODE`, `I_CURSOR_SYSTEM_NOTIFICATION`.
- EXTERNAL: `HTML_BLOCKQUOTE`, `E_MULTILINE_BLOCK_EQUATION_NODE`, `CODE`.
- ALL: `HTML_BLOCKQUOTE`, `E_MULTILINE_BLOCK_EQUATION_NODE`, `CODE`, `I_CURSOR_SYSTEM_NOTIFICATION`.

No other exported lists exist. There is no chat or title list. These private lists are built in
transformer files and must be ported as private fns:

```rust
// tables.rs:98   internalTransformersWithinTables (unwrapped upstream lists!)
fn internal_transformers_within_tables() -> &'static Transformers; // [CHECK_LIST(upstream), I_USER_MENTION,
    // I_DOCUMENT_MENTION, I_CONTACT_MENTION, I_DATE_MENTION, I_EQUATION_NODE, I_IMAGE_CONSTRAINED, IMAGE,
    // I_VIDEO, ...HTML_TEXT_FORMAT_TRANSFORMERS(4), ...upstream TRANSFORMERS(14)]
// tables.rs:249  externalTransformersWithinTables
fn external_transformers_within_tables() -> &'static Transformers; // [BR_TAG_TO_LINE_BREAK, CHECK_LIST(upstream),
    // E_USER_MENTION, I_DOCUMENT_MENTION /* for citations */, E_DOCUMENT_MENTION, E_CONTACT_MENTION,
    // I_DATE_MENTION, E_BLOCK_EQUATION_NODE, IMAGE, I_VIDEO, ...HTML_ENTITY_TRANSFORMERS(8),
    // ...HTML_TEXT_FORMAT_TRANSFORMERS(4), ...upstream TRANSFORMERS(14)]
// classedBlock.ts:37  MACRO_QUOTE_TRANSFORMERS
fn macro_quote_transformers() -> &'static Transformers; // [I_HTML_RENDER, ...CUSTOM(20), I_EQUATION_NODE,
    // I_USER_MENTION, I_DOCUMENT_MENTION, I_CONTACT_MENTION, ...upstream TRANSFORMERS(14)]
// classedBlock.ts:47  htmlBlockquoteTransformers()
fn html_blockquote_transformers() -> &'static Transformers; // [HTML_BLOCKQUOTE, then MACRO_QUOTE_TRANSFORMERS]
```

`tables.ts:113` `_TABLE_CELL_TRANSFORMERS` and `tables.ts:123` `_TABLE_CELL_EXPORT_TRANSFORMERS`
are dead (never read). Do not port them. Upstream `TRANSFORMERS` is HEADING, QUOTE,
UNORDERED_LIST, ORDERED_LIST, CODE, then the 9 formats, then LINK
(`MarkdownTransformers.ts:881`). Inside tables and macro quotes the lists are the **unwrapped**
upstream ones, and the upstream list appears a second time after `CUSTOM` in macro quotes.

```rust
/// Conversion-only transformers (`transformers.ts:67-75`). The web shortcut plugin filters them out;
/// Rust only needs the flag for API parity.
pub fn is_conversion_only(t: &Transformer) -> bool;
// true for: PRESERVE_LINES, BR_TAG_TO_SPACE, BR_TAG_TO_LINE_BREAK, the 8 HTML_ENTITY_TRANSFORMERS,
// ESCAPED_AUTO_LINK, AUTO_LINK (13).

/// transformers.ts:106. Returns `markdown` unchanged unless `transformers` contains PRESERVE_LINES
/// (identity check -> `Transformers::contains(&Transformer)` by pointer/TypeId). Any filtered copy
/// of a `Transformers` (the web's shortcut list, `apps/web/.../LexicalMarkdown/utils.ts:342-347`)
/// holds the same `&'static` elements, never clones, so identity survives filtering.
pub fn protect_empty_paragraph_lines(markdown: &str, transformers: &Transformers) -> String;
```
`protect_empty_paragraph_lines` splits on `\n`. While inside a fence it skips lines until one
whose `trimEnd()` matches `^[ \t]*` followed by `` `{len,}$ ``. Outside a fence,
`` ^[ \t]*`{3,} `` on `line.trimEnd()` opens one. Its length is `fence.trim().length`. The rest of
the line after the fence is tested with `` `{len,}$ ``, and a match is a one-line block (no open
fence). Any other line equal to exactly `" "` becomes `"\u{200B}"`. Callers: only the web
(`apps/web/src/lib/core/component/LexicalMarkdown/utils.ts:347`). lexical-service does not call it.

---

#### 4.2.2 Every Macro transformer

Notation: `el` = ElementTransformer, `tm` = TextMatchTransformer, `ml` = Multiline. "Deps" are
node `TYPE` strings. A regex is written as JS source/flags, verbatim from the source. When
`regExp` and `importRegExp` are the same, it is written once as `re=`. "Unknown(text,'X')" means
`replace_text_with_unknown_mention(node,"X")`, which replaces the text node with
`UnknownMentionNode{name:"X"}` (`unknownFallback.ts:9`). "UnknownEl(..)" means
`replace_element_with_unknown_mention`, which replaces the element with a new paragraph that
contains `UnknownMentionNode{name}` (`unknownFallback.ts:16`). Every `JSON.parse` failure, every
validation `throw`, and every caught exception takes that fallback. `console.error` is dropped:
use `tracing::warn!` with the transformer name and no payload.

**JSON output rule (all exporters):** `JSON.stringify` key order is the property order written in
the source, and `undefined` values are omitted (`skip_serializing_if = "Option::is_none"`).
`null` stays `null`. Numbers must be formatted the way JS does (`100`, not `100.0`; `1e+21`).
Do not use serde_json's f64 output. Use `xml_util::js_json::to_string(&Value)` with JS number
formatting. Escapes added after stringify are written per item, and they differ from item to item.

##### transformers/transformers.ts

```rust
pub fn wrap_xml(tag: &str, attrs: &serde_json::Value) -> String; // :51  `<{tag}>{json.replaceAll('<','\\u003c')}</{tag}>`
pub fn xml_matcher(tag: &str, flags: Option<&str>) -> regress::Regex; // :57 `<{tag}>(.*?)<\/{tag}>`, flags default "s"
```

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `PRESERVE_LINES` | el, conv-only | 136 | paragraph | `/^[ \u200b]$/` (built `new RegExp(\`^[${' '}${'\u200b'}]$\`)`) | If `is_import && children.len()==1`, append an empty TextNode `""` to the paragraph. Otherwise nothing. Returns Handled. | For a ParagraphNode whose `getTextContent().trim()` is empty and which has no DecoratorNode child: `"\n \n"`. Otherwise None. |
| `BR_TAG_TO_SPACE` | tm, conv-only, **in no list** | 164 | — | re=`/<br\s*\/?>/i` | Replace every `/<br\s*\/?>/gi` in the node's full text with `" "`, then set the text if it changed. Returns the node. | always None |
| `BR_TAG_TO_LINE_BREAK` | tm, conv-only | 185 | linebreak | re=`/<br\s*\/?>/i` | `textNode.replace(LineBreakNode)` | always None |
| `HTML_ENTITY_TRANSFORMERS[0..8]` | tm, conv-only | 200/218 | — | see table below, flag `i` | `textNode.replace(TextNode(char))`. No format is copied: the new node has format 0. | none (no export fn) |
| `LINK_XML` | tm | 242 | link, unlinked-text, unknown-mention | re=`/<m-link>(.*?)<\/m-link>/s` | Parse `m[1]`. Both `url` and `text` keys must be present, or Unknown(text,'Unknown Link'). If `res.unlinked === true`: `format = typeof res.format==='number' ? res.format : 0`, and replace with `UnlinkedTextNode(res.text)` whose format is `format \| textNode.format`. Otherwise `LinkNode(res.url,{title:res.title})` with child `TextNode(res.text)` carrying `textNode.format`, which replaces the text node. Any throw goes to Unknown. | `UnlinkedTextNode` → `exportUnlinkedText`. AutoLinkNode with `getIsUnlinked()` → concat of `exportUnlinkedText` over its TextNode children. LinkNode → `wrap_xml("m-link",{url:escapeUrl(url),text:getTextContent(),title:getTitle()\|\|''})`. Else None. |
| `UNLINKED_TEXT` | tm | 293 | (=LINK_XML) | (=LINK_XML) | (=LINK_XML) | Only UnlinkedTextNode or unlinked AutoLinkNode: for each text node (itself, or the TextNode children), `exportFormat(text, text.getTextContent()).replace(/[:.@/]/g,'\\$&')`, joined with `""`. Else None. |
| `MARK_XML` | tm | 312 | mark | re=`/<mark>(.*?)<\/mark>/s` | `MarkNode([])` with child `TextNode(m[1])` carrying `textNode.format`, replacing the text node | always None |
| `SEARCH_MATCH` | tm | 333 | search-match | re=`/<macro_em>(.*?)<\/macro_em>/s` | `SearchMatchNode([])` with child `TextNode(m[1])` carrying the format, replacing the text node | always None |
| `HR` | el | 354 | horizontalrule | `/^(---|\*\*\*|___)\s?$/` | `line = HorizontalRuleNode`. If `is_import \|\| parent.next_sibling.is_some()` then `parent.replace(line)`, else `parent.insert_before(line)`. Then `line.select_next()`. | HorizontalRuleNode → `"---"` |

- `escapeUrl` (:222): `(`→`%28`, `)`→`%29`.
- `exportUnlinkedText(node, exportFormat)` (:226): `text = node.getTextContent()`, then
  `link = find_next_auto_link_match(text, CommonTlds)`. With no link, return
  `exportFormat(node, text)`. Otherwise
  `wrap_xml("m-link",{url:link.url,text,title:'',unlinked:true,format:node.getFormat()})`, in that
  key order.

HTML entities (`utils/html-entities.ts:2`, in insertion order):

| Rust | entity | char |
|---|---|---|
| `HTML_ENTITY_TRANSFORMERS[0]` | `&amp;` | `&` |
| `[1]` | `&nbsp;` | `U+00A0` |
| `[2]` | `&lt;` | `<` |
| `[3]` | `&gt;` | `>` |
| `[4]` | `&quot;` | `"` |
| `[5]` | `&copy;` | `©` |
| `[6]` | `&reg;` | `®` |
| `[7]` | `&trade;` | `™` |

```rust
pub struct HtmlEntityTransformer { pub entity: &'static str, pub character: &'static str, re: LazyLock<Regex> }
pub static HTML_ENTITY_TRANSFORMERS: [HtmlEntityTransformer; 8];
pub static HTML_ENTITIES: [(&str, &str); 8];
/// html-entities.ts:16: one pass of /&amp;|&nbsp;|&lt;|&gt;|&quot;|&copy;|&reg;|&trade;/gi,
/// lookup by lowercased match, fallback to the match itself.
pub fn decode_html_entities(text: &str) -> String;
```
Each regex is `new RegExp(entity.replace(/([.*+?^=!:${}()|[\]/\\])/g,'\\$1'), 'i')`. The entities
contain only `&`, `;` and ASCII letters, so the escape does nothing and the source is the entity
itself. Rust: `Regex::with_flags(entity, "i")` (assert at test time that the escape leaves the
string unchanged).

##### transformers/unknownMention.ts

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `UNKNOWN_MENTION` | tm | 11 | unknown-mention | re=`/<(m-[a-zA-Z0-9_-]+)>(.*?)<\/\1>/s` | `textNode.replace(UnknownMentionNode{name:m[1]})`. The name is the **tag**, e.g. `m-foo`. | UnknownMentionNode → `<{name}></{name}>` (payload is lost) |

##### transformers/htmlTextFormats.ts

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `HTML_TEXT_FORMAT_EXPORTER` | tm | 103 | — | `/$a/` (never matches) | — (no replace) | For a TextNode with any of underline/superscript/subscript: `wrapInsideMarkdownTags(exportFormat(node, node.getTextContent()), node)`. Else None. |
| `HTML_TEXT_FORMAT_IMPORTERS[0]` | tm | 71/94 | — | re=`/<u>(.*?)<\/u>/i` | `setTextContent(m[1])`, then toggle `underline` if it is not set. Returns the node, so it is re-parsed. | none |
| `HTML_TEXT_FORMAT_IMPORTERS[1]` | tm | 71/94 | — | re=`/<sup>(.*?)<\/sup>/i` | same, `superscript` | none |
| `HTML_TEXT_FORMAT_IMPORTERS[2]` | tm | 71/94 | — | re=`/<sub>(.*?)<\/sub>/i` | same, `subscript` | none |

Each importer regex is built as `new RegExp(\`<${tag}>(.*?)</${tag}>\`,'i')`, where
`tag = openTag.slice(1,-1)` (`u`, `sup`, `sub`).

`wrapInsideMarkdownTags(content,node)` (:32) uses `MARKDOWN_TEXT_TAGS`: the distinct `tag` of
upstream `TEXT_FORMAT_TRANSFORMERS` with `format.length===1`, sorted by length descending with a
stable sort. The upstream order after filtering is `` ` ``, `**`, `__`, `==`, `*`, `_`, `~~`,
so the result is `**`, `__`, `==`, `~~`, `` ` ``, `*`, `_`. The prefix loop repeatedly takes the leading `/^\s+/` match,
or else the first tag in that order that `inner` starts with, and appends it to `prefix`. The
suffix loop does the same with `/\s+$/` or `endsWith`. Then
`prefix + openTags + inner + closeTags + suffix`. The open tags come in `<u>`,`<sup>`,`<sub>`
order, filtered by `hasFormat`. The close tags are the same list reversed.

##### transformers/customTransformers.ts (upstream-derived, see 4.2.4)

| Const | Kind | Line | Deps | Regex | Notes |
|---|---|---|---|---|---|
| `MACRO_ORDERED_LIST` | el | 49 | list, listitem | `/^(\s*)(\d{1,})\.\s/` | `customTransformer(ORDERED_LIST)` |
| `MACRO_CHECK_LIST` | el | 63 | list, listitem | `/^(\s*)(?:[-*+]\s)?\s?(\[(\s|x)?\])\s/i` | `customTransformer(CHECK_LIST)` |
| `MACRO_UNORDERED_LIST` | el | 64 | list, listitem | `/^(\s*)[-*+]\s/` | `customTransformer(UNORDERED_LIST)` |
| `ORDERED_LIST_ENTER` | el, **in no list** | 52 | list, listitem | `/^(\s*)(\d{1,})\.$/` | `{...MACRO_ORDERED_LIST, regExp}`. Used only as a web `triggerOnEnterTransformers` entry (`pluginManager.ts:86`). |

##### transformers/auto-link.ts (matchers specified in 4.2.3)

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `ESCAPED_AUTO_LINK` | tm, conv-only | 66 | unlinked-text | `EscapedAutoLinkMatcher` (regExp and importRegExp are two instances) | If an ancestor is a LinkNode: return `None`. The text node is **already split** by `import_found_text_match_transformer` before `replace` runs, so the split stays and the middle part is not re-parsed (`importTextMatchTransformer.ts:91-98`, `importTextTransformers.ts:128`, Macro `auto-link.ts:72`). Otherwise replace with `UnlinkedTextNode(m[1])` carrying `textNode.format`. | none |
| `AUTO_LINK` | tm, conv-only | 81 | link | `AutoLinkMatcher` | If an ancestor is a LinkNode: return `None` (already split, middle not re-parsed, as above; `auto-link.ts:86`). Otherwise `LinkNode(m[1])` with child `TextNode(m[2])` carrying `textNode.format`, replacing the text node. Return nothing, so the label is **not** re-parsed for markdown. | none |

Neither has `trigger`, so neither runs as a typing shortcut.

##### transformers/mentions.ts

All `I_*` text-match transformers here use `regExp == importRegExp == /<TAG>(.*?)<\/TAG>/`
(no flags, so `.` does not cross line terminators) and export `<TAG>{JSON}</TAG>` with **no**
`<` escaping (unlike `wrap_xml`). All `E_*` element transformers use `regExp=/$^/` and a
`replace` that returns Declined. Payload JSON keys appear in the listed order.

| Const | Kind | Line | Deps | TAG | Replace (from `JSON.parse(m[1])` = d) | Export |
|---|---|---|---|---|---|---|
| `I_USER_MENTION` | tm | 52 | user-mention, unknown-mention | `m-user-mention` | `d.userId` must be a non-blank string. `email = typeof d.email==='string' ? d.email : ''`. If email is empty and userId starts with `macro\|`, email = userId after the prefix. `displayName` = d.displayName if it is a string, else undefined. If both email and `displayName?.trim()` are empty, throw. `UserMentionNode(userId,email,{displayName})`. Fallback 'Unknown User'. | `{userId,email,displayName}` |
| `E_USER_MENTION` | el | 94 | user-mention | — | Declined | `userId` if truthy, else None |
| `I_CONTACT_MENTION` | tm | 119 | contact-mention, unknown-mention | `m-contact-mention` | Keys `contactId,name,emailOrDomain,isCompany` must be present (`in`). `ContactMentionNode(d.contactId,d.name,d.emailOrDomain,d.isCompany)`. Fallback 'Unknown Contact'. | `{contactId,name,emailOrDomain,isCompany}` |
| `E_CONTACT_MENTION` | el | 155 | contact-mention | — | Declined | `emailOrDomain` when both name and emailOrDomain are truthy, else None |
| `I_DATE_MENTION` | tm | 183 | date-mention, unknown-mention | `m-date-mention` | `parse_date_mention_body(m[1])` (nodes section; it accepts a JSON object or a bare date). None → Unknown 'Unknown Date'. `DateMentionNode(date,displayFormat,mentionUuid)`. | `{date,displayFormat,mentionUuid}` |
| `E_DATE_MENTION` | el | 211 | date-mention | — | Declined | `displayFormat` if truthy |
| `I_DOCUMENT_MENTION` | tm | 238 | document-mention, unknown-mention | `m-document-mention` | `documentId` key must be present. `DocumentMentionNode(d.documentId, d.documentName ?? '', d.blockName ?? 'unknown', d.blockParams, undefined, d.collapsed)`. Fallback 'Unknown Item'. | `{documentId,blockName,documentName,blockParams,collapsed}` |
| `E_DOCUMENT_MENTION` | el | 296 | document-mention | — | Declined | Requires documentName, documentId and blockName to be truthy. `path = blockName in {routine,automation} ? 'routines' : blockName`. `[{documentName}](https://{cleanHostname(host)}/app/{path}/{documentId})` |
| `I_PR_MENTION` | tm | 331 | pr-mention, unknown-mention | `m-pr-mention` | `id = string ? d.id : ''`. `url = (string && is_github_pull_request_url) ? d.url : None`. Both empty → throw. `PullRequestMentionNode(id, label?:string, mentionUuid?:string, url)`. Fallback 'Unknown Pull Request'. | `{id,label,mentionUuid,url}` |
| `E_PR_MENTION` | el | 375 | pr-mention | — | Declined | `label = getLabel() \|\| 'Pull request'`. With no id: `[label](url)` if there is a url, else None. With no hostname: `label`. Otherwise `[label](https://{host}/app/pr/{id})`. |
| `I_AGENT_SESSION_MENTION` | tm | 407 | agent-session-mention, unknown-mention | `m-agent-session-mention` | `id` key must be present and a string. `AgentSessionMentionNode{id, label?:string, mentionUuid?:string, expanded: d.expanded===true}`. Fallback 'Unknown Agent Session'. | `buildAgentSessionMentionMarkdown({id,label,mentionUuid,...(expanded?{expanded:true}:{})})`, which **does** escape `<` → `\u003c` |
| `I_AGENT_SESSION_CARD` | el | 444 | agent-session-mention | — (`/$^/`) | Declined | Only for an AgentSessionMentionNode with `isExpanded()`: `buildAgentSessionMentionMarkdown(exportComponentProps())` |
| `E_AGENT_SESSION_MENTION` | el | 458 | agent-session-mention | — | Declined | No id → None. `label \|\| 'Agent session'`. With no hostname: label. Otherwise `[label](https://{host}/app/agent/{id})`. |
| `I_GROUP_MENTION` | tm | 486 | group-mention, unknown-mention | `m-group-mention` | `groupAlias` key must be present. `GroupMentionNode(d.groupAlias)`. Fallback 'Unknown Group'. | `{groupAlias}` |
| `E_GROUP_MENTION` | el | 514 | group-mention | — | Declined | `@{groupAlias}` if truthy |
| `I_DOCUMENT_CARD` | **el** | 540 | document-card, unknown-mention | `m-document-card` (regExp only, unanchored, no flags) | Keys `documentId,blockName` must be present. `DocumentCardNode(documentId, documentName ?? '', blockName, blockParams, previewBox, previewData, mentionUuid)` replaces the **parent** element. Fallback UnknownEl 'Unknown Item'. | `{documentId,blockName,documentName,blockParams,previewBox,previewData,mentionUuid}` |
| `I_THEME_MENTION` | tm | 585 | theme-mention, unknown-mention | `m-theme-mention` | d must be a non-null object with a string `name`. `ThemeMentionNode(d.name, d.data)`. Fallback 'Unknown Theme'. | `{name:getThemeName(),data:getThemeData()}` |
| `I_CONNECT_APP` | tm | 619 | connect-app, unknown-mention | `m-connect-app` (via `CONNECT_APP_TAG`, `nodes/ConnectAppNode.ts:25`) | d must be a non-null object. Requires `is_connect_app_slug(appSlug)` and a non-empty string `name`. `target` undefined → `DEFAULT_CONNECT_APP_TARGET`, and it must pass `is_connect_app_target`. `ConnectAppNode(appSlug,name,target)`. Fallback 'Connect app'. | `{appSlug,name}` plus `target` only when it is not the default |
| `I_ACCOUNT_MANAGER_REQUEST` | tm | 665 | account-manager-request, unknown-mention | `m-account-manager-request` (`ACCOUNT_MANAGER_REQUEST_TAG`, `nodes/AccountManagerRequestNode.ts:22`) | `id` taken from a non-null object that has an `id` key. It must pass `is_account_manager_grant_id`. `AccountManagerRequestNode(id)`. Fallback 'Account manager request'. | `{id:getGrantId()}` |
| `I_TAG_MENTION` | tm | 698 | tag-mention, unknown-mention | `m-tag` | Keys `optionId,propertyDefinitionId,scope,name` must be present. scope must be `user` or `team`. `TagMentionNode(optionId,propertyDefinitionId,scope,name,color if string)`. Fallback 'Unknown Tag'. | `{optionId,propertyDefinitionId,scope,name,color}` |
| `E_TAG_MENTION` | el | 744 | tag-mention | — | Declined | `#{name}` if truthy |
| `E_DOCUMENT_CARD` | el | 764 | document-card | — | Declined | Same guard as E_DOCUMENT_MENTION. `[{documentName}](https://{cleanHostname(host)}/app/{blockName}/{documentId})`, with **no** routine→routines mapping |
| `I_BOOKING_LINK_MENTION` | tm | 794 | booking-link-mention, unknown-mention | `m-booking-link-mention` | `profileId = string ? d.profileId : ''`. `url = (string && is_macro_booking_url) ? d.url : None`. Both empty → throw. `BookingLinkMentionNode{profileId, slug?:string, label?:string, url: url \|\| "https://macro.com/app/book/{profileId}"}`. Fallback 'Unknown Booking Link'. | `{profileId,slug,label,url}` |
| `E_BOOKING_LINK_MENTION` | el | 836 | booking-link-mention | — | Declined | `[{label \|\| slug \|\| 'Booking link'}]({url})` |

Hostname (mentions.ts:277-294). JS reads `window.location.hostname`. Rust takes it from
`ExportCx` config: `MacroMarkdownOptions { app_hostname: Option<String> }`.
- `cleanHostname(h)`: replace the **first** occurrence of `www.` anywhere in `h`, lowercase, and
  map `localhost` to `dev.macro.com`.
- `currentBrowserHostname()` returns None when there is no window or hostname (E_PR,
  E_AGENT_SESSION).
- E_DOCUMENT_MENTION and E_DOCUMENT_CARD call `cleanHostname(window.location.hostname)` directly.
  Headless, with no `window`, JS throws a ReferenceError out of `$convertToMarkdownString`.
  **Decided (Q8):** Rust returns `Err(Error::MissingHostname)` there to match the "fails" behaviour. Do not invent a default.

##### transformers/databaseQuery.ts

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `I_DATABASE_QUERY_BLOCK` | el | 19 | database-query, unknown-mention | `/^<m-db-query>(.*?)<\/m-db-query>$/` | `data = parse_database_query_json(m[1])`. None → UnknownEl 'Unavailable database question'. If `data.displayMode != "scalar"`, the parent is replaced by `DatabaseQueryNode(data)`. Otherwise it is replaced by `Paragraph[DatabaseQueryNode(data)]`. | `DatabaseQueryNode && !isInline()` → `database_query_markdown(exportComponentProps())`, which is `<m-db-query>{json, '<'→\u003c}</m-db-query>` (`nodes/DatabaseQueryNode.ts:45`) |
| `I_DATABASE_QUERY` | tm | 40 | database-query, unknown-mention | re=`/<m-db-query>(.*?)<\/m-db-query>/` | None → Unknown(text,'Unavailable database question'). Otherwise `DatabaseQueryNode({...data, displayMode:'scalar'})`. | `DatabaseQueryNode && isInline()` → same markdown |

##### transformers/snapshot.ts, paste.ts, htmlRender.ts, await.ts

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `I_SNAPSHOT_NODE` | tm | snapshot.ts:17 | snapshot, unknown-mention | re=`/<m-snapshot>(.*?)<\/m-snapshot>/` | Keys `documentId,documentName,blockName,content` must be present. `SnapshotNode{.., snapshotDate: d.snapshotDate \|\| now().toISOString(), mentionUuid}`. Fallback 'Unknown Snapshot'. `now()` must be injectable (`ImportCx::now()`) for determinism. | `{documentId,documentName,blockName,content,snapshotDate,mentionUuid}`, then `<`→`\u003c` and `>`→`\u003e` |
| `E_SNAPSHOT_NODE` | el | snapshot.ts:70 | snapshot | `/$^/` | Declined | Requires documentName, documentId and blockName. `host = (h==='localhost') ? 'dev.macro.com' : h.replace('www.','').toLowerCase()`. The localhost check runs **before** lowercasing, which differs from `cleanHostname`. `[{documentName}](https://{host}/app/{blockName}/{documentId})`. With no window, JS throws (same unresolved case). |
| `I_PASTE_NODE` | **el** | paste.ts:19 | paste, unknown-mention | `/<m-paste>(.*?)<\/m-paste>/` (unanchored) | `content` key must be present. `PasteNode{content, origin: normalize_paste_origin(d.origin)}` replaces the parent. Fallback UnknownEl 'Unknown Paste'. | `{content,origin}`, with `<`→`\u003c` and `>`→`\u003e` |
| `E_PASTE_NODE` | el | paste.ts:56 | paste | `/$^/` | Declined | `getContent()` raw |
| `I_HTML_RENDER` | tm | htmlRender.ts:18 | html-render, unknown-mention | re=`/<m-html-render>(.*?)<\/m-html-render>/` | `d.html` must be a string. `HtmlRenderNode{html, adaptColors: bool ? d.adaptColors : None}`. Fallback 'Unknown Content'. | `JSON(exportComponentProps())`, with `<`→`\u003c` and `>`→`\u003e` |
| `I_AWAIT_NODE` | tm | await.ts:16 | await, unknown-mention | re=`/<m-await>(.*?)<\/m-await>/` | `AwaitNode{awaitId?:string, text?:string, inline: bool ? d.inline : true}`. Fallback 'Unknown Await'. | `JSON(exportComponentProps())`, no escaping |

##### transformers/magicChip.ts, agentActivity.ts, reply-target.ts, agentContext.ts, watermark.ts

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `I_MAGIC_CHIP` | el | magicChip.ts:29 | magic-chip, unknown-mention | `/<m-magic-chip>(.*?)<\/m-magic-chip>/` | `isMagicChipData` (:16) requires: `agentSessionId` a string; `channelId` undefined or a string; `promptedMessage === null \|\| is_magic_chip_message`; `is_magic_chip_status(status)`. Then `parent.replace(MagicChipNode(d))`. Fallback UnknownEl 'Unknown Magic Chip'. | `<m-magic-chip>{JSON(exportComponentProps())}</m-magic-chip>`, no escaping |
| `I_AGENT_ACTIVITY` | el | agentActivity.ts:26 | agent-activity, unknown-mention | `/<m-agent-activity>(.*?)<\/m-agent-activity>/s` | `is_agent_activity_data(d)`, then `parent.replace(AgentActivityNode(d))`. Fallback UnknownEl 'Unknown agent activity'. | JSON with `/[<\u2028\u2029]/g` mapped: `<`→`\u003c`, U+2028→`\u2028`, U+2029→`\u2029` (6-char escapes) |
| `I_REPLY_TARGET_NODE` | el | reply-target.ts:16 | reply-target, unknown-mention | `/^<m-reply-target>(.*?)<\/m-reply-target>$/s` | `read_reply_target_data(JSON.parse(m[1]))`. None → throw. `parent.replace(ReplyTargetNode(d))`. Fallback UnknownEl 'Unknown Reply Target'. | `build_reply_target_markdown(exportComponentProps())`, which is `<m-reply-target>{json,'<'→\u003c}</m-reply-target>` (`nodes/ReplyTargetNode.ts:75`) |
| `E_REPLY_TARGET_NODE` | el | reply-target.ts:39 | reply-target | `/$^/` | Declined | `displayText.split('\n').map(l => '> '+l).join('\n')` |
| `I_AGENT_CONTEXT` | el | agentContext.ts:26 | agent-context, unknown-mention | `/^<m-agent-context>(.*?)<\/m-agent-context>$/s` | If `parent.getParent()` is not the root, or `parent.getPreviousSibling() !== null`, then `parent.clear().append(TextNode(m[0]))`: the literal tag stays visible text. Otherwise parse. Require `is_agent_context_data(d)` **and** exactly 2 own keys. `parent.replace(AgentContextNode(d))`. Fallback UnknownEl 'Unknown Agent Context'. | same `[<\u2028\u2029]` escaping as agent activity |
| `I_WATERMARK` | el | watermark.ts:14 | watermark, unknown-mention | `/<m-watermark>(.*?)<\/m-watermark>/` | `content` key must be present. `parent.append(WatermarkNode{content})`: it **appends** into the paragraph and does not replace it. Fallback UnknownEl 'Unknown Watermark'. | `{content}` |
| `E_WATERMARK` | el | watermark.ts:44 | watermark | `/$^/` | Declined | `content` if truthy |

##### transformers/video.ts

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `I_VIDEO` | el | 83 | video, unknown-mention | `/^<m-video>(.*?)<\/m-video>\s*$/` | `d.url` must be a non-empty string. constrainedW/H: `!= null ? (Number(x) \|\| undefined) : undefined`. `VideoNode{srcType:String(d.srcType\|\|'url'), url, id:String(d.id\|\|''), width:Number(d.width)\|\|0, height:Number(..)\|\|0, scale:Number(..)\|\|1, controls: bool ? d.controls : true, constrainedWidth, constrainedHeight}`. `parent.append(video)`: appends, no replace. Fallback UnknownEl 'Unknown Video'. `Number()` and `String()` use JS coercion (`Number("12px")`=NaN→0, `Number(true)`=1, `String(5)`="5"). Port both as `js_number(&Value)` and `js_string(&Value)`. | srcType `local` → None. Empty url → None. Otherwise `{url,srcType,id,width,height,scale,controls,constrainedWidth,constrainedHeight}` |
| `VIDEO_LINK` | el | 148 | video | `VIDEO_LINK_REGEXP` (:71), flag `i`, source below | `linkText = m[1] ?? m[4] ?? ''`, `url = m[2] ?? m[5] ?? ''`. If `!is_video_markdown_link(url, linkText)` → Declined. Otherwise `node.replace(VideoNode{srcType:'url', url, width:0, height:0, id:'', controls:true, scale:1})`. | always None |

`VIDEO_LINK_REGEXP`, flags `i`, with `VIDEO_EXTENSION_PATTERN = "mp4|webm|ogg|mov|avi|mkv|m4v"`:
```
^(?:\[([^\]]*\.(?:mp4|webm|ogg|mov|avi|mkv|m4v)[^\]]*)\]\((https?:\/\/(?:[\w.-]+\.)?static-file-service\.macro\.com\/file\/[^)\s]+)(?:\s"([^"]*)"\s*)?\)|\[([^\]]*)\]\(([^)\s?#]*\.(?:mp4|webm|ogg|mov|avi|mkv|m4v)(?:[?#][^)\s]*)?)(?:\s"([^"]*)"\s*)?\))\s*$
```
`is_video_markdown_link(url, text)` (:42): parse with a WHATWG URL parser (the `url` crate);
failure → false. True if the lowercased `pathname` ends with one of
`.mp4 .webm .ogg .mov .avi .mkv .m4v`. Also true if the host (lowercased) is
`static-file-service.macro.com` or ends with `.static-file-service.macro.com`, the lowercased
pathname starts with `/file/`, and the lowercased `text` **contains** a video extension.

##### transformers/image.ts

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `I_IMAGE_CONSTRAINED` | el | 18 | image, unknown-mention | `/^\s*<m-image>(.*?)<\/m-image>\s*$/` | Throw if `d.url` is falsy. `ImageNode{srcType:d.srcType\|\|'url', url, alt:d.alt\|\|'', id:d.id\|\|'', width:d.width\|\|0, height:d.height\|\|0, scale:d.scale\|\|1, constrainedWidth:d.constrainedWidth ?? undefined, constrainedHeight:.. ?? undefined}`. These are JS truthiness `\|\|` on raw JSON values with no coercion. If `is_import && append_to_preceding_list_item(..)` it returns there. Otherwise `parent.replace(image)`. Fallback UnknownEl 'Unknown Image'. | srcType local, empty url, or both constrained values null → None. Otherwise `{url,alt:alt\|\|'',srcType,id,width,height,scale,constrainedWidth,constrainedHeight}` |
| `IMAGE` | el | 75 | image | `/!\[([^\]]*)\]\(([^)\s]+)(?:\s"([^"]*)"\s*)?\)$/` (not `^`-anchored) | `ImageNode{srcType:'url', url:m[2], alt:m[1]\|\|'', width:0, height:0, id:''}`. Then the same list-item append rule, else `node.replace(image)`. | srcType local or empty url → None. Otherwise `![{alt\|\|''}]({url})` |
| `list_item_image(&[..])` ×3 | tm | 138 (calls index.ts:88,132,186) | image, listitem | `/$^/` | — (no replace) | ImageNode whose parent is a ListItemNode: the first exporter in the given order that returns Some(md) (called with `exportChildren = ||""`) gives `"\n" + " ".repeat(list_item_text_indent(item)) + md`. Else None. |

```rust
pub struct ListItemImage { exporters: &'static [&'static dyn ElementTransformer] }
pub fn list_item_image(exporters: &'static [&'static dyn ElementTransformer]) -> &'static ListItemImage;
```
- `append_to_preceding_list_item(paragraph, image, m)` (:108): `line = m.input()`.
  `imageStart = line.len - line.trimStart().len`. Return false if `imageStart == 0` or
  `imageStart != line.indexOf(m[0].trimStart())`. `list = paragraph.prev_sibling`, which must be a
  ListNode. `item` = nearest ListItemNode ancestor of `list.getLastDescendant()`, or
  `list.getLastChild()` when the list has no descendant. It must be a ListItemNode. Then
  `item.append(image)`, `paragraph.remove()`, and return true. `trimStart` is JS whitespace
  (WhiteSpace + LineTerminator), not `char::is_whitespace`. Use a shared `js_trim` helper.
- `list_item_text_indent(item)` (:164): depth = the number of ListItemNode ancestors reached by
  stepping `ancestor = ancestor.parent.parent` from `list.parent`.
  `marker = number ? "{item.getValue()}. " : "- "`. Result: `depth*2 + marker.len`.
  `LIST_INDENT_SIZE = 2` here is hard-coded at :161. In Rust, read it from
  `MarkdownOptions.list_indent`.

##### transformers/katex.ts

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `I_EQUATION_NODE` | tm | 29 | equation, unknown-mention | re=`/<m-katex-equation>(.*?)<\/m-katex-equation>/` (`new RegExp(..,'')`, :24) | Keys `equation,inline` must be present. `EquationNode(d.equation, d.inline)`. Fallback 'Unknown Equation'. | `{equation,inline}` |
| `E_INLINE_EQUATION_NODE` | tm | 60 | equation | re=`/(?<!\$)\$(?!\s)[^\n$]*?(?:[a-zA-Z\\=+\-*/^][^\n$]*?)(?<!\s)\$(?!\$|\d)/` | `eq = m[0].replace(/^\$|\$$/g,'')`, then `EquationNode(eq, inline=true)`. On error: log only. | inline EquationNode → `${eq}$` |
| `E_BLOCK_EQUATION_NODE` | tm | 119 | equation | re=`/\$\$(.*?)\$\$/` | `eq = m[0].replace(/^\$\$|\$\$$/g,'')`. `inline = shares_line_with_content(node)` (:100): walk the previous siblings, then the next siblings, stopping at a LineBreakNode. Any sibling that is not a TextNode whose `trim()` is `""` counts as content. Then `EquationNode(eq, inline)`. | non-inline EquationNode → `$${eq}$$` |
| `E_MULTILINE_BLOCK_EQUATION_NODE` | ml | 152 | equation | start `/^(.*)\$\$\s*$/`, end `/^(.*\$\$)(.*)$/` (required) | If children is non-empty → Declined. `latex = linesInBetween.join('\n').trim().replaceAll('{align}','{align*}')`. Declined if latex is empty, contains `$$`, `startMatch[1].trim()!==''` or `endMatch[2].trim()!==''`. Otherwise `root.append(EquationNode(latex,false))`. | always None |

`hasTextAfterEnd` is computed from `endMatch?.[2]?.trim() !== ''`. Under `undefined` semantics,
a missing group counts as "has text". The end group always exists, though, so this is only edge
semantics.

##### transformers/tables.ts

```rust
fn xml_matcher_with_attrs(tag: &str, flags: &str) -> Regex; // :48 `<{tag}((?:\s+[\w-]+="[^"]*")*)\s*>(.*?)</{tag}>`
fn serialize_xml_attrs(attrs: &[(&str, Option<String>)]) -> String; // :55 ` key="value"` for each Some, in order; value NOT escaped
fn parse_xml_attrs(raw: Option<&str>) -> HashMap<String, String>; // :64 /([\w-]+)="([^"]*)"/g, last wins
```
Regexes: `REG_EXP_XML_TABLE` with flags `""` (:94), `REG_EXP_XML_TABLE_ROW` with `"gs"` (:95),
`REG_EXP_XML_TABLE_CELL` with `"gs"` (:96). `A_POSITIVE` (:74) is `z.coerce.number()`
(i.e. `Number(str)`: `""`→0 fails positive, `" 12 "`→12, `"0x10"`→16, `"1e2"`→100), then finite
and > 0. `A_SPAN` (:75) is `Number(str)`, an integer, and ≥ 2. Port the JS `Number(string)`
grammar exactly (`StringToNumber`: trims JS whitespace, accepts hex/octal/binary prefixes,
`Infinity`, and empty → 0).

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `I_TABLE_NODE` | el | 132 | table, tablerow, tablecell | `/<m-table((?:\s+[\w-]+="[^"]*")*)\s*>(.*?)<\/m-table>/` (no `s`, unanchored) | `tableAttrs = parse(m[1])`. For each row match in `m[0]` (gs): `height` (A_POSITIVE, else skip) → `setHeight`. For each cell match in the row content: colspan/rowspan (A_SPAN), and `header` ∈ {row→ROW(1), col→COLUMN(2), both→BOTH(3)} → `setHeaderStyles(state)`. Then `convert_from_markdown_string(cell.replace(/\\n/g,'\n').replaceAll('<br>',''), internal_transformers_within_tables(), cell)`. `col-widths`: split on `,`, every value must pass A_POSITIVE, and the list must be non-empty → `setColWidths`. `node.replace(table)`. On error: log only, Handled (the paragraph stays). | `<m-table[ col-widths="w1,w2"]>` (each width `Math.round`ed). Per row `<m-table-row[ height="h"]>`. Per cell `<m-table-cell[ colspan][ rowspan][ header]>` (span only when > 1, header from state 1/2/3). Then `convert_to_markdown_string(internal_transformers_within_tables(), cell).replace(/\n/g,'\\n')` and `</m-table-cell>`, `</m-table-row>`, `</m-table>`. `Math.round` is round-half-up toward +∞ (`-2.5`→`-2`), not Rust `round`. Numbers are printed in JS format. |
| `E_TABLE_NODE` | el | 292 | table, tablerow, tablecell | `/^(?:\|)(.+)(?:\|)\s?$/` | If `/^(\| ?:?-*:? ?)+\|\s?$/` matches m[0]: the previous sibling must be a TableNode whose last child is a TableRowNode. Set every cell's header styles to `(NO_STATUS, NO_STATUS)`, then `parent.remove()`. Otherwise `cells = mapToTableCells(m[0])` (split m[1] on `\|`, then `createTableCell` for each). Walk the previous siblings while each is a Paragraph with exactly 1 child that is a TextNode whose content parses as a row: prepend the row and remove the sibling. Build a TableNode, padding each row to `maxCells` with `createTableCell('')`. If the previous sibling is a TableNode with a first-row child count equal to maxCells, append the rows to it and remove the parent. Otherwise `parent.replace(table)`. Then `table.selectEnd()`. `createTableCell(s)`: `convert_from_markdown_string(s.replace(/\\n/g,'\n').trim(), external_transformers_within_tables(), cell, shouldPreserveNewLines=true)`. | `$computeTableMapSkipCellCheck` grid. For each grid row, the cells: an empty slot or a covered slot gives `''`. An origin cell gives `convert_to_markdown_string(external_within, cell).replace(/\n/g,'\\n').trim()`. A row with a header state ROW or BOTH gets an extra line after it. Output: `\| a \| b \|`, plus `\| --- \| --- \|` after header rows. Lines joined with `\n`. |

`$convertFromMarkdownString` / `$convertToMarkdownString` used **inside** a replace or export are
re-entrant calls into the engine with a subtree root. `lexical_markdown` must expose
`convert_from_markdown_string(tx, md, &Transformers, Option<NodeKey>, preserve_new_lines)` and
`convert_to_markdown_string(state, &Transformers, Option<NodeKey>)` so they can be called
re-entrantly.

##### transformers/classedBlock.ts

Regexes: `REG_EXP_XML_MACRO_QUOTE = xml_matcher("m-email-thread-embed","")`, i.e.
`/<m-email-thread-embed>(.*?)<\/m-email-thread-embed>/` with no flags (:31).
`START = /^\s*<blockquote\b[^>]*>\s*(.*)$/i` (:32). `END = /^(.*?)\s*<\/blockquote>\s*$/i` (:33).
`TAG = /<\/?blockquote\b[^>]*>/gi` (:34).

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `HTML_BLOCKQUOTE` | ml | 149 | quote | start START, end END (required) | Children present → QuoteNode with those children. Otherwise `content = [start[1]??'', ...between, end?.[1]??''].join('\n').replace(/<br\s*\/?>/gi,'\n').trim()`. Empty → Declined. Otherwise `convert_from_markdown_string(content, html_blockquote_transformers(), quote)`. `root.append(quote)`. | always None |
| (same) `handle_import_after_start_match` | | 155 | | | `import_html_blockquote` (:122): depth=1. For each line from startLineIndex (the first line is `startMatch[1]`), run `consume_html_blockquote_line`. On `closed`: `create_html_blockquote_node(lines.join('\n'))` (`<br>`→`\n`, trim; empty → `false` → return **Skip** (JS null)). Otherwise convert with html_blockquote_transformers, `root.append(quote)`, return `Done{imported:true,last_line:index}`. Never closed → Skip. | |
| `I_MACRO_QUOTE` | el | 191 | classed-block, unknown-mention | REG_EXP_XML_MACRO_QUOTE | `meta = m[0].match(new RegExp('<m-email-thread-embed>({.*?})'))`. It must exist, else throw. Parse it. `tag` must be a string passing `is_allowed_tag_name`, and `classes` must be an array, else throw. `content = m[0].substring(meta[0].length, m[0].lastIndexOf('</m-email-thread-embed>'))`. Note: `contentStart` is the length of the metadata match measured from the **start of m[0]**. `ClassedBlockNode{tag,classes}`, then `convert_from_markdown_string(content.replace(/\\n/g,'\n'), macro_quote_transformers(), block)`, then `node.replace(block)`. Fallback UnknownEl 'Unknown Email Thread'. | ClassedBlockNode whose `__classes` includes `macro_quote`: `<m-email-thread-embed>{JSON({tag,classes})}` + `convert_to_markdown_string(macro_quote_transformers(), node).replace(/\n/g,'\\n')` + `</m-email-thread-embed>` |

`consume_html_blockquote_line(line, depth)` (:71): iterate the matches of TAG. A closing tag does
`depth -= 1`. If depth reaches 0, append `line[cursor..index]` and return closed. Otherwise append
through the tag. An opening tag does `depth += 1` and appends through the tag. At the end, append
the rest. Returns `{closed, depth, text}`.

##### transformers/cursorSystemNotification.ts

```
ATTRIBUTE_SOURCE = ([A-Za-z_\\][\w.:\\-]*)\s*=\s*"((?:<m-link>.*?</m-link>|[^"])*)"
OPEN_TAG  = /^<system\\?_notification((?:\s+ATTRIBUTE_SOURCE)*)\s*>/            (no flags)
CLOSE_TAG = /<\/system\\?_notification>\s*$/                                     (no flags)
ATTRIBUTE = new RegExp(ATTRIBUTE_SOURCE, 'g')
INTERNAL_LINK = /<m-link>(.*?)<\/m-link>/gs
```
(`\\?_` means an optional literal backslash before `_`. The sources are `String.raw`, so `\\`
is one regex-escaped backslash.)

| Const | Kind | Line | Deps | Regex | Replace | Export |
|---|---|---|---|---|---|---|
| `I_CURSOR_SYSTEM_NOTIFICATION` | ml | 93 | system-notification | start OPEN_TAG, end CLOSE_TAG (required) | Children non-empty → Declined. `data = read_cursor_system_notification(start[1] ?? '', between.join('\n'))`. None → Declined. `root.append(CursorSystemNotificationNode(data))`. | `build_cursor_system_notification_markdown(exportComponentProps())` |

```rust
pub fn parse_cursor_system_notification_attributes(tag: &str) -> IndexMap<String, String>; // :54; insertion order, later dup overwrites value but keeps first position (JS object semantics; integer-like keys sort first!)
pub fn read_cursor_system_notification(opening_tag: &str, body: &str) -> Option<CursorSystemNotificationData>; // :65 {source, attributes: rest, text: body.trim()}; None if source empty
pub fn build_cursor_system_notification_markdown(d: &CursorSystemNotificationData) -> String; // :76
```
- `unescapeAttribute` (:27) runs in order: `\_`→`_`, `&quot;`→`"`, `&amp;`→`&`. Then each
  INTERNAL_LINK match is replaced: parse its JSON; if it is an object, a non-empty string `text`
  wins, else a string `url`. Anything else keeps the whole match.
- `escapeAttribute` (:49): `&`→`&amp;`, then `"`→`&quot;`.
- Build: `<system_notification {name="esc(value)" for [source, ...attributes] joined ' '}>\n{text}\n</system_notification>`.
  Object-spread order puts `source` first. In the rest, JS integer-like keys come first in
  ascending order. Keep that ordering rule in `IndexMap` construction.

---

#### 4.2.3 Special regexes and Rust translation notes

**General.** All patterns are compiled with `regress::Regex::with_flags(src, flags)` and matched
over UTF-16 (`find_from_utf16`). No pattern uses the `u` or `v` flag, so matching is per code unit
and `.` / `[^x]` can match a lone surrogate half. Use regress's non-unicode mode, never the
unicode mode. `g` is never passed to regress: global iteration is `find_iter`. Drop the `\/`
escapes (identity escape, same meaning) when writing Rust raw strings.

**Flag inventory (Macro transformers + utils in scope):**
- `s` (dotAll): `xml_matcher` default (LINK_XML, UNLINKED_TEXT, MARK_XML, SEARCH_MATCH),
  UNKNOWN_MENTION (both), I_AGENT_ACTIVITY, I_REPLY_TARGET_NODE, I_AGENT_CONTEXT,
  `REG_EXP_XML_TABLE_ROW`/`_CELL` (`gs`), cursor `INTERNAL_LINK` (`gs`). In parsers.ts:
  `parseAgentActivities` :178, `parseCursorSystemNotifications` :186, `parseReplyTargets` :244,
  `stripAgentContext` :276, `replaceJsonTag` :384, `flattenTables` :423/425/429,
  `flattenEmailThreadEmbeds` :448, `markdownToEmbeddingText` :478 and :561.
- **Not** `s` (so `.` stops at `\n \r \u2028 \u2029`): every `mentions.ts` tag, I_DATABASE_QUERY*,
  I_SNAPSHOT_NODE, I_PASTE_NODE, I_HTML_RENDER, I_AWAIT_NODE, I_MAGIC_CHIP, I_WATERMARK,
  I_EQUATION_NODE, I_TABLE_NODE, I_MACRO_QUOTE, I_VIDEO, I_IMAGE_CONSTRAINED. Exporters escape
  U+2028/2029 only for agent activity and agent context. With a raw line terminator in any other
  payload, the specific tag regex fails. `UNKNOWN_MENTION` (which has `s`) then matches it and
  produces an UnknownMentionNode named after the tag. Preserve this.
- `i`: MACRO_CHECK_LIST (upstream), VIDEO_LINK, BR_TAG_TO_* (and their `/gi` replace),
  HTML entities (8), HTML text-format importers (3), HTML_BLOCKQUOTE start/end/tag and the `<br>`
  `/gi` replaces in classedBlock.ts:67,111, `decode_html_entities` (`gi`), `URL_SCHEME_PATTERN`,
  the `%25` fix-up `/gi` (auto-link.ts:86), and linkify-it internals (all `i`).
  **Conformance point (answered, R-1/Q15):** JS non-unicode `i` canonicalizes with `toUpperCase`
  and never maps a non-ASCII char onto ASCII, so `/s/i` does not match U+017F LONG S and
  `/[a-z]/i` does not match U+212A KELVIN SIGN. Stock regress 0.12.0 **does** match both
  (verified). Every pattern in this list compiles only with the patched regress of mitigation
  M-I (§2.9), and the `regex_icase_v8` conformance test covers each of them with `blockquote`,
  `mkv`, `&nbsp;` and the `<ſpan>`/`<Kbd>` probes.

**Dynamically built regexes and escaping.** Tag names are interpolated **unescaped**. Every
interpolated tag is a constant matching `[a-z_-]+`, which is safe. Rust builds these sources with
`format!` at `LazyLock` init, so none are built per call except those noted.
- `xml_matcher(tag, flags)` transformers.ts:57.
- `xml_matcher_with_attrs` tables.ts:48.
- HTML text-format importers htmlTextFormats.ts:76.
- Entity regexes transformers.ts:204-205. Escape class `[.*+?^=!:${}()|[\]/\\]`, a no-op for
  these inputs.
- `REG_EXP_KATEX_EQUATION` katex.ts:24.
- `I_CONNECT_APP` mentions.ts:622-623 and `I_ACCOUNT_MANAGER_REQUEST` :668-673.
- `VIDEO_LINK_REGEXP` video.ts:71.
- Cursor `OPEN_TAG` / `ATTRIBUTE` cursorSystemNotification.ts:19,23.
- I_MACRO_QUOTE metadata `new RegExp('<m-email-thread-embed>({.*?})')` classedBlock.ts:231.
  Built per call. It holds a **lone `{`**, which Annex B treats as a literal. regress accepts it
  and matches the same spans as V8 (Q16, verified with `a{`, `{"a"}`, `x{2,` and this pattern), so
  the source is used verbatim; Rust compiles it once in a `LazyLock`.
- `protect_empty_paragraph_lines` fence regexes transformers.ts:124-125 (`` `{N,}$ ``,
  `` ^[ \t]*`{N,}$ ``). N is a number, per call. Rust: compare backtick run lengths directly, with
  no regex.
- parsers.ts `replaceJsonTag` :384 (`gs`, tag from a constant list).
- html-entities.ts:13 `ENTITY`.

**KaTeX inline** (katex.ts:64,66):
`/(?<!\$)\$(?!\s)[^\n$]*?(?:[a-zA-Z\\=+\-*/^][^\n$]*?)(?<!\s)\$(?!\$|\d)/`. regress supports
lookbehind and lookahead, so use the pattern verbatim. Semantics: an opening `$` that is not
preceded by `$` and not followed by whitespace, then the shortest body that contains at least one
of `a-zA-Z \ = + - * / ^` with no `\n` or `$`, then a closing `$` that is not preceded by
whitespace and not followed by `$` or a digit. `\s` is ECMAScript whitespace, including
`U+00A0`, `U+FEFF`, `U+1680`, `U+2000-200A`, `U+2028/2029`, `U+202F`, `U+205F` and `U+3000`.
regress matches this. Test that `$5 and $6` does not match, `$x$` matches, and `$$x$$` does not
match the inline pattern.

**Unknown-mention backreference** `<(m-[a-zA-Z0-9_-]+)>(.*?)<\/\1>`. regress supports `\1`, so
use it verbatim. Sites:
- `transformers/unknownMention.ts:17` (regExp, `s`)
- `transformers/unknownMention.ts:18` (importRegExp, `s`)
- `utils/parsers.ts:561` (`gs`, used in `markdown_to_embedding_text`, which keeps `m-agent-context` matches)

Outside this scope, `notion/transformers.ts:223,275` also use `\1`.

**`/$^/` and `/$a/`.** Keep them as regexes (see 4.2.0: `/$^/` matches an empty line). `/$a/`
never matches anything.

**AutoLink matchers** (transformers/auto-link.ts). Both JS classes are constructed with `''`:
the source is `(?:)`, there are no flags, so they are not global or sticky. They override only
`exec`. `String.prototype.match(re)` calls `RegExpExec`, which calls the overridden `exec(S)`
once. The overrides never read or write `lastIndex` and always scan from 0. The engine only calls
them through `.match()` on import (importTextMatchTransformer.ts:32). They have no `trigger`, so
shortcuts never call them. Global/`matchAll`/`replace` use would be undefined behaviour and is
not supported.

```rust
pub struct AutoLinkMatcher;
impl Matcher for AutoLinkMatcher {
    fn find(&self, text: &[u16]) -> Option<Match> {
        // 1. candidates = find_auto_link_matches(text, CommonTlds)    (in order, see below)
        // 2. link = first c where
        //      !c.raw.contains('\\')
        //   && text.get(c.last_index) != Some('\\')
        //   && (c.index == 0 || text[c.index-1] != '\\')
        //    None -> return None
        // 3. bracketed = c.index > 0 && text[c.index-1]=='<' && text.get(c.last_index)==Some('>')
        // 4. start = bracketed ? index-1 : index;  end = bracketed ? last_index+1 : last_index
        // 5. Match { index: start, input: text, groups: [Some(text[start..end]), Some(link.url), Some(link.text)] }
    }
}

pub struct EscapedAutoLinkMatcher;
impl Matcher for EscapedAutoLinkMatcher {
    fn find(&self, source: &[u16]) -> Option<Match> {
        // 1. if !source.contains('\\') -> None
        // 2. decode, recording offsets (UTF-16 code units):
        //      let mut offsets = vec![]; let mut decoded = vec![]; let mut i = 0;
        //      while i < len { offsets.push(i);
        //          if source[i]=='\\' && i+1<len && is_ascii_punct(source[i+1]) { i += 1 }
        //          decoded.push(source[i]); i += 1 }
        //      offsets.push(len);
        //    is_ascii_punct(u) = u in 0x21..=0x2F | 0x3A..=0x40 | 0x5B..=0x60 | 0x7B..=0x7E   // /[!-/:-@[-`{-~]/
        //    (offsets[k] is the index of the BACKSLASH when decoded char k was escaped)
        // 3. for link in find_auto_link_matches(decoded, CommonTlds):
        //      start = offsets[link.index]; raw = source[start..offsets[link.last_index]];
        //      if raw == link.text { continue }        // nothing escaped: AUTO_LINK's job
        //      return Match { index: start, input: source, groups: [Some(raw), Some(link.text)] }
        // 4. None
    }
}
```

**URL candidates** (`utils/auto-link.ts`):
```rust
pub enum AutoLinkMatchMode { Protocol, CommonTlds, Fuzzy }          // :40, default Protocol
pub struct AutoLinkMatch { pub schema: String, pub index: usize, pub last_index: usize,
                           pub raw: String, pub text: String, pub url: String }
pub fn find_auto_link_matches(text: &[u16], mode: AutoLinkMatchMode) -> Vec<AutoLinkMatch>; // :95
pub fn find_next_auto_link_match(text: &[u16], mode: AutoLinkMatchMode) -> Option<AutoLinkMatch>; // :113
pub fn normalize_link_url(input: &str) -> Option<String>;            // :57
```
- `find_auto_link_matches`: run `linkifier.test(text)` and return empty on false. Then
  `linkifier.match(text)`. For each candidate:
  `url = normalize_link_url(if schema == "" { raw } else { candidate.url })`, and keep it when
  that is Some, with `url` replaced. Indices are UTF-16 code units.
- Linkifiers (`:4-38`):
  - `Protocol`: `{fuzzyLink:false, fuzzyEmail:true, fuzzyIP:false}`, default TLDs.
  - `CommonTlds`: `{fuzzyLink:true, fuzzyEmail:true, fuzzyIP:false}`, TLD list **replaced**
    (`keepOld=false`, so `__tlds_replaced__` and no 2-letter ccTLD pattern) with exactly
    `app biz ca co com dev edu gov info io me net org shop site store tv uk us xyz`, in that
    unsorted order, plus `src_xn`.
  - `Fuzzy`: the defaults.
  Only `CommonTlds` is used by transformers.
- `normalize_link_url(input)`:
  1. `trimmed = js_trim(input)`; empty → None.
  2. `probe` = trimmed with `\t\n\r` removed. `scheme` = lowercase of the capture of
     `/^([a-z][a-z\d+.-]*):/i` on probe. `remainder` = probe after that match.
  3. `isHostWithPort = scheme.is_some() && (scheme=="localhost" || scheme.contains('.')) && /^\d+(?:[/?#]|$)/.test(remainder)`.
  4. `candidate = if scheme.is_some() && !isHostWithPort { trimmed } else { "https://" + trimmed }`.
  5. WHATWG-parse candidate (the `url` crate); failure → None. The protocol must be one of
     `http:`, `https:`, `mailto:`, else None. For `mailto:` return `trimmed`.
  6. `parts = candidate.split(/([#?])/)` (capturing). `base = parts[0]`, `rest = parts[1..].concat()`.
     Each `/`-segment of base that contains `:` stays as it is. Every other segment becomes
     `encodeURI(seg)`, then `/%25([\da-f]{2})/gi` → `%$1`. Join with `/`. Return `base + rest`.
     `encodeURI` keeps `A-Za-z0-9;,/?:@&=+$-_.!~*'()#` and percent-encodes UTF-8 bytes uppercase.
     A lone surrogate throws → None. Rust `&str` cannot hold one, but the UTF-16 input can, so
     return None.
- **linkify-it is not hand-written.** The "hand-written URL matcher" is `linkify-it` 5.0.2
  (dependency `uc.micro` ^2). No Rust crate matches its behaviour (`linkify` differs). Port
  `node_modules/linkify-it/index.mjs` and `lib/re.mjs` (193 lines) into `utils/linkify/`. Keep
  every regex source verbatim and compile it with regress `i` in non-unicode mode. Inline the
  `uc.micro` class sources (`P`, `Z`, `Cc`, `Cf`, `Any`) as strings. Port these parts exactly:
  - schemas `http:`, `https:`→`http:`, `ftp:`→`http:`, `//` (rejecting a `:` or `/` at `pos-3`),
    and `mailto:`
  - `test()`: schema scan, then fuzzy-link via `host_fuzzy_test` + `link_no_ip_fuzzy`, then
    fuzzy-email when the text contains `@`
  - `match()` (`index.mjs:472`, merge at `:536-543`): three candidate streams (schemed with
    `index = m.index + m[1].length`, fuzzy-email, fuzzy-link). Per round,
    `candidate = choose(choose(schemed[i0], email[i1]), fuzzy[i2])`, where `choose(a, b)` returns
    the one with the lower `index`, and on equal index the one with the larger `lastIndex`, `a` on
    a tie. So on equal index and lastIndex the order is schemed > fuzzy-email > fuzzy-link. Advance
    only the stream the candidate came from. Skip a candidate whose `index < last_index` of the
    previously accepted one.
  - `normalize`: schema `""` → `http://`+url; `mailto:` without a `mailto:` prefix gets one.
    `text` stays raw.
  - `Match.schema` is lowercased.

  Pin the crate to the JS version with a differential corpus test. Lines touched:
  `linkify-it/index.mjs:46-108` (schemas), `compile` `:136`, `Match` `:260`, `test` `:393`,
  `match` `:472`, `tlds` `:601`, `normalize` `:627` (the file has 646 lines). Q19: accepted as a full
  port, with a differential fuzz harness against linkify-it 5.0.2 (§6.4).

---

#### 4.2.4 Upstream-derived transformers: Macro changes

- **HEADING, QUOTE, CODE, LINK, the 9 text-format transformers:** used **unchanged** (same object
  identity) through `TRANSFORMERS.filter(..)` (customTransformers.ts:59). They are not wrapped.
  The only Macro change is the `@lexical/markdown` patch: `LIST_INDENT_SIZE` 4→2 in
  `MarkdownTransformers.ts:346` and `utils.ts:344`. It is already captured as
  `MarkdownOptions.list_indent = 2`. The patch contains nothing else. They come from
  `lexical_markdown`, so do not redefine them here.
- **`customTransformer(original)`** (customTransformers.ts:14) returns `{...original, replace}`,
  so `dependencies`, `regExp`, `export` and `triggerOnEnter: true` are all inherited. The new
  `replace(parent, children, match, isImport)`:
  1. If `parent` is a HeadingNode → **Declined**. Upstream would turn `# - x` typed in a heading
     into a list. Macro refuses. Import never hits this, because the parent is a fresh paragraph.
  2. Only for `ORDERED_LIST`: `next = parent.next_sibling`, `start = Number(match[2])`. If `start`
     is finite and `next` is a ListNode with `listType == "number"`, call
     `next.set_start(start)`. Upstream's `listReplace` then inserts the new item **before**
     `next`'s first child, without touching `start`. The net effect of typing `6. ` above a
     numbered list: the merged list starts at 6. `Number("0007")` = 7, and over 308 digits gives
     Infinity, which skips the call. Convert to `ListNode.start`'s Rust type, saturating.
  3. Call `original.replace(..)` and return Handled. The original's return value is discarded,
     so it is always "undefined".
- **`ORDERED_LIST_ENTER`** (:52): the wrapped ordered list with regex `/^(\s*)(\d{1,})\.$/`
  (no trailing whitespace required). It is not in any list. Export it for the editor-side
  trigger-on-enter set.
- `HTML_TEXT_FORMAT_*` exists because upstream text-format transformers only support symmetric
  delimiters (htmlTextFormats.ts:98-102). The exporter coexists with upstream's export of the
  symmetric formats: it calls `exportFormat` first and then wraps.

---

#### 4.2.5 Utils in scope (string-level, no engine)

```rust
// utils/parsers.ts
pub fn parse_user_mentions(text: &str) -> String;               // :24  displayName || email.split('@')[0] || email || ''
pub fn parse_user_mentions_for_search(text: &str) -> String;    // :32  bot| -> displayName||email||'Bot'; macro| -> rest||'Guest'; else 'Guest'
pub fn parse_contact_mentions(text: &str) -> String;            // :59
pub fn parse_date_mentions(text: &str) -> String;               // :73
pub fn parse_document_mentions(text: &str) -> String;           // :87
pub fn parse_agent_session_mentions(text: &str) -> String;      // :101
pub fn parse_pull_request_mentions(text: &str) -> String;       // :119 label||id||githubPullRequestRef(url)||''
pub fn parse_account_manager_requests(text: &str) -> String;    // :144
pub fn parse_connect_apps(text: &str) -> String;                // :152
pub fn parse_database_queries(text: &str) -> String;            // :165
pub fn parse_agent_activities(text: &str) -> String;            // :176 /<m-agent-activity>.*?<\/m-agent-activity>(?:\r?\n)*/gs -> ''
pub fn parse_cursor_system_notifications(text: &str) -> String; // :184 /<system_notification\b[^>]*>(.*?)<\/system_notification>/gs -> body.trim()
pub fn parse_tag_mentions(text: &str) -> String;                // :191
pub fn parse_links(text: &str) -> String;                       // :202
pub fn parse_group_mentions(text: &str) -> String;              // :213
pub fn parse_document_cards(text: &str) -> String;              // :227
pub fn parse_reply_targets(text: &str) -> String;               // :242 (gs)
pub fn parse_snapshots(text: &str) -> String;                   // :256 starts '{' ? raw : atob->UTF-8 decode
pub fn strip_agent_context(text: &str) -> String;               // :274 /^<m-agent-context>(.*?)<\/m-agent-context>(?:\r?\n\r?\n)?/s
pub fn markdown_to_plain_text(md: &str) -> String;              // :308
pub fn markdown_to_search_text(md: &str) -> String;             // :317
pub fn markdown_to_embedding_text(md: &str) -> String;          // :474
// utils/quote-markdown.ts
pub fn quote_markdown(content: &str) -> Option<String>;         // :6
// utils/markdown-mentions.ts
pub fn extract_channel_mentions_from_markdown(md: &str) -> Vec<ChannelMention>; // :12 import with all_transformers(), then extract_channel_mentions
```
- Every `parse_*` uses `/<TAG>(.*?)<\/TAG>/g` (no `s` unless noted) and replaces with a function
  of the JSON payload. A parse failure gives `''`.
- `flattenMarkdown` (:321) order: agentActivities, userMentions (plain or search), contacts,
  dates, groups, documentMentions, PRs, agentSessions, tags, connectApps, accountManager,
  cursorNotifications, dbQueries, snapshots, documentCards, links, replyTargets,
  stripAgentContext.
- `githubPullRequestRef` (:136): `/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9][0-9]*)/` → `o/r#n`.
- `markdown_to_embedding_text` order:
  1. `strip_agent_context`, then snapshots (`gs`), then `flattenTables` (`gs` over
     `<m-table(?:\s[^>]*)?>`, rows and cells; cells get `\\n`→space and `<br>`→space, trimmed,
     joined ` | `, rows joined `\n`), then `flattenEmailThreadEmbeds` (drop the leading
     `/^\{.*?\}/`, then `\\n`→`\n`).
  2. `replaceJsonTag` (`gs`) for `m-agent-session-mention`, `m-document-mention`,
     `m-document-card`, `m-pr-mention`, `m-link`, `m-image`, `m-video`, `m-katex-equation`,
     `m-user-mention`, `m-contact-mention`, `m-date-mention`, `m-group-mention`, `m-tag`,
     `m-theme-mention`, `m-connect-app`, `m-account-manager-request`, `m-db-query`, `m-await`,
     `m-reply-target`, `m-watermark`. The renderers are as written at :485-555.
  3. Drop every remaining `<(m-…)>…</\1>` except `m-agent-context`.
- `atob` uses forgiving-base64 decode; invalid input throws → `''`. Use a forgiving decoder
  (strip ASCII whitespace, allow missing padding), then decode the bytes as UTF-8 with
  replacement (`TextDecoder` default).
- `quote_markdown` (:6): `<m-agent-context>`→`&lt;m-agent-context>` and the closing tag likewise,
  `trim`, then per line strip `/^\s*>+\s?/`, `trim`. Empty → None. Otherwise prefix each line
  with `> `.

---

#### 4.2.6 Mapping table

Paths are relative to the repo root. TS files are under `packages/lexical-core/`.

| Rust const | TS name | Source (file:line) | Type | Regex features |
|---|---|---|---|---|
| `MACRO_ORDERED_LIST` | `orderedListTransformer` | transformers/customTransformers.ts:49 | el | upstream ORDERED_LIST regex |
| `HTML_ENTITY_TRANSFORMERS[i]` (built by `entity_to_unicode_transformer`) | `createEntityToUnicodeTransformer` | transformers/transformers.ts:200 | tm | `i` (needs M-I, §2.9) |
| `I_DATABASE_QUERY_BLOCK` | I_DATABASE_QUERY_BLOCK | transformers/databaseQuery.ts:19 | el | `^…$`, lazy |
| `I_DATABASE_QUERY` | I_DATABASE_QUERY | transformers/databaseQuery.ts:40 | tm | lazy |
| `I_SNAPSHOT_NODE` | I_SNAPSHOT_NODE | transformers/snapshot.ts:17 | tm | lazy |
| `E_SNAPSHOT_NODE` | E_SNAPSHOT_NODE | transformers/snapshot.ts:70 | el | `/$^/` |
| `I_PASTE_NODE` | I_PASTE_NODE | transformers/paste.ts:19 | el | lazy, unanchored |
| `E_PASTE_NODE` | E_PASTE_NODE | transformers/paste.ts:56 | el | `/$^/` |
| `I_HTML_RENDER` | I_HTML_RENDER | transformers/htmlRender.ts:18 | tm | lazy |
| `PRESERVE_LINES` | PRESERVE_LINES | transformers/transformers.ts:136 | el | dynamic class `[ \u200b]` |
| `BR_TAG_TO_SPACE` | BR_TAG_TO_SPACE | transformers/transformers.ts:164 | tm | `i` |
| `BR_TAG_TO_LINE_BREAK` | BR_TAG_TO_LINE_BREAK | transformers/transformers.ts:185 | tm | `i` |
| `HTML_ENTITY_TRANSFORMERS[0..8]` | HTML_ENTITY_TRANSFORMERS (8) | transformers/transformers.ts:200,218; utils/html-entities.ts:2 | tm ×8 | `i`, dynamic, escaped |
| `LINK_XML` | LINK_XML | transformers/transformers.ts:242 | tm | `s`, lazy, dynamic (`xml_matcher`) |
| `UNLINKED_TEXT` | UNLINKED_TEXT | transformers/transformers.ts:293 | tm | = LINK_XML |
| `MARK_XML` | MARK_XML | transformers/transformers.ts:312 | tm | `s`, dynamic |
| `SEARCH_MATCH` | SEARCH_MATCH | transformers/transformers.ts:333 | tm | `s`, dynamic |
| `HR` | HR | transformers/transformers.ts:354 | el | alternation |
| `VIDEO_LINK` | VIDEO_LINK | transformers/video.ts:148 (regex :71) | el | `i`, dynamic, alternation, 6 groups |
| `I_VIDEO` | I_VIDEO | transformers/video.ts:83 | el | anchored, lazy |
| `I_IMAGE_CONSTRAINED` | I_IMAGE_CONSTRAINED | transformers/image.ts:18 | el | anchored, lazy |
| `IMAGE` | IMAGE | transformers/image.ts:75 | el | `$`-anchored only |
| `list_item_image()` ×3 | listItemImage(..) | transformers/image.ts:138; transformers/index.ts:88,132,186 | tm (factory) | `/$^/` |
| `I_USER_MENTION` | I_USER_MENTION | transformers/mentions.ts:52 | tm | lazy |
| `E_USER_MENTION` | E_USER_MENTION | transformers/mentions.ts:94 | el | `/$^/` |
| `I_CONTACT_MENTION` | I_CONTACT_MENTION | transformers/mentions.ts:119 | tm | lazy |
| `E_CONTACT_MENTION` | E_CONTACT_MENTION | transformers/mentions.ts:155 | el | `/$^/` |
| `I_DATE_MENTION` | I_DATE_MENTION | transformers/mentions.ts:183 | tm | lazy |
| `E_DATE_MENTION` | E_DATE_MENTION | transformers/mentions.ts:211 | el | `/$^/` |
| `I_DOCUMENT_MENTION` | I_DOCUMENT_MENTION | transformers/mentions.ts:238 | tm | lazy |
| `E_DOCUMENT_MENTION` | E_DOCUMENT_MENTION | transformers/mentions.ts:296 | el | `/$^/` |
| `I_PR_MENTION` | I_PR_MENTION | transformers/mentions.ts:331 | tm | lazy |
| `E_PR_MENTION` | E_PR_MENTION | transformers/mentions.ts:375 | el | `/$^/` |
| `I_AGENT_SESSION_MENTION` | I_AGENT_SESSION_MENTION | transformers/mentions.ts:407 | tm | lazy |
| `I_AGENT_SESSION_CARD` | I_AGENT_SESSION_CARD | transformers/mentions.ts:444 | el | `/$^/` |
| `E_AGENT_SESSION_MENTION` | E_AGENT_SESSION_MENTION | transformers/mentions.ts:458 | el | `/$^/` |
| `I_GROUP_MENTION` | I_GROUP_MENTION | transformers/mentions.ts:486 | tm | lazy |
| `E_GROUP_MENTION` | E_GROUP_MENTION | transformers/mentions.ts:514 | el | `/$^/` |
| `I_DOCUMENT_CARD` | I_DOCUMENT_CARD | transformers/mentions.ts:540 | el | lazy, unanchored |
| `I_THEME_MENTION` | I_THEME_MENTION | transformers/mentions.ts:585 | tm | lazy |
| `I_CONNECT_APP` | I_CONNECT_APP | transformers/mentions.ts:619 | tm | lazy, dynamic |
| `I_ACCOUNT_MANAGER_REQUEST` | I_ACCOUNT_MANAGER_REQUEST | transformers/mentions.ts:665 | tm | lazy, dynamic |
| `I_TAG_MENTION` | I_TAG_MENTION | transformers/mentions.ts:698 | tm | lazy |
| `E_TAG_MENTION` | E_TAG_MENTION | transformers/mentions.ts:744 | el | `/$^/` |
| `E_DOCUMENT_CARD` | E_DOCUMENT_CARD | transformers/mentions.ts:764 | el | `/$^/` |
| `I_BOOKING_LINK_MENTION` | I_BOOKING_LINK_MENTION | transformers/mentions.ts:794 | tm | lazy |
| `E_BOOKING_LINK_MENTION` | E_BOOKING_LINK_MENTION | transformers/mentions.ts:836 | el | `/$^/` |
| `I_AWAIT_NODE` | I_AWAIT_NODE | transformers/await.ts:16 | tm | lazy |
| `I_MAGIC_CHIP` | I_MAGIC_CHIP | transformers/magicChip.ts:29 | el | lazy, unanchored |
| `I_AGENT_ACTIVITY` | I_AGENT_ACTIVITY | transformers/agentActivity.ts:26 | el | `s`, lazy, unanchored |
| `I_REPLY_TARGET_NODE` | I_REPLY_TARGET_NODE | transformers/reply-target.ts:16 | el | `s`, anchored |
| `E_REPLY_TARGET_NODE` | E_REPLY_TARGET_NODE | transformers/reply-target.ts:39 | el | `/$^/` |
| `I_AGENT_CONTEXT` | I_AGENT_CONTEXT | transformers/agentContext.ts:26 | el | `s`, anchored |
| `I_TABLE_NODE` | I_TABLE_NODE | transformers/tables.ts:132 (regex :94) | el | dynamic, attrs group, lazy; inner `gs` |
| `E_TABLE_NODE` | E_TABLE_NODE | transformers/tables.ts:292 (regex :246,:247) | el | anchored, greedy |
| `HTML_BLOCKQUOTE` | HTML_BLOCKQUOTE | transformers/classedBlock.ts:149 (regex :32-34) | ml + after-start | `i`, `\b`, `gi` scan |
| `I_MACRO_QUOTE` | I_MACRO_QUOTE | transformers/classedBlock.ts:191 (regex :31, :231) | el | dynamic, lone `{` literal |
| `I_EQUATION_NODE` | I_EQUATION_NODE | transformers/katex.ts:29 (regex :24) | tm | dynamic, lazy |
| `E_INLINE_EQUATION_NODE` | E_INLINE_EQUATION_NODE | transformers/katex.ts:60 | tm | **lookbehind ×2, lookahead ×2** |
| `E_BLOCK_EQUATION_NODE` | E_BLOCK_EQUATION_NODE | transformers/katex.ts:119 | tm | lazy |
| `E_MULTILINE_BLOCK_EQUATION_NODE` | E_MULTILINE_BLOCK_EQUATION_NODE | transformers/katex.ts:152 | ml | anchored, greedy |
| `I_WATERMARK` | I_WATERMARK | transformers/watermark.ts:14 | el | lazy, unanchored |
| `E_WATERMARK` | E_WATERMARK | transformers/watermark.ts:44 | el | `/$^/` |
| `HTML_TEXT_FORMAT_EXPORTER` | HTML_TEXT_FORMAT_EXPORTER | transformers/htmlTextFormats.ts:103 | tm | `/$a/` |
| `HTML_TEXT_FORMAT_IMPORTERS[0..3]` | HTML_TEXT_FORMAT_IMPORTERS (u, sup, sub) | transformers/htmlTextFormats.ts:71,94 | tm ×3 | `i`, dynamic, lazy |
| `MACRO_ORDERED_LIST` | customTransformer(ORDERED_LIST) | transformers/customTransformers.ts:49 (upstream packages/lexical-markdown/src/MarkdownTransformers.ts:720) | el | upstream |
| `MACRO_CHECK_LIST` | customTransformer(CHECK_LIST) | transformers/customTransformers.ts:63 (upstream :707) | el | upstream, `i` |
| `MACRO_UNORDERED_LIST` | customTransformer(UNORDERED_LIST) | transformers/customTransformers.ts:64 (upstream :694) | el | upstream |
| `ORDERED_LIST_ENTER` | ORDERED_LIST_ENTER | transformers/customTransformers.ts:52 | el | anchored |
| `ESCAPED_AUTO_LINK` | ESCAPED_AUTO_LINK | transformers/auto-link.ts:66 (class :44) | tm | `Matcher` (exec override) |
| `AUTO_LINK` | AUTO_LINK | transformers/auto-link.ts:81 (class :15) | tm | `Matcher` (exec override, linkify-it) |
| `I_CURSOR_SYSTEM_NOTIFICATION` | I_CURSOR_SYSTEM_NOTIFICATION | transformers/cursorSystemNotification.ts:93 (regex :14-24) | ml | dynamic, nested alternation, `\\?` |
| `UNKNOWN_MENTION` | UNKNOWN_MENTION | transformers/unknownMention.ts:11 | tm | **backreference `\1`**, `s` |
| `custom_transformers()` | CUSTOM_TRANSFORMERS | transformers/customTransformers.ts:57 | list (20) | — |
| `internal_transformers()` | INTERNAL_TRANSFORMERS | transformers/index.ts:73 | list (63) | — |
| `external_transformers()` | EXTERNAL_TRANSFORMERS | transformers/index.ts:123 | list (66) | — |
| `all_transformers()` | ALL_TRANSFORMERS | transformers/index.ts:170 | list (89) | — |
| `is_conversion_only` | isConversionOnlyTransformer | transformers/transformers.ts:71 | fn | — |
| `protect_empty_paragraph_lines` | protectEmptyParagraphLines | transformers/transformers.ts:106 | fn | dynamic fence regexes → hand code |
| `wrap_xml` / `xml_matcher` | wrapXml / xmlMatcher | transformers/transformers.ts:51,57 | fn | dynamic |
| `replace_text_with_unknown_mention` / `replace_element_with_unknown_mention` | same | transformers/unknownFallback.ts:9,16 | fn | — |
| `parse_cursor_system_notification_attributes` / `read_…` / `build_…_markdown` | same | transformers/cursorSystemNotification.ts:54,65,76 | fn | `g` |
| `is_video_markdown_link` | isVideoMarkdownLink | transformers/video.ts:42 | fn | — |
| `normalize_link_url` / `find_auto_link_matches` / `find_next_auto_link_match` | same | utils/auto-link.ts:57,95,113 | fn | `i`, capturing split |
| `utils::linkify::LinkifyIt` | linkify-it 5.0.2 | node_modules/linkify-it/index.mjs, lib/re.mjs | port | `i`, uc.micro classes |
| `decode_html_entities` / `HTML_ENTITIES` | same | utils/html-entities.ts:16,2 | fn/const | `gi` |
| `markdown_to_plain_text` / `_search_text` / `_embedding_text` / `strip_agent_context` / `parse_*` (17) | same | utils/parsers.ts:24-564 | fn | `g`/`gs`, `\1` at :561 |
| `quote_markdown` | quoteMarkdown | utils/quote-markdown.ts:6 | fn | — |
| `extract_channel_mentions_from_markdown` | extractChannelMentionsFromMarkdown | utils/markdown-mentions.ts:12 | fn | — |

**Count summary:** 63 internal / 66 external / 89 all entries. The union is 93 objects: 13
upstream (used as is) and 80 Macro, of which 3 are `listItemImage` instances. The Rust side has
77 consts from the lists plus 2 unlisted (`ORDERED_LIST_ENTER`, `BR_TAG_TO_SPACE`), so 79 consts,
and 1 factory (`list_item_image`). By kind: 35 element, 42 text-match, 3 multiline, 0
text-format. Two exec-overriding `Matcher`s. One lookbehind/lookahead pattern. Three
backreference sites.

#### Not ported (view / DOM)

- `transformers/mentions.ts:285` `currentBrowserHostname`: `window` reads are replaced by `MacroMarkdownOptions.app_hostname`.
- `transformers/mentions.ts:311,779`, `transformers/snapshot.ts:86-89`: direct `window.location.hostname`, same replacement (see the unresolved no-hostname case).
- `apps/web/src/lib/core/component/LexicalMarkdown/plugins/markdown-shortcuts/markdownShortcutsPlugin.ts:38`: shortcut filtering by `isConversionOnlyTransformer` stays in JS. Rust only exposes the flag.
- `apps/web/src/lib/core/component/LexicalMarkdown/plugins/pluginManager.ts:86`: the `triggerOnEnterTransformers` wiring stays in JS.
- `transformers/tables.ts:113,123`: `_TABLE_CELL_TRANSFORMERS` / `_TABLE_CELL_EXPORT_TRANSFORMERS` are dead code.
- `console.error` / `console.warn` in every catch: replaced by `tracing` events without payloads.
### 4.3 nodeId/peerId, comment-only gate, exports, XML, Loro snapshots

Crate `macro_document_model` holds ids, ownership, the comment-only gate, every export
(plaintext, search, cognition, markdown, embedding text, comment-mark context, XML) and the Notion
importer. The Loro side goes in **`lexical_loro`**: the mirror shape, the generic
`set_state` diff, the golden base and snapshot export. It depends on `loro` and `lexical_model`
only. sync-service already links `loro` 1.16.2, and it reads the same mirror shape back
(`deep_json`). `macro_document_model::snapshot` combines the two: markdown to state, then state to
snapshot.

Macro paths are relative to the Macro repo root. Upstream paths are relative to the Lexical repo
root. "lexical-service" means `services/lexical-service/src`.

#### Facts that constrain the port

- lexical-service builds one headless editor per call (`lib/editor.ts:4`). It uses
  `nodes: SupportedNodeTypes`, with **no `NodeReplacements` and no plugins**. Nothing in
  lexical-service assigns ids. Exports see only the ids that are stored. Rust callers of the
  gate and the doc-id export routes use `EditorConfig::Export` (§4.0), never an `EditorType`
  preset, and no id plugin. The only node-class transforms that still run are those declared on
  the classes themselves (`$config`/`static transform`: ListNode, ListItemNode,
  `nodes/AgentSessionMentionNode.ts`).
- `/xml` never parses through Lexical. `toXml` walks the raw JSON (`transformers/xml/index.ts:23`).
- sync-service's `/document/{id}/raw` returns `loro_doc.get_deep_value().to_json()`
  (`services/sync-service/src/state.rs:82`, `inbound/durable_object.rs:477`). That is the mirror shape
  in plain JSON, and it is identical to Lexical `SerializedEditorState`. Integral JS numbers are stored
  as Loro `I64` (verified with `exportJsonUpdates`: `"value":1`), so `version`, `indent` and so on
  arrive as JSON integers.
- Id generator: `nanoid` **5.1.16** (`bun.lock:4070`, `packages/lexical-core/package.json:43`). It uses the
  default url-safe 64-symbol alphabet `A-Za-z0-9_-` drawn from `crypto.getRandomValues` (mask 63, no
  bias). Lengths: `idLength ?? 11` for the plugin (`plugins/nodeIdPlugin.ts:115`) and a hard-coded
  `8` in `$updateAllNodeIds` (`:264`). The web passes `idLength: 8`
  (`apps/web/src/lib/core/component/LexicalMarkdown/context/LexicalWrapperContext.tsx:123`).
  `services/ai-editing-worker/src/ai-editing/ai-toolkit/session.ts:40` passes nothing, so AI-created
  nodes get **11**-char ids. `NODE_ID_LENGTH = 8` (lexical-service `constants.ts:1`) is unused.

#### Module layout

```
crates/client/lexical/macro_document_model/src/
  ids/mod.rs              // NODE_ID, get_id/set_id/assert_id/regen_id/invalidate_id, NanoIdRng
  ids/mappings.rs         // NodeIdMappings, NodeIdPlugin (transform + commit pass), update_all_node_ids
  ids/clipboard.rs        // prepare_clipboard_nodes (SELECTION_INSERT_CLIPBOARD_NODES @ CRITICAL)
  peer/mod.rs             // PEER_ID, SHARED_PEER_IDS, LOCAL, accessors, remove_peer_id, validator
  peer/plugin.rs          // PeerIdPlugin (transform + commit pass), update_all_ownership
  comment_gate.rs         // is_comment_only_change
  export/mod.rs           // ExportNode types (SearchableNode, CognitionNode, NewMdNode)
  export/plaintext.rs     // to_plaintext
  export/search.rs        // extract_search_text, to_search_text
  export/cognition.rs     // element_node_to_markdown, to_cognition_text, to_cognition_v2
  export/markdown.rs      // MarkdownTarget, to_markdown_text
  export/embedding.rs     // markdown_to_embedding_text (+ table/email/snapshot flatteners)
  export/comment_mark.rs  // to_comment_mark_context (calls 4.1a nodes::comment)
  xml/mod.rs              // XmlNode, el, build_xml, to_xml
  xml/builder.rs          // fast-xml-parser 4.5.7 ordered builder clone (quick-xml writer)
  xml/codecs.rs           // serialize_node per type, serialize_unknown, flatten
  notion/mod.rs           // NotionLinks, notion_markdown_to_serialized_editor_state
  notion/links.rs         // notion_ids_in, find_notion_page, find_notion_user
  notion/lines.rs         // notion_lines
  notion/transformers.rs  // notion_transformers(links)
  snapshot.rs             // markdown_to_serialized_editor_state_with_ids, *_to_loro_snapshot

crates/client/lexical/lexical_loro/src/
  lib.rs
  mirror.rs               // MirrorShape rules, set_state (loro-mirror diff), read_state
  golden.rs               // MARKDOWN_GOLDEN (include_bytes static_assets/markdown-golden.1.bin)
  snapshot.rs             // serialized_editor_state_to_loro_snapshot, raw_state_to_loro_snapshot
```

#### 4.3.1 Node ids (`ids/`)

`idState = createState('id', { parse: v => typeof v === 'string' ? v : null })`
(`plugins/nodeIdPlugin.ts:41`). There is no `unparse`, so it is the identity, and there is no `isEqual`,
so it is `Object.is`. The default is `parse(undefined) = null`. JSON placement is `node["$"]["id"]`
(`NODE_STATE_KEY = '$'`, upstream `packages/lexical/src/LexicalConstants.ts:153`). A key equal to its
default (null) is omitted, and `"$"` is omitted when empty. Unknown `$` keys round-trip untouched.

```rust
use lexical_model::{StateKey, EditorState, Transaction, NodeKey, Commit, TransformScope};

/// `"$".id`. Parse: a JSON string, else None. Serialize: omitted when None.
pub static NODE_ID: StateKey<Option<String>> = StateKey::new("id");

pub const DEFAULT_PLUGIN_ID_LENGTH: usize = 11; // nodeIdPlugin.ts:115
pub const UPDATE_ALL_ID_LENGTH: usize = 8;      // nodeIdPlugin.ts:264

/// Seeded nanoid generator over the url-safe alphabet with mask 63. Its state lives in
/// `NodeIdState` (an `ExtensionState`, S1 §14.3 / A-Q5), so a rolled-back transaction rewinds it
/// and fuzzing is deterministic. The host seeds it at build (from `getrandom`, wasm feature
/// `wasm_js`); tests pass a fixed seed. No `Box<dyn ..>` generator in plugin structs.
#[derive(Clone, Debug)]
pub struct NanoIdRng { /* seed state */ }
impl NanoIdRng {
    pub fn from_seed(seed: [u8; 32]) -> Self;
    pub fn generate(&mut self, len: usize) -> String;
}
pub const NANOID_ALPHABET: &[u8; 64] =
    b"useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

pub fn get_id(state: &EditorState, key: NodeKey) -> Option<&str>;
pub fn set_id(tx: &mut Transaction, key: NodeKey, id: String) -> Result<()>;
/// Always writes a fresh id (`$regenId`, :63).
pub fn regen_id(tx: &mut Transaction, key: NodeKey, len: usize, ids: &mut NanoIdRng) -> Result<String>;
/// Returns the existing id. When it is None or "" (JS falsy), writes a fresh one (`$assertId`, :98).
pub fn assert_id(tx: &mut Transaction, key: NodeKey, len: usize, ids: &mut NanoIdRng) -> Result<String>;
/// Sets NODE_ID = None on `key` and every descendant (recursive pre-order, :86).
pub fn invalidate_id(tx: &mut Transaction, key: NodeKey) -> Result<()>;

/// Bidirectional durable-id <-> NodeKey map (:28). Plain HashMaps. Rust NodeKeys are
/// generational, so stale keys cannot alias.
#[derive(Default, Debug, Clone)]
pub struct NodeIdMappings {
    pub id_to_key: std::collections::HashMap<String, NodeKey>,
    pub key_to_id: std::collections::HashMap<NodeKey, String>,
}

/// The plugin's mutable state, an `ExtensionState` (S1 §14.3): staged per transaction, read with
/// `tx.extension::<NodeIdState>()`, written with `tx.extension_mut::<NodeIdState>()`.
#[derive(Clone, Debug)]
pub struct NodeIdState { pub id_length: usize, pub mappings: NodeIdMappings, pub ids: NanoIdRng }

pub struct NodeIdPlugin;
impl NodeIdPlugin {
    /// Registers `NodeIdState { id_length: id_length.unwrap_or(11), .. }` with
    /// `EditorBuilder::extension_state` and `id_transform` for exactly `classes` (JS: `props.nodes`
    /// filtered by `editor.hasNode`, `plugins/nodeIdPlugin.ts:117,169-183`) with
    /// `EditorBuilder::transform_each(id_transform, TransformScope::Types(classes))` (CR-14). Every
    /// caller passes `SUPPORTED_NODE_TYPES` (the 57 type names), which excludes `root`, so the root
    /// never gets an id from the transform. Also registers `NodeIdPlugin` with
    /// `EditorBuilder::plugin`. With `initial_state` set, `build()` runs `after_commit` with a
    /// synthetic all-Created commit (`skipInitialization: false`); the host takes those commits
    /// with `Editor::take_initial_commits` / `EditorCore::take_initial_output` (S1 §4.2, §15).
    pub fn register(b: lexical_model::EditorBuilder, classes: &'static [&'static str],
                    id_length: Option<usize>, seed: [u8; 32]) -> lexical_model::EditorBuilder;
    /// `$getNodeById` (:233). Looks the key up in `id_to_key` (`editor.extension::<NodeIdState>()`),
    /// then reads it from the latest state.
    pub fn get_node_by_id(ids: &NodeIdState, state: &EditorState, id: &str) -> Option<NodeKey>;
}
/// (R2-48, R2.1) The commit pass replacing the mutation listener (:134-167) is the
/// `Plugin::after_commit` body (S1 §14.2); NodeId has no commands. It writes into the round's
/// shared follow-up transaction and adds no tag. See semantics.
impl lexical_model::Plugin for NodeIdPlugin {
    fn name(&self) -> &'static str { "node-id" }
    fn commands(&self) -> &[lexical_model::CommandRegistration] { &[] }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, lexical_model::Error> { Ok(Handled::No) }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), lexical_model::Error>;
}

/// The node transform body (:121-132), an `AnyTransformFn`. Reads `id_length`, the maps and the
/// RNG from `tx.extension_mut::<NodeIdState>()` (copy them into locals before tree writes, S1
/// §7.2 borrow pattern).
pub fn id_transform(tx: &mut Transaction, key: NodeKey) -> Result<()>;

/// `$updateAllNodeIds` (:257). Pre-order DFS from `root` (default: the root node, which is included),
/// `assert_id(.., 8)`. Then id_to_key[id] = key and key_to_id[key] = id. **No duplicate check**: on a
/// duplicate, id_to_key keeps the later DFS node.
pub fn update_all_node_ids(tx: &mut Transaction, m: &mut NodeIdMappings,
                           root: Option<NodeKey>, ids: &mut NanoIdRng) -> Result<()>;

/// Clipboard fresh ids (:192-201). Call on the nodes about to be inserted, before insertion, with
/// CRITICAL priority. Equivalent to `invalidate_id` on each node. It never consumes the
/// insert: the JS command returns `false` so @lexical/table's grid paste or `selection.insertNodes`
/// (upstream `packages/lexical-clipboard/src/clipboard.ts:401`) still run. The transforms then assign
/// fresh ids on the next pass.
pub fn prepare_clipboard_nodes(tx: &mut Transaction, nodes: &[NodeKey]) -> Result<()>;
```

Semantics:

1. **Transform** (`:121-132`). It runs for every dirty node of every registered class.
   `id = assert_id(node, len)`. If `id_to_key[id]` exists and `!= node`, then `id = regen_id(node, len)`.
   This is the duplicate rule: **the node being transformed loses**, and the already-mapped node keeps its
   id. Then write both maps. Pasted nodes, `$copyNode` clones and imported duplicates are all resolved this
   way, in transform order, which is the CR-20 order (dirty leaves in insertion order, then intentionally
   dirty elements, to a fixpoint). Which duplicate keeps its id depends on that order; §6.3 has a fixture
   with two duplicates pasted in one update.
2. **Commit pass** (replaces `registerMutationListener(..., {skipInitialization:false})`, `:134-182`).
   For each `Destroyed` key in `commit`, read its id from the **previous** state. If the id is non-empty,
   remove `id_to_key[id]` and `key_to_id[key]`. The test `packages/lexical-core/tests/node-id-plugin.test.ts:16`
   requires that every node destroyed in one update is unmapped. Then, for the `Created` keys (JS:
   `editor.update` with **no tag**, so it is collab-synced; Rust: the round's follow-up transaction
   `tx` that S1 §14.2 opens and shares with every plugin), for each created key still attached:
   `assert_id(len)` and write both maps, **without** the duplicate check. The next round finds
   nothing to write, so its follow-up is a no-op and the rounds end.
   `skipInitialization:false` means the first registration also visits every existing node as Created.
   Rust: `build()` with `initial_state` runs `after_commit` with a synthetic all-Created commit.
3. **INITIALIZE_DOCUMENT_IDS** (`:37`, `:203-212`, NORMAL priority; note the trailing space in the command
   name). It is `update_all_node_ids(mappings)` in a new transaction. It has no command bus: callers
   (`apps/web/src/lib/core/component/LexicalMarkdown/utils.ts:180,217,246`) call the function directly.
4. (R2, R2-1 R2-09) `$applyIdFromSerialized`/`$applyPeerIdFromSerialized` (`:72`; called from 37 node
   `importJSON`/`updateFromJSON` overrides) **are ported**, as `ImportedState::IdOnly`/`IdAndPeer`
   (§4.1a rule 5). Nodes on the `updateFromJSON` path use `Full`. There is no separate function.
   Three nodes keep `$.id` only through this path (`DiffNode.ts:74-77`, `SearchMatchNode.ts:35-41`,
   `DiffDeleteNode.ts:35-38`); dropping it drops their stored ids. Fixture
   `ids::apply_id_from_serialized_keeps_diff_and_search_match_ids`.
5. **CODE_HIGHLIGHT_IDS_TAG** (`apps/web/src/lib/core/component/LexicalMarkdown/collaboration/CollabProvider.tsx:109`).
   On the web, Prism re-tokenizes code into new `code-highlight` nodes. `codeNodeUpdateHandler`
   (`:380-404`) then runs `$updateAllNodeIds(mappings, codeNode)` per affected code block, tagged
   `code-highlight-ids-tag`, and that tag is skipped by `syncLexicalToLoro` (`:432-437`). With
   highlighting view-only, Rust never creates or merges `code-highlight` nodes. What remains:
   (a) `update_all_node_ids(.., Some(code_block))` stays public so the JS view can call it after
   re-tokenizing. (b) The tag stays a JS update tag (string constant; Rust does not interpret it).
   (c) Rust transforms must assign ids to deserialized `code-highlight` nodes **only when missing**.
   They must never rename or merge them, so stored docs round-trip byte-identically.

What `lexical_model` must offer:
- CR-14 `EditorBuilder::transform_each(f, TransformScope::Types(types))` (S1 §4.2): one transform on
  the listed type names (and their direct replacements), run with the same dirty-leaf/intentionally-dirty-element rules as
  typed transforms. It is **not** an all-classes transform: `RootNode` is not in `SupportedNodeTypes`, so the
  root gets an id only from `update_all_node_ids`, and an edit that dirties the root never writes
  `root.$.id` (test in §6.3).
- `Commit::changes.mutations` (`Mutation::{Created, Updated, Destroyed}`, S1 §11.1) with a
  previous-state read (`commit.prev`).
- `StateKey<V>` with `parse(&serde_json::Value) -> V`, default, and omission-on-default serialization.
  Unknown `$` keys must be kept verbatim.

#### 4.3.2 Peer ownership (`peer/`)

| StateKey | JSON | Type | Parse (`plugins/peerIdPlugin.ts`) |
| --- | --- | --- | --- |
| `PEER_ID` | `$.peerId` | `Option<String>` | string, else null (`:33`) |
| `SHARED_PEER_IDS` | `$.sharedPeerIds` | `Option<Vec<String>>` | array of all-strings, else null (`:40`); `[]` serializes (≠ null) |
| `LOCAL` | `$.local` | `Option<bool>` | boolean, else null (`:108`) |

```rust
pub static PEER_ID: StateKey<Option<String>> = StateKey::new("peerId");
pub static SHARED_PEER_IDS: StateKey<Option<Vec<String>>> = StateKey::new("sharedPeerIds");
pub static LOCAL: StateKey<Option<bool>> = StateKey::new("local");
/// Update tag: the update only changes LOCAL. Collab providers skip it, so it MUST NOT change content.
pub const LOCAL_STATUS_TAG: &str = "local-status";

pub fn get_peer_id(s: &EditorState, k: NodeKey) -> Option<&str>;
pub fn set_peer_id(tx: &mut Transaction, k: NodeKey, peer: String) -> Result<()>;
/// Does not write when the value is equal (:58).
pub fn assert_peer_id(tx: &mut Transaction, k: NodeKey, peer: &str) -> Result<()>;
pub fn get_shared_peers(s: &EditorState, k: NodeKey) -> Option<&[String]>;
/// No-op (JS: console.warn) when PEER_ID is None, and when peer == owner. Otherwise it appends with
/// insertion-ordered dedup (`new Set(prev).add`, :68-87).
pub fn add_shared_peer(tx: &mut Transaction, k: NodeKey, peer: &str) -> Result<()>;
pub fn has_shared_peer(s: &EditorState, k: NodeKey, peer: &str) -> bool;
pub fn get_local(s: &EditorState, k: NodeKey) -> Option<bool>;
pub fn set_local(tx: &mut Transaction, k: NodeKey, local: bool) -> Result<()>;
/// Returns true only when ownership was removed entirely (:229-272).
pub fn remove_peer_id(tx: &mut Transaction, k: NodeKey, peer: &str) -> Result<bool>;

pub enum PeerIdTarget<'a> { Node(&'a EditorState, NodeKey), Serialized(&'a serde_json::Value) }
/// `createPeerIdValidator` (:278). Disabled -> always true. node_peer None & current Some -> false.
/// Both Some -> equal. Otherwise true. For Serialized it reads `value["$"]["peerId"]`.
pub fn peer_id_valid(target: PeerIdTarget<'_>, current: Option<&str>) -> bool;

/// The current peer id, an `ExtensionState` (S1 §14.3): transforms are `fn` items, so the JS
/// `getPeerId()` closure becomes a value the host updates (`tx.extension_mut::<PeerIdState>()`)
/// when the session's peer changes.
#[derive(Clone, Debug, Default)]
pub struct PeerIdState { pub peer_id: Option<String> }
pub struct PeerIdPlugin;
impl PeerIdPlugin {
    /// Registers `PeerIdState` and `peer_transform` with
    /// `transform_each(peer_transform, TransformScope::Types(classes))` for the classes the caller
    /// lists. The web lists InlineSearchNode, CommentNode, AwaitNode
    /// (`apps/web/src/lib/core/component/LexicalMarkdown/editing/registerMarkdownEditing.ts:237`).
    /// Also registers `PeerIdPlugin` with `EditorBuilder::plugin`.
    pub fn register(b: lexical_model::EditorBuilder, classes: &'static [&'static str],
                    initial: PeerIdState) -> lexical_model::EditorBuilder;
}
/// (R2.1, S11 §5.5) The session sets the current peer (after open and after a Loro reset)
/// through this extension command; the handler writes `PeerIdState::peer_id`.
pub static SET_LOCAL_PEER: CommandKey<SetLocalPeer> = CommandKey::new("peer.set_local_peer");
#[derive(Clone, Debug)]
pub struct SetLocalPeer { pub peer_id: Option<String> }
/// (R2-48, R2.1) Replaces the mutation listener (:153-179) and carries S11 §5.1's remote rule;
/// `commands()` returns the `SET_LOCAL_PEER` handler.
impl lexical_model::Plugin for PeerIdPlugin {
    fn name(&self) -> &'static str { "peer-id" }
    fn commands(&self) -> &[lexical_model::CommandRegistration];   // SET_LOCAL_PEER
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, lexical_model::Error>;
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), lexical_model::Error>;
}
pub fn update_all_ownership(tx: &mut Transaction, peer: Option<&str>, root: Option<NodeKey>) -> Result<()>;
```

- Transform (`:137-151`): if `PeerIdState::peer_id` is Some and the node's `PEER_ID` is None, set it. The `else`
  branch toggles the DOM class `local`. That is view-only and not ported.
- Commit pass (`after_commit`, writing into the round's shared follow-up, S1 §14.2): it tags the
  follow-up `LOCAL_STATUS_TAG` (tags merge with other plugins' in the same round) when it writes.
  For the Created keys of the registered classes, for each node with `PEER_ID` Some and `LOCAL`
  None: `LOCAL = (PEER_ID == PeerIdState::peer_id)`. (R2.1, S11 §5.1) Remote rule: in a commit
  tagged `from-loro`, every `Updated` node of a registered class whose `$.peerId` changed (read with
  `Read::state_change` against `commit.prev.view()`) gets `LOCAL = (PEER_ID == PeerIdState::peer_id)`
  in the same tagged follow-up.
  `registerMutationListener(nodeClass, ..)` passes no options and `DEFAULT_SKIP_INITIALIZATION = false`
  (`packages/lexical/src/LexicalEditor.ts:386, 1263-1270`), so `build()` with `initial_state` runs
  `after_commit` with a synthetic all-Created commit, as NodeIdPlugin does; loaded documents resolve
  `local` this way.
- Falsy strings (rule 8): `Some("")` is treated as `None` in the transform's `if (peerId)` (`:140`),
  `add_shared_peer`'s `!primaryPeerId` (`:70`), `update_all_ownership`'s `if (!id) return` (`:217`), the
  validator's `!nodePeerId && currentPeerId` (`:296`) and `assert_id`'s `!id`. In the validator a serialized
  `$.peerId` that is not a string is truthy and compares unequal (`(node.$ as any)?.peerId`, `:289`), so a
  numeric peerId yields `false` when `current` is set; `PeerIdTarget::Serialized` reads the raw `Value`.
- `remove_peer_id`. If owner == peer and there are no shared peers (None or empty): set PEER_ID and LOCAL
  to None and return true. If owner == peer with shared peers: the first shared peer becomes the owner,
  the rest stay shared (None when empty), LOCAL becomes false, and it returns false. If peer is only in
  shared: remove it (None when empty), LOCAL becomes false, and it returns false. Otherwise it returns false.
- **`update_all_ownership` upstream bugs** (`:212-227`, INITIALIZE_LOCAL_STATUS at CRITICAL priority):
  (1) `return` on the first node whose PEER_ID is null. The DFS starts at the root, which never has a
  PEER_ID, so the call from root is a **no-op**. (2) It writes LOCAL = true for the owner and then
  overwrites it with `has_shared_peer`. Q2 ruling: **copy** the effective behaviour (no-op from the root).
  Running it on a sub-root reproduces (1) and (2) literally. `local` serializes in `$` in local exports, so
  a fix would make every client set `local` on load; leave it until JS is fixed in step.
- `isNodePeerIdValid(editor, nodeKey, validator)` (`:308`) and `$isNodePeerIdValid` (`:322`) both reduce
  to `peer_id_valid`. `isNodePeerIdValid` serializes the node and validates the JSON form, which gives
  the same result.

#### 4.3.3 Comment-only gate (`comment_gate.rs`)

The route is `POST /comment-only-change` (lexical-service `index.ts:78`; auth `:50`). The handler is
`endpoints/comment-only-change.ts:43`. Request: `{ before: { root: {...passthrough} }, after: { root: {...} } }`
(`:9-14`). Response 200: `{ "commentOnly": bool }`. On a parse failure it throws and returns
500 `{error:true,message}`, through `lib/error-handler.ts:23`.

Algorithm (`lib/comment-only-change.ts`), applied to each of `before` and `after` independently:

1. `withoutIdentityState(root)` (`:58-76`) is a recursive copy over `children` only. It deletes the
   `$` keys in `IDENTITY_STATE_KEYS = ['id','peerId','sharedPeerIds','local']` (`:19`). It drops `$`
   when nothing is left. Other `$` keys stay and are compared (test `:270`).
2. Parse into a fresh headless editor: `SupportedNodeTypes`, no replacements, no plugins (`:37-43`). An
   unknown `type` throws (test `:277`). Only `state.root` is used. Any `selection` is ignored.
3. One discrete update (`:44-54`): snapshot the pre-order DFS list from the root
   (`[...$dfsIterator($getRoot())]`, so it is evaluated before any mutation). Then for each node:
   - if it is a `CommentNode` (`type == "comment-mark"`, `nodes/CommentNode.ts:153`, subclass of MarkNode):
     `$unwrapMarkNode`. Its children move before the mark in order, then the mark is removed
     (upstream `packages/lexical-mark/src/index.ts:22`). Plain `mark` nodes and diff nodes are **not**
     unwrapped.
   - otherwise, if it is a TextNode (any subclass, including `code-highlight`): `markDirty()`.
4. On commit, the normal dirty-leaf pass runs `$normalizeTextNode` on every dirty simple text node
   (upstream `packages/lexical/src/LexicalUpdates.ts:292-302`; `LexicalNormalization.ts:48`). A node
   qualifies when `type=="text"`, mode is normal and it is not unmergeable. Empty simple text is removed.
   Merging happens with a previous or next simple sibling when `$canSimpleTextNodesBeMerged` holds
   (`:16`): same mode, format, style, and NodeState equal or null. Identity was stripped, so state is
   null on both. A merge re-dirties the survivor, so whole runs coalesce. Node-class transforms also run.
5. `editor.getEditorState().toJSON()` (`:55`). Compare with `node:util.isDeepStrictEqual` (`:30-33`).
   Object key order does not matter, array order does, and number vs string is strict.
   There is no whitelist beyond steps 1 and 3: `ids`, `isDraft`, `threadId` and the `$` of comment
   marks disappear with the mark. Everything else must be equal.

```rust
/// Whether `after` differs from `before` only in comment marks. Err when either state does not
/// deserialize (unknown node type, bad field). Callers must refuse on Err.
pub fn is_comment_only_change(before: &lexical_model::SerializedEditorState,
                              after: &lexical_model::SerializedEditorState) -> Result<bool>;

/// For sync-service, which holds root `serde_json::Value`s (RootChange).
pub fn is_comment_only_root_change(before_root: &serde_json::Value,
                                   after_root: &serde_json::Value) -> Result<bool>;
```

Rust body: `normalize(state)` = strip identity keys over `children` → `editor.set_editor_state(editor.parse_editor_state(&json)?, tags)`
on the editor from **`EditorConfig::Export`** (`export_registry()`) (§4.0: `SupportedNodeTypes`, no node replacements, no id/peer plugins;
never an `EditorType` preset, which would turn `code` into `custom-code` and `list` into `task-list` on both
sides, hide a type change, and through CustomCodeNode's constructor erase a language change, so the gate
would fail open) → transaction: `let order = dfs(root)` collected first. For each key:
if `tx.get::<CommentNode>(k)` then `unwrap_mark_node(tx, k)` (`lexical_rich_nodes::mark`); else if it is a text node,
`tx.mark_dirty(k)` → `tx.commit()` → `commit.next.to_json()`. The result is `normalize(before) == normalize(after)`,
compared with `serde_json::Value` equality. The workspace enables serde_json `preserve_order`
(`crates/workspace-hack/Cargo.toml:142`), so `Map` is an `IndexMap`, whose `PartialEq` is
order-insensitive: object key order does not matter, as with `isDeepStrictEqual`. Integers vs floats:
`Number(1) != Number(1.0)` in serde_json, so require integer-normalised serialization in `to_json`. If
`arbitrary_precision` is enabled anywhere in the build graph, `Number` equality becomes textual (stricter
than JS, `1.0` vs `1`); the crate asserts at test time that it is off, or compares numbers as `f64`.

Normalization dependencies on `lexical_model`: (a) `mark_dirty` on text nodes must feed the dirty-leaf
normalization pass. (b) Text normalization must match upstream exactly: empty removal, merge
predicate including the NodeState rule, and re-dirty after merge until fixpoint. (c) Deserialize must
apply the same defaults and the same omission-on-default re-serialization as JS. For example
`textFormat`/`textStyle` on paragraphs, `$` omitted when empty, unknown `$` keys kept. (d)
`code-highlight` text nodes are not `isSimpleText` (type ≠ "text"), so they never merge. That is
consistent with the view-only decision. (e) Every node-intrinsic transform (ListNode, ListItemNode,
AgentSessionMentionNode, any `$config.$transform`) runs exactly as upstream, in CR-20 order. Unwrapping a
mark makes its parent element intentionally dirty, so the ListNode transform (merge a next same-type
sibling list, renumber `value`) and ListItemNode transform can run on the side that had a mark under a
list or list item, and can change the verdict; Rust must reproduce them. The dirty set is every text node
(intentionally dirty leaf) plus every element that unwrap writes to. (f) The merge predicate is CR-21's
asymmetric `$canSimpleTextNodesBeMerged(node1, node2)`: a merge is allowed when each of `node1`'s mode,
format, style and `__state` is null or equal to `node2`'s, so a left neighbour without `$` merges into a
right neighbour that has non-identity `$` keys and drops its state; each direction merges at most once per
call. Fixtures (§6.3): a comment mark inside a bullet list item with `checked:false`; a stored
`code`→`custom-code` rewrite with identical text gives `false`; a language change on `code` gives `false`;
the asymmetric `$` merge.

Caller replacement in sync-service:
- Today: `changes_only_comment_marks` (`services/sync-service/src/socket/protocol.rs:368`) →
  `DocumentState::root_change` (`state.rs:134`). It forks the doc, imports the updates and returns
  `deep_json` roots (`state.rs:323`), or `None` when updates are pending, when there is no `root`, or
  when anything outside `root` differs after the import (`(before == after).then_some(..)` after removing
  `root`, `state.rs:154`).
  It then calls `LexicalServiceClient::is_comment_only_change` (`outbound/lexical_service.rs:43`), which
  POSTs `{before:{root},after:{root}}` with `x-internal-auth-key` (`LEXICAL_SERVICE_AUTH_KEY`) to
  `LEXICAL_SERVICE_URL/comment-only-change`. The call sites are the `WriteAccess::CommentMarks`
  branch (`protocol.rs:207`) and `WriteAccess::Full` with `PeerCommentUpdate` (`protocol.rs:185,215`).
  Any `Err` or non-200 refuses the update.
- Replacement: `protocol.rs:386-399` becomes
  `match macro_document_model::comment_gate::is_comment_only_root_change(&change.before, &change.after)`
  with the same `Ok(true)/Ok(false)/Err` arms and warn/error logs. It is synchronous and in-process.
  Delete `outbound/lexical_service.rs` and the `LEXICAL_SERVICE_URL`/`LEXICAL_SERVICE_AUTH_KEY`
  bindings once nothing else uses them. Keep the `#[tracing::instrument]` span on
  `changes_only_comment_marks`, and add `comment_only` as a recorded outcome field.

#### 4.3.4 Exports

Shared input: `lexical-service/lib/sync-service.ts:20` `GET {SYNC_SERVICE_URL}/document/{docId}/raw`, with
`x-internal-auth-key: SYNC_SERVICE_AUTH_KEY` and a 5 s timeout. Errors carry `status`. `createSyncError`
(`lib/error-handler.ts:61`) maps it to 404 "Document not found" or 503 "Sync service unavailable".
Anything else is 500. `ConversionError` (500) passes its message through, and `ZodError` is 400
(`lib/error-handler.ts:23-59`). Path param `docId` must be non-empty (`lib/schemas.ts:51`). Every route
except `/html` and `/health` requires `x-internal-auth-key == INTERNAL_AUTH_KEY` (`index.ts:43-57`
applies `internalAuth` selectively; `/html` is unauthenticated today). Shadow-mode parity tests send the
key exactly as the production caller does. In Rust, the export functions take
the already-fetched `SerializedEditorState`. Callers get it in-process from sync-service's
`DocumentState::get_json` or through their existing sync-service client.

```rust
pub mod export {
    #[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] #[serde(rename_all = "camelCase")]
    pub struct SearchableNode { pub node_id: String, pub content: String, pub raw_content: String }
    #[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] #[serde(rename_all = "camelCase")]
    pub struct CognitionNode { pub node_id: String, pub r#type: String, pub content: String, pub raw_content: String }
    #[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] #[serde(tag = "type", rename_all = "camelCase")]
    pub enum NewMdNode {
        Generic { #[serde(rename = "nodeId")] node_id: String, content: String, tag: String },
        StaticImage { url: String },
        DssImage { id: String },
    }
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
    pub enum MarkdownTarget { #[default] Internal, External, Embedding }

    pub fn to_plaintext(state: &EditorState) -> String;
    pub fn extract_search_text(state: &EditorState, key: NodeKey) -> String;
    pub fn to_search_text(state: &EditorState) -> Result<Vec<SearchableNode>>;
    pub fn element_node_to_markdown(state: &EditorState, key: NodeKey, target: MarkdownTarget) -> Result<String>;
    pub fn to_cognition_text(state: &EditorState) -> Result<Vec<CognitionNode>>;
    pub fn to_cognition_v2(state: &EditorState) -> Result<Vec<NewMdNode>>;
    pub fn to_markdown_text(state: &EditorState, target: MarkdownTarget) -> Result<String>;
    pub fn markdown_to_embedding_text(markdown: &str) -> String;
    pub fn to_comment_mark_context(state: &EditorState, mark_id: &str) -> Option<crate::nodes::comment::CommentMarkContext>;
}
```

Semantics (from `lexical-service/lib/convsersions.ts`):

- `to_plaintext` (`:19`): `root.children.map(getTextContent).join("\n")`.
- `extract_search_text` (`lib/search-text.ts:13`): if the node implements `SearchText` and returns `Some`
  (4.1a `nodes::SearchText`), use it. Else a leaf gives `text_content`. An element concatenates its
  children recursively and appends `"\n\n"` after each child that is a **non-inline element** and is not
  the last child.
- `to_search_text` (`:46`): for each root child, skip it when `get_id` is None or `""`. Push
  `{nodeId:id, content: extract_search_text(child), rawContent: JSON.stringify(child.exportJSON())}`.
  `exportJSON` is the node's own JSON **without `children`**: Lexical `exportJSON` emits
  `children: []` for elements. Rust: `state.export_json(child)?` (S1 §5.2 `Read::export_json`,
  R2.1: `node.exportJSON()` with `children: []`, the key in its first position), written with `to_js_json_string`, with
  JS key order (the field order of `exportJSON`). Because it is the rawContent string, its byte form
  matters to the search index.
- `element_node_to_markdown` (`lib/markdown.ts:58`): export the single block as if it were the only
  child of a root (JS: deep-copy it under a detached `ParagraphNode` and call
  `$convertToMarkdownString(T, pseudoRoot)`). Use `EXTERNAL_TRANSFORMERS` for External. For Internal use
  `INTERNAL_TRANSFORMERS` and then replace the regex `/\n\n\n \n\n\n/gm` with `"\n\n \n\n"`.
  `lexical_markdown` must expose `convert_to_markdown_string(state, transformers, Some(parent),
  opts)` over an arbitrary child list without mutating, so no clone is needed.
- `to_cognition_text` (`:73`): for each root child that is an element with an id: `{nodeId, content:
  element_node_to_markdown(Internal), rawContent: shallow exportJSON string, type: child.type}`.
  Non-element root children (decorators) are skipped.
- `to_cognition_v2` (`:115`): for each root child, in order:
  - ImageNode → push `image_md(child)` and `continue`;
  - non-element → skip;
  - no id → skip;
  - otherwise push `Generic{nodeId, content: element_node_to_markdown(Internal), tag: child.type}`. Then
    run a pre-order DFS of that child (including itself) and push `image_md(n)` for every ImageNode.
  - `image_md`: `srcType == "dss"` → `DssImage{id}`, else `StaticImage{url}` (`:107-113`).
- `to_markdown_text` (`:160`): `convert_to_markdown_string(root)` with External → `EXTERNAL_TRANSFORMERS`,
  Internal/Embedding → `INTERNAL_TRANSFORMERS`. Embedding then applies `markdown_to_embedding_text`.
  `MarkdownOptions{ list_indent: 2 }`. `shouldPreserveNewLines` is false (upstream default).
- `markdown_to_embedding_text` lives in `packages/lexical-core/utils/parsers.ts:474`. Pass order:
  1. `stripAgentContext` (`:274`): a leading `^<m-agent-context>(.*?)</m-agent-context>(\r?\n\r?\n)?`
     (dotAll) is removed only when its JSON passes `isAgentContextData` and has exactly 2 keys.
  2. `<m-snapshot>(.*?)</m-snapshot>` → `snapshotToEmbeddingText` (`:403`): raw JSON if it starts with
     `{`, else base64 decoded as UTF-8. Then `documentRefToEmbeddingText`. Any failure gives "".
  3. `flattenTables` (`:421`): each `<m-table ...>` → rows joined `"\n"`, cells joined `" | "`. A cell's
     text has literal `\n` replaced with a space and `<br>` with a space, then is trimmed.
  4. `flattenEmailThreadEmbeds` (`:446`): strip the leading `^\{.*?\}`, and turn literal `\n` into newlines.
  5. `replaceJsonTag` (`:379`, regex `<tag>(.*?)</tag>` with the `gs` flags; JSON failure gives "") is
     applied in this order: agent-session-mention, document-mention, document-card, pr-mention, link,
     image, video, katex-equation, user-mention, contact-mention, date-mention, group-mention, tag,
     theme-mention, connect-app, account-manager-request, db-query, await, reply-target, watermark.
     Renderers are at `:485-555`. `documentRefToEmbeddingText` is at `:393`, `userMentionDisplayText` at
     `:36`, `githubPullRequestRef` at `:136`.
  6. Drop every remaining `<(m-[a-zA-Z0-9_-]+)>(.*?)</\1>` except `m-agent-context` (`:560-563`).
  All regexes run with `regress` (dotAll, global). The backreference in step 6 is required. Replacement
  is a closure over the matches. Rust `String` slicing must follow match boundaries, never UTF-16 offsets.
- `to_comment_mark_context` (`:37`) is 4.1a `nodes::comment::get_comment_mark_context(state, mark_id,
  CommentMarkLimits{ marked: 1000, surrounding: 2000 })`. Lengths and windows are in **UTF-16 code
  units**, `trim` uses JS whitespace, and the ellipsis is U+2026.

Route map (only these routes):

| Route | Handler | Rust replacement | Rust callers today (`lexical_client` method → caller) |
| --- | --- | --- | --- |
| `GET /plaintext/:docId` → `{data:string}` | `endpoints/plaintext.ts:37` (route `index.ts:71`) | `export::to_plaintext` | none (no `lexical_client` method; no caller in `crates/`, `services/`, `apps/`) |
| `GET /search/:docId` → `{data:SearchableNode[]}` | `endpoints/search-text.ts:41` (`index.ts:75`) | `export::to_search_text` | `LexicalClient::parse_markdown` (`crates/lexical_client/src/parse_markdown.rs:485`) ← `services/search_processing_service/src/process/document/raw_document.rs:610` |
| `GET /cognition/:docId` → `{data:CognitionNode[]}` | `endpoints/cognition-text.ts:41` (`index.ts:73`) | `export::to_cognition_text` | `parse_markdown_for_ai` (`parse_markdown.rs:533`) — no callers |
| `GET /cognition/presigned?url=` → `{data:CognitionNode[]}` | `endpoints/cognition-presigned.ts:35` (`index.ts:72`) | `export::cognition_from_presigned_body(body: &str) -> Result<Vec<CognitionNode>>` (fetch stays with the caller) | `parse_markdown_for_ai_from_url` (`parse_markdown.rs:539`) — no callers |
| `GET /cognitionv2/:docId` → `{data:NewMdNode[]}` | `endpoints/cognition-v2.ts:52` (`index.ts:74`; schema `:14-29`) | `export::to_cognition_v2` | `parse_cognition_v2` (`parse_markdown.rs:556`) ← `crates/documents/src/inbound/toolset/read_content.rs:258`, `crates/documents/src/inbound/attachment/markdown.rs:28` |
| `GET /markdown/:docId?target=internal\|external\|embedding` (default internal) → `{data:string}` | `endpoints/markdown.ts:43` (`index.ts:76`; query `:21-26`) | `export::to_markdown_text` | `get_markdown` (`parse_markdown.rs:495`) ← `crates/collab_surface/src/outbound/surface_init.rs:160` (External), `crates/documents/src/outbound/markdown_text.rs:7` (External), `crates/skills/src/outbound/document_skill_reader.rs:94` (Internal), `crates/scheduled_action/src/outbound/event_content.rs:318` (External), `crates/agent_trigger/src/outbound/dss_task_assignment_context.rs:96` (External), `crates/task_dedup/src/bin/pull_task_corpus.rs:469,494` (Embedding); `get_embedding_markdown` (`:511`) ← `crates/documents/src/inbound/axum_router/task_duplicates.rs:213`, `crates/task_dedup/src/bin/backfill_task_embeddings.rs:410` |
| `GET /comment-mark/:docId/:markId` → `{data:{markedText,surroundingText}\|null}` | `endpoints/comment-mark.ts:42` (`index.ts:77`) | `export::to_comment_mark_context` | `resolve_comment_mark` (`parse_markdown.rs:522`) ← `crates/documents/src/outbound/lexical_comment_marks.rs:31`, `crates/channel_bots/src/outbound/lexical_comment_marks.rs:29`, `crates/agent_trigger/src/outbound/discussion_context.rs:84` |
| `GET /xml/:docId` → `{data:string}` | `endpoints/xml.ts:37` (`index.ts:79`) | `xml::to_xml` | none in Rust (TS: `services/ai-editing-worker/src/ai-editing/utils.ts:13` calls `toXml` locally) |
| `POST /comment-only-change` | `endpoints/comment-only-change.ts:43` (`index.ts:78`) | `comment_gate::is_comment_only_root_change` | sync-service `outbound/lexical_service.rs:43` ← `socket/protocol.rs:388` |
| `POST /snapshot/markdown` `{markdown}` → octet-stream | `endpoints/markdown-snapshot.ts:39` (`index.ts:80`) | `snapshot::markdown_to_loro_snapshot` | `markdown_to_loro_snapshot` (`parse_markdown.rs:562`) ← `crates/documents/src/outbound/markdown_init.rs:29,139`, `crates/collab_surface/src/outbound/surface_init.rs:61` |
| `POST /snapshot/notion` `{markdown, links:{pages:{id:{documentId,name}}, users:{id:{userId,email}}}}` → `{snapshot: base64, markdown}` | `endpoints/notion-snapshot.ts:54` (`index.ts:81`; body `:8-20`) | `snapshot::notion_markdown_to_loro_snapshot` | `notion_to_loro_snapshot` (`crates/lexical_client/src/notion.rs:76`) ← `crates/documents/src/outbound/markdown_init.rs:63,156` |

`cognition/presigned` (`endpoints/cognition-presigned.ts:35-76`): GET the URL with a 5 s timeout. A non-OK
response is a `ConversionError`. If the body parses as JSON with `root.children` truthy, return
`to_cognition_text`. Any failure in parsing or conversion falls through to the next step. The fallback is
`[{nodeId:"plain-text", content: body, rawContent: body, type:"markdown"}]`.

#### 4.3.5 XML codec (`xml/`)

`toXml(state)` = `builder.build([{ doc: state.root.children.map(serializeNode) }])`
(`transformers/xml/index.ts:23-26`). `buildXml(nodes)` = `builder.build(nodes)` (`:19`), used by the
composer (`utils/agent-context.ts:1615,1623`, callers trim the start). Builder options (`:8-16`):
`ignoreAttributes:false, attributeNamePrefix:'', preserveOrder:true, textNodeName:'#text',
suppressEmptyNode:true, format:true, indentBy:'  '`. The remaining options are fast-xml-parser 4.5.7
defaults (`node_modules/fast-xml-parser/src/xmlbuilder/json2xml.js:6-38`): `processEntities:true`,
`suppressBooleanAttributes:true` (never triggers; all values are strings), and no unpaired tags or stop nodes.

```rust
#[derive(Clone, Debug, PartialEq)]
pub enum XmlNode {
    Element { tag: String, attrs: Vec<(String, String)>, children: Vec<XmlNode> }, // ordered attrs
    Text(String),
}
/// `el(tag, kids, attrs)` (codecs.ts:40). An empty attrs list means no `:@`.
pub fn el(tag: impl Into<String>, children: Vec<XmlNode>, attrs: Vec<(String, String)>) -> XmlNode;
pub fn text(s: impl Into<String>) -> XmlNode;
pub fn build_xml(nodes: &[XmlNode]) -> String;
pub fn to_xml(state: &serde_json::Value) -> Result<String>; // raw JSON, never parsed by Lexical
pub fn serialize_node(node: &serde_json::Value) -> XmlNode;
```

Builder algorithm (`orderedJs2Xml.js:9-104`). Port it as a hand-written writer. quick-xml's
indenting writer differs on empty and mixed content, so use quick-xml only for
`escape::escape`-equivalent output, or not at all.
- `build(nodes)` = `arr_to_str(nodes, indent = "\n")`. Output therefore **starts with `"\n"`**.
- `arr_to_str(list, ind)`: `prev_tag = false`. For each item:
  - Text(t): `t' = escape(t)`; if `prev_tag` append `ind`; append `t'`; `prev_tag = false`.
  - Element: `start = ind + "<" + tag + attrs`, where attrs is `" name=\"" + escape(v) + "\""` per
    attribute in insertion order (an empty value still prints `name=""`). `inner = arr_to_str(children,
    ind + "  ")`. If inner is empty, `start + "/>"`. Else if inner ends with `>`,
    `start + ">" + inner + ind + "</tag>"`. Else `start + ">"`, followed by
    `ind + "  " + inner + ind` when inner contains `"/>"` or `"</"`, else `inner`, followed by
    `"</tag>"`. Set `prev_tag = true`.
- `escape` for both text and attributes, in this order: `&`→`&amp;`, `>`→`&gt;`, `<`→`&lt;`,
  `'`→`&apos;`, `"`→`&quot;`. The empty string is untouched.
- Example (verified): `<p id="p1">` holding bold+italic text `a<b & "c"`, a linebreak and an empty text gives
  `"\n<doc>\n  <p id=\"p1\">\n    <t id=\"t1\" bold=\"true\" italic=\"true\">a&lt;b &amp; &quot;c&quot;</t>\n    <br/>\n    <t/>\n  </p>\n  <p/>\n...</doc>"`.

`nodeAttrs(n, extra)` (`codecs.ts:48`) puts `id` (from `$.id`, when truthy) first, then `extra` in the
order listed. `container(tag,n,extra)` = `el(tag, children.map(serialize), nodeAttrs)`. Attribute values
marked "if truthy" follow the JS `&&` spread: they are omitted for `""`, `0`, `false`, null and undefined.

| `type` | Element | Attributes after `id` (in order) | Children |
| --- | --- | --- | --- |
| `text` | `t` | `bold italic strikethrough underline code subscript superscript` = `"true"` for bits 0..6 of `format` (higher bits dropped); `style` if truthy; `detail` if non-zero; `mode` if truthy and ≠ `normal` | `Text(text)` if non-empty |
| `linebreak` | `br` | none (**no id**) | – |
| `paragraph` | `p` | – | children |
| `heading` | value of `tag` (`h1`..`h6`) | – | children |
| `quote` | `blockquote` | – | children |
| `listitem` | `li` | `value` if ≠ 1; `checked="true"` if truthy | children |
| `list`, `task-list` | `ol` if `listType=="number"` else `ul` | `listType="check"` if check; `start` if ≠ 1 | children |
| `table` | `table` | `colWidths` = `join(",")` if present; `rowStriping="true"` if truthy | rows (see below) |
| `tablerow` (outside a table) | `tr` | `height` if defined | children |
| `tablecell` (outside a row) | `td` | `headerState` if ≠ 0; `colSpan` if ≠ 1; `rowSpan` if ≠ 1; `backgroundColor` if truthy | children |
| `horizontalrule` | `hr` | – | – |
| `date-mention` | `date-mention` | `date`, `displayFormat`, `mentionUuid` if defined | – |
| `link`, `autolink` | `a` | `href` = `url ?? ""`; `rel`, `target`, `title` if truthy | children |
| `mark` | `mark` | – (ids dropped) | children |
| `tab` | `tab` | – | – |
| `classed-block` | `classed-block` | `tag`; `classes` = `join(" ")` if non-empty | children |
| `custom-code` | `code` | `language` if truthy | `Text(concat)`, where `linebreak` → `"\n"`, others → their `text ?? ""`; omitted if empty |
| `equation` | `equation` | `inline="true"` if truthy | `Text(equation)` if non-empty |
| `image` | `image` | `alt` if truthy; `src` = `redactedSrc(url)` if truthy | – |
| `video` | `video` | `src` = `redactedSrc(url)` if truthy; `controls="true"` if truthy | – |
| `html-render` | `html-render` | – | `Text(html)` if non-empty |
| `document-card`, `document-mention` | same name | `documentId`, `name`(=documentName), `blockName` if truthy; `blockParams` = `JSON.stringify` if it has keys | – |
| `database-query` | `database-query` | `queryId`; `databaseId`, `tableId` if truthy; `displayMode`; `title` if truthy; `prompt`; `chart` = `JSON.stringify` if truthy; `height` if defined | – |
| `user-mention` | `user-mention` | `userId`, `email`, `name`(=displayName) if truthy | – |
| `contact-mention` | `contact-mention` | `contactId`, `name`, `email`(=emailOrDomain) if truthy; `isCompany="true"` if truthy | – |
| `group-mention` | `group-mention` | `alias`(=groupAlias) if truthy | – |
| `agent-session-mention` | same | `sessionId`(=id, always); `label` if truthy; `expanded="true"` if truthy | – |
| `pr-mention` | `pr-mention` | `prId`(=id), `label`, `url` if truthy | – |
| `booking-link-mention` | same | `profileId`, `url`; `slug`, `label` if truthy | – |
| `theme-mention`, `unknown-mention` | same | `name` if truthy | – |
| `tag-mention` | `tag-mention` | `optionId`, `propertyDefinitionId`, `scope`, `name`; `color` if truthy | – |

- Table (`codecs.ts:162-209`): the row counter `r` and cell counter `c` count only `tablerow`/`tablecell`
  children. Non-row and non-cell children serialize normally and do not advance the counters. A cell
  gets attrs `id, row, column, headerState?, colSpan?, rowSpan?, backgroundColor?`. A row gets `id, height?`.
- `redactedSrc` (`:153`): when the URL starts with `data:`, keep up to and including the first `,` (or just
  `data:` if there is no comma) and append `...`.
- JS `String(number)`: integral f64 prints without `.0`. Port with a JS-compatible number-to-string
  helper (ryu-js style) for `detail`, `value`, `start`, `height` and similar.
- Unknown types (`serUnknown`, `:108-126`; anything not in `KNOWN_TYPES` `:63-99`, including
  `comment-mark`, `code-highlight`, every other custom node): the element name is `type`. Attributes: `id`
  from `$.id` when truthy, then `flat.flatten(rest, {safe:true})` of the node minus `type` and `children`,
  in key insertion order (flat 6.0.1). Plain objects recurse with `.`-joined keys, and an empty object
  stays a leaf. Arrays are leaves (safe). Skip keys that start with `$` and the keys `version`, `direction`
  and `indent` (the check runs on the flattened key, so `format` and nested `a.version` are kept). null
  becomes `"null"`. The key `id` becomes `_id`. Object and array leaves are `JSON.stringify`'d, and the rest
  are `String(v)` (`false` → `"false"`, `""` → `""`). Children are `children ?? []` mapped. Rust needs a
  `serde_json` built with `preserve_order` so insertion order is kept. Verified example:
  `<comment-mark id="m" ids="[&quot;a&quot;,&quot;b&quot;]" isDraft="false" threadId="null" format="" nested.a.b="1" nested.e="{}" _id="inner">`.

#### 4.3.6 Loro snapshots (`lexical_loro`, `snapshot.rs`)

Mirror shape (`packages/lexical-core/markdown-loro-schema.ts:3-32`, applied by the vendored
`packages/loro-mirror/src/core/mirror.ts`). The doc root is `LoroMap "root"` = a node map. In a node map:

| Key | Container | Rule |
| --- | --- | --- |
| `$` | `LoroMap` | empty definition. Fresh map (`initializeContainer`, `mirror.ts:757-772`): every entry is a **plain value** (`sharedPeerIds` a plain JSON array). Existing map diffed (`diffMap`): a non-schema key that is new or changed and holds an object/array becomes a **container** by inference (below) |
| `text` | `LoroText` | fresh map: only when the value is a string (`isValueOfContainerType`, `utils.ts:318`), otherwise plain. Existing map, key **new**: `insert-container` whatever the value type (`diff.ts:776-784`), so a non-string such as `null` becomes an empty LoroText and reads back `""` (copied) |
| `ids` | `LoroList<String>` | only when the value is an array/object; items plain strings; list id-selector = the string itself |
| `children` | `LoroMovableList<node map>` | only when the value is an array/object; each item is a node map, keyed by `item.$.id` (missing id: see the diff rules) |
| anything else | fresh map: plain value; existing map: inferred | `type`, `version`, `format`, `indent`, `direction`, `textFormat`, `textStyle`, `detail`, `mode`, `style`, `tag`, `listType`, `url`. Nested objects/arrays are plain JSON in a fresh map; in an existing map a new or changed key holding an object becomes a `LoroMap` and an array a `LoroList` (`tryInferContainerType`, `utils.ts:297-307`; `insertChildToMap`, `diff.ts:832-834`, `utils.ts:202-231`) |

Both paths are normative and copy loro-mirror exactly, because container kinds and ids decide
concurrent-merge behaviour even when deep JSON is equal (A-7). Scope: in M1 `set_state` is used only for
golden-seeded snapshots, where only the root map is diffed and every node is inserted fresh, so only the
fresh-map rules are exercised. A later reuse for live edits (S5/S7) must cite this section; it then hits
the inference rules and the move rule below.

`get_deep_value().to_json()` of such a doc is exactly the `SerializedEditorState` JSON (sync-service
relies on this: `state.rs:82`, `:323`).

```rust
pub mod golden {
    /// `static_assets/markdown-golden.1.bin` (784 bytes), shared with crates/documents
    /// (`crates/documents/src/outbound/markdown_init.rs:5`) and collab_surface.
    pub static MARKDOWN_GOLDEN: &[u8] = include_bytes!("../../../../../static_assets/markdown-golden.1.bin");
}
pub mod mirror {
    /// Reconcile `doc`'s "root" map to `root` using loro-mirror's diff, then `doc.commit()` with
    /// origin "to-loro".
    pub fn set_state(doc: &loro::LoroDoc, root: &serde_json::Value) -> crate::Result<()>;
}
pub mod snapshot {
    /// `rawMarkdownStateToLoroSnapshot` (markdown-loro-snapshot.ts:17): new LoroDoc,
    /// `set_record_timestamp(true)`, import `base` if Some, `set_state`, export `ExportMode::Snapshot`.
    pub fn raw_state_to_loro_snapshot(state: &serde_json::Value, base: Option<&[u8]>) -> crate::Result<Vec<u8>>;
    /// `serializedEditorStateToLoroSnapshot` (:54) = raw_state_to_loro_snapshot(state, Some(MARKDOWN_GOLDEN)).
    pub fn serialized_editor_state_to_loro_snapshot(state: &lexical_model::SerializedEditorState) -> crate::Result<Vec<u8>>;
}
// macro_document_model::snapshot
/// `markdownToSerializedEditorStateWithIds` (packages/lexical-core/utils/markdown-state.ts:26):
/// headless editor with SupportedNodeTypes + NodeReplacements; discrete update
/// `convert_from_markdown_string(md, ALL_TRANSFORMERS, root, preserve_new_lines=false)`; second
/// discrete update `update_all_node_ids` (len 8, root included); `to_json()`.
/// Markdown options: `&MACRO_MARKDOWN` (§4.4: list_indent 2, because root `package.json`
/// `patchedDependencies` applies the list-indent patch to lexical-service too, `package.json:39`;
/// should_preserve_new_lines false; should_merge_adjacent_lines false).
/// `to_json` omits every field JS exports as `undefined` (e.g. ListItemNode `checked` under a
/// non-check list) and never writes `null` in its place: the mirror skips/deletes `undefined` keys
/// (`diff.ts:760-767`) but stores `null`, so a stray `null` would add a key the web never has.
pub fn markdown_to_serialized_editor_state_with_ids(markdown: &str) -> Result<SerializedEditorState>;
/// "" -> MARKDOWN_GOLDEN verbatim (markdown-loro-snapshot.ts:65). Else golden-seeded snapshot.
pub fn markdown_to_loro_snapshot(markdown: &str) -> Result<Vec<u8>>;
pub struct NotionSnapshot { pub snapshot: Vec<u8>, pub markdown: String }
/// `notionMarkdownToLoroSnapshot` (packages/lexical-core/notion-markdown.ts:65). `markdown.trim()==""`
/// -> (MARKDOWN_GOLDEN, ""). Else state = notion_markdown_to_serialized_editor_state; snapshot
/// golden-seeded; markdown = convert_to_markdown_string(state, ALL_TRANSFORMERS)
/// (`serializedEditorStateToMarkdown`, utils/markdown-state.ts:56).
pub fn notion_markdown_to_loro_snapshot(markdown: &str, links: &notion::NotionLinks) -> Result<NotionSnapshot>;
```

Golden base contents (decoded): `root = {$:{id:"root"}, type:"root", version:1, format:"", indent:0,
direction:null, children:[{$:{id:"Ts1gplV5"}, type:"paragraph", version:1, format:"", indent:0,
direction:null, textFormat:0, textStyle:"", children:[]}]}`. The frontier is one peer at counter 19. It
was produced by `packages/lexical-core/scripts/generate-golden.ts:13-27` with no base. That script
writes `static_assets/markdown-golden.1.bin` and the TS literal `markdown-golden.1.ts`. Today's id
generator gives the root a random id, while the golden's root id is the literal `"root"`. Do not
regenerate it: every existing document descends from these bytes. Seeding from it gives all documents
one common ancestor (`root` map, `root.$`, `root.children` container ids), so concurrent first edits
converge.

`set_state` diff (port of `packages/loro-mirror/src/core/diff.ts`), from the current deep value to the new one:
- Map (`diffMap`, `:711`): delete keys that are gone. For each new or changed key: if both old and new
  are the same container kind, recurse into the existing container. If the kind changed, or the key is
  new, insert a new container (container-shaped keys per the table) or a plain value.
- Text (`diffText`, `:279`): if unequal, `LoroText::update(new)` (Loro's internal diff, `mirror.ts:528,581`).
- MovableList keyed by `$.id` (`diffMovableList`, `:309`): (1) delete the old indices whose id is
  absent from new, in descending order. (2) For the common items, compute the LIS of old indices
  (`longestIncreasingSubsequence`, `:43`). Move every common item that is not in the LIS and whose
  old index ≠ new index to its new index. **Deliberate fix:** upstream emits `move(fromIndex =
  info.oldIndex, ..)` with pre-deletion indices and applies it after the deletions
  (`diff.ts:356-391`, `mirror.ts:514-517`), so with a deletion before a moved item JS moves the wrong
  item. Rust computes `from` against the post-deletion list. JS produces a wrong mirror state here, and
  golden-seeded snapshots never move, so the fix has no stored-data surface today. Test: delete `[0]`,
  swap `[1, 2]`.
  Items without a string `$.id` (cannot happen for current callers, which always run
  `update_all_node_ids` first): copied from JS, not an error. JS only `console.error`s
  (`markdown-loro-schema.ts:16-19`); an id-less new item is inserted (`diff.ts:394-397`) and an id-less
  old item is never deleted, because it is absent from `oldMap` (`:331-336`, `:356-364`). With duplicate
  ids `oldMap` keeps the last index and every duplicate in the new list counts as common. Rust logs one
  `warn!` with the counts. (3) Insert the new items (no id or id not in old)
  at their new index, as a fresh node map populated recursively (`initializeContainer`, `mirror.ts:745`).
  (4) For common items that are not deep-equal: recurse into the existing map.
- List `ids` (string id selector, `diffListWithIdSelector`, `:472`): delete and insert to match. The
  result only has to equal the new array.
For a golden-seeded new document this reduces to: set `root.$.id`, plain-set changed root fields,
delete `Ts1gplV5` and insert every new top-level child. Byte equality with JS snapshots is impossible
(random peer ids, timestamps). Acceptance: `LoroDoc::import(snapshot)` then `get_deep_value().to_json()`
must equal `state` (`serde_json::Value` equality), the root/`$`/children container ids must equal the
golden's, and the container kinds must follow the table.

Notion state (`notion-markdown.ts:22-53`): headless editor with SupportedNodeTypes + NodeReplacements,
errors thrown. Discrete update `convert_from_markdown_string(notion_lines(md), notion_transformers(links),
root, &MarkdownOptions { should_preserve_new_lines: true, ..MACRO_MARKDOWN })` (list indent 2). Second discrete update: `update_all_node_ids` (len 8). Then `to_json()`.

Notion module (`packages/lexical-core/notion/`):
- `NotionLinks { pages: HashMap<String, NotionPageLink{document_id, name}>, users: HashMap<String,
  NotionUserLink{user_id, email}> }` (`links.ts:6-21`). Keys are dashless lowercase Notion ids. The JSON
  form is camelCase (`documentId`, `userId`).
- `notion_ids_in(reference)` (`links.ts:32`): all `/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi`
  matches with dashes removed and lowercased, **reversed** (last first). `find_notion_page` (`:38`) and
  `find_notion_user` (`:47`) return the first id present in `links`.
- `notion_lines` (`transformers.ts:592`): split on `\n` and strip a trailing `\r`. Copy fenced blocks
  (`/^\s*(`{3,}|~{3,})/`, the close fence must start with the open marker) verbatim. Drop blank lines.
  Rewrite `^(\s*)(?:-\s+)?\\\[([ xX])\\\](.*)$` to `$1- [x|space lowercased]$3`. Keep a list line
  (`^\s*(?:[-*+]|\d+[.)])\s`) as is; otherwise `trimStart`.
- `notion_transformers(links)` (`:620`), in order: `containerTransformer` (multiline, `:528`),
  `EMPTY_BLOCK` (`:346`, keeps an empty paragraph), `DROPPED_BLOCK` (`:355`, removes
  `table_of_contents`/`custom-block`), `IMAGE_BLOCK` (`:365`, `src ?? source ?? url`; web URL gives
  `ImageNode{srcType:"url", url, alt: withoutTags(caption), id:"", width:0, height:0}`, else a paragraph
  of the caption text), then the 12 inline text-match transformers (`:220-344`: page/database refs with
  and without body → DocumentMention `{documentId, documentName: name, blockName:"md"}` or a link with
  the title fallback `withoutTags(label) || title.trim() || "Notion page"`; mention-user → UserMention or
  `@name` or removal; mention-agent → `@name`; mention-date → date mention(s) `start, " – ", end`;
  file/pdf/audio/video with and without body → link labelled caption/fileName/"Notion file"; `<unknown>`;
  `<span underline="true">`; the trailing `{toggle|color="..."}` marker removed; the leftover
  Notion-tag stripper), then `ALL_TRANSFORMERS`. `$import` (`:622-627`) converts recursively into a
  detached scratch paragraph using the same transformer list, with `preserve_new_lines=true`, and
  returns its children. `lexical_markdown` must therefore allow conversion into a detached element and
  self-referential transformer lists (Rust: `Rc<RefCell<Vec<Transformer>>>` or a `fn(&mut Ctx, &str)`
  callback).
- Containers (`:391-590`): `details | callout | columns | column | synced_block |
  synced_block_reference | ancestor-path | table`. A self-closing open (`attrs.endsWith("/")`) is not a
  match. `containerContent` (`:418`) tracks the nesting depth of the same tag and ignores tags inside
  fences. When never closed, the content runs to the end. `dedent` (`:454`) strips one leading tab or 4
  spaces and drops blank lines. `details` → the summary imported with `\n`→space, then the trimmed body.
  `callout` → `$calloutNodes` (`:462`): runs of paragraphs merge into one QuoteNode joined by
  LineBreakNodes, and a non-URL `icon` + space leads the first one. `table` → `$tableNode` (`:490`):
  rows `<tr>`, cells `<t[dh]>`. The column count is the maximum. Header states: ROW for row 0 if
  `header-row="true"`, COLUMN for column 0 if `header-column="true"`. Cell text is split on `<br>`/`\n`,
  trimmed, blanks dropped, joined with `\n` and imported, defaulting to an empty paragraph. The rest
  (`columns`, `column`, `synced_block*`) gives the imported content, and `ancestor-path` gives nothing.
  Text after the close tag on the same line is imported too. The transformer returns `[true, end]`.
- `attributes(raw)` (`:61`): `([\w-]+)="([^"]*)"`, unescaping `&quot; &lt; &gt; &amp;` in that order.
  `isWebUrl` checks for an `http://` or `https://` prefix. `withoutTags` strips `<[^>]+>` and trims.
  `fileName` is the last URL path segment, `decodeURIComponent`'d.
- Dates (`:123-180`): `notionInstant(date, time, tz)`. `date` must match `^\d{4}-\d{2}-\d{2}$` or there is
  no mention. Without a valid `HH:MM` time the instant is `{date}T12:00:00.000Z`. With a time and no tz it
  is wall-clock UTC. With a tz, the wall clock is interpreted in that IANA zone by a one-step offset
  correction (`instant = wall − (zoned(wall) − wall)`); an invalid zone falls back to wall-clock UTC. Rust:
  `chrono-tz`, reproducing the one-step correction rather than a proper `from_local`. `displayFormat` =
  en-US `"{MonthName} {d}, {yyyy}"` of the UTC date at noon, plus `" {time}"` when there is a time. `date` =
  `toISOString()` (`YYYY-MM-DDTHH:MM:SS.sssZ`).

#### Mapping table

| Rust item | Ports | Source (file:line) | Notes |
| --- | --- | --- | --- |
| `ids::NODE_ID` | `idState` | `packages/lexical-core/plugins/nodeIdPlugin.ts:41` | `$.id` |
| `ids::get_id` / `set_id` | `$getId` / `$setId` | `plugins/nodeIdPlugin.ts:48`, `:55` | |
| `ids::regen_id` | `$regenId` | `plugins/nodeIdPlugin.ts:63` | |
| (not ported) | `$applyIdFromSerialized` | `plugins/nodeIdPlugin.ts:72` | covered by NodeState import |
| `ids::invalidate_id` | `$invalidateId` | `plugins/nodeIdPlugin.ts:86` | recursive |
| `ids::assert_id` | `$assertId` | `plugins/nodeIdPlugin.ts:98` | `""` counts as missing |
| `ids::NodeIdMappings` | `NodeIdMappings` | `plugins/nodeIdPlugin.ts:28` | |
| `ids::NodeIdPlugin::register`, `NodeIdState` | `nodeIdPlugin`, `registerNodeIdPlugin`, `NodeIdProps` | `plugins/nodeIdPlugin.ts:223`, `:114`, `:108` | `transform_each` |
| `ids::id_transform` | node transform | `plugins/nodeIdPlugin.ts:121-132` | duplicate → transformed node regenerates |
| `NodeIdPlugin::after_commit` | mutation listener | `plugins/nodeIdPlugin.ts:134-182` | follow-up tx, untagged |
| `ids::prepare_clipboard_nodes` | `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler | `plugins/nodeIdPlugin.ts:192-201` | CRITICAL, non-consuming |
| `ids::update_all_node_ids` | `$updateAllNodeIds`, `INITIALIZE_DOCUMENT_IDS` | `plugins/nodeIdPlugin.ts:257`, `:37`, `:203` | len 8, no duplicate check |
| `NodeIdPlugin::get_node_by_id` | `$getNodeById` | `plugins/nodeIdPlugin.ts:233` | |
| `ids::NanoId` | `nanoid(n)` | `nanoid@5.1.16` | url-safe alphabet |
| `peer::PEER_ID` / `SHARED_PEER_IDS` / `LOCAL` | `peerIdState` / `sharedPeersState` / `localState` | `plugins/peerIdPlugin.ts:33`, `:40`, `:108` | |
| `peer::LOCAL_STATUS_TAG` | `LOCAL_STATUS_TAG` | `plugins/peerIdPlugin.ts:28` | |
| `peer::get_peer_id` / `set_peer_id` / `assert_peer_id` | same | `plugins/peerIdPlugin.ts:50`, `:54`, `:58` | |
| `peer::get_shared_peers` / `add_shared_peer` / `has_shared_peer` | same | `plugins/peerIdPlugin.ts:64`, `:68`, `:89` | |
| (not ported) | `$applyPeerIdFromSerialized` | `plugins/peerIdPlugin.ts:94` | NodeState import |
| `peer::get_local` / `set_local` | `$getLocal` / `$setLocal` | `plugins/peerIdPlugin.ts:112`, `:116` | |
| `peer::PeerIdPlugin` | `peerIdPlugin`, `registerPeerIdPlugin`, `PeerIdProps` | `plugins/peerIdPlugin.ts:208`, `:132`, `:127` | |
| `PeerIdPlugin::after_commit` | mutation listener | `plugins/peerIdPlugin.ts:153-179` | tagged `local-status` |
| `peer::update_all_ownership` | `$updateAllOwnership`, `INITIALIZE_LOCAL_STATUS` | `plugins/peerIdPlugin.ts:212`, `:120`, `:197` | upstream bugs preserved |
| `peer::remove_peer_id` | `$removePeerId` | `plugins/peerIdPlugin.ts:229` | |
| `peer::peer_id_valid` | `createPeerIdValidator`, `isNodePeerIdValid`, `$isNodePeerIdValid`, `PeerIdValidator` | `plugins/peerIdPlugin.ts:278`, `:308`, `:322`, `:274` | |
| `comment_gate::is_comment_only_change` | `isCommentOnlyChange` | `services/lexical-service/src/lib/comment-only-change.ts:26` | |
| (private) `normalize` | `contentWithoutComments` | `services/lexical-service/src/lib/comment-only-change.ts:36` | |
| (private) `strip_identity` | `withoutIdentityState`, `IDENTITY_STATE_KEYS` | `services/lexical-service/src/lib/comment-only-change.ts:58`, `:19` | |
| `comment_gate::is_comment_only_root_change` | `CommentOnlyChangeEndpoint` + `LexicalServiceClient::is_comment_only_change` | `services/lexical-service/src/endpoints/comment-only-change.ts:43`; `services/sync-service/src/outbound/lexical_service.rs:43` | in-process |
| `export::to_plaintext` | `toPlaintext` | `services/lexical-service/src/lib/convsersions.ts:19` | |
| `export::to_comment_mark_context` | `toCommentMarkContext` → `$getCommentMarkContext` | `services/lexical-service/src/lib/convsersions.ts:37`; `packages/lexical-core/nodes/CommentNode.ts:123` | 4.1a helper |
| `export::to_search_text` | `toSearchText` | `services/lexical-service/src/lib/convsersions.ts:46` | |
| `export::extract_search_text` | `$extractSearchText` | `services/lexical-service/src/lib/search-text.ts:13` | |
| `export::to_cognition_text` | `toCognitionText` | `services/lexical-service/src/lib/convsersions.ts:73` | |
| (private) `image_md` | `$imageNodeToMdNode` | `services/lexical-service/src/lib/convsersions.ts:107` | |
| `export::to_cognition_v2` | `toCognitionV2` | `services/lexical-service/src/lib/convsersions.ts:115` | |
| `export::to_markdown_text`, `MarkdownTarget` | `toMarkdownText`, `MarkdownTarget` | `services/lexical-service/src/lib/convsersions.ts:160`, `:158` | |
| `export::element_node_to_markdown` | `$elementNodeToMarkdown` (+ `$deepCopyNode`) | `services/lexical-service/src/lib/markdown.ts:58`, `:21` | no clone needed |
| `export::cognition_from_presigned_body` | `CognitionPresignedEndpoint.handle` body logic | `services/lexical-service/src/endpoints/cognition-presigned.ts:35` | |
| `export::{SearchableNode, CognitionNode, NewMdNode}` | `types.ts`, `schemas.ts` | `services/lexical-service/src/types.ts:1-29`; `lib/schemas.ts:55-66`; `endpoints/cognition-v2.ts:14` | match `crates/lexical_client/src/types.rs` |
| `export::markdown_to_embedding_text` | `markdownToEmbeddingText` | `packages/lexical-core/utils/parsers.ts:474` | |
| (private) `strip_agent_context` | `stripAgentContext` | `packages/lexical-core/utils/parsers.ts:274` | public in 4.x if shared |
| (private) `replace_json_tag`, `document_ref_text`, `snapshot_text`, `flatten_tables`, `flatten_email_thread_embeds` | same | `packages/lexical-core/utils/parsers.ts:379`, `:393`, `:403`, `:421`, `:446` | |
| `xml::to_xml` | `toXml` | `packages/lexical-core/transformers/xml/index.ts:23` | raw JSON |
| `xml::build_xml` | `buildXml` + `XMLBuilder` options | `packages/lexical-core/transformers/xml/index.ts:19`, `:8` | hand-written builder |
| `xml::el` | `el` | `packages/lexical-core/transformers/xml/codecs.ts:40` | |
| `xml::XmlNode` | `FxpNode`, `FxpElementNode` | `packages/lexical-core/transformers/xml/codecs.ts:15-19` | |
| `xml::serialize_node` | `serializeNode` | `packages/lexical-core/transformers/xml/codecs.ts:211` | |
| (private) `serialize_unknown`, `serialize_code`, `serialize_table`, `text_leaf`, `redacted_src`, `encode_format`, `node_attrs`, `container` | same | `packages/lexical-core/transformers/xml/codecs.ts:108`, `:130`, `:162`, `:142`, `:153`, `:31`, `:48`, `:55` | |
| (private) builder | `toXml`/`arrToStr`/`attr_to_str`/`replaceEntitiesValue` | `node_modules/fast-xml-parser/src/xmlbuilder/orderedJs2Xml.js:9`, `:17`, `:115`, `:141` | v4.5.7 |
| `lexical_loro::mirror` shape | `MARKDOWN_LORO_SCHEMA` | `packages/lexical-core/markdown-loro-schema.ts:3-32` | |
| `lexical_loro::mirror::set_state` | `Mirror.setState`+`sync`, `diffMap`/`diffText`/`diffMovableList`/`diffListWithIdSelector` | `packages/loro-mirror/src/core/mirror.ts`; `packages/loro-mirror/src/core/diff.ts:711`, `:279`, `:309`, `:472` | |
| `lexical_loro::golden::MARKDOWN_GOLDEN` | `MARKDOWN_GOLDEN`, `getMarkdownGoldenBytes` | `packages/lexical-core/markdown-golden.1.ts`; `packages/lexical-core/markdown-golden.ts:3` | bytes fixed |
| `lexical_loro::snapshot::raw_state_to_loro_snapshot` | `rawMarkdownStateToLoroSnapshot` | `packages/lexical-core/markdown-loro-snapshot.ts:17` | no `awaitMirrorSync` hack |
| `lexical_loro::snapshot::serialized_editor_state_to_loro_snapshot` | `serializedEditorStateToLoroSnapshot` | `packages/lexical-core/markdown-loro-snapshot.ts:54` | |
| `snapshot::markdown_to_serialized_editor_state_with_ids` | `markdownToSerializedEditorStateWithIds`, `markdownToSerializedEditorState` | `packages/lexical-core/utils/markdown-state.ts:26`; `markdown-loro-snapshot.ts:45` | |
| `snapshot::markdown_to_loro_snapshot` | `markdownToLoroSnapshot`, `MarkdownSnapshotEndpoint` | `packages/lexical-core/markdown-loro-snapshot.ts:60`; `services/lexical-service/src/endpoints/markdown-snapshot.ts:39` | |
| (uses) `convert_to_markdown_string` | `serializedEditorStateToMarkdown` | `packages/lexical-core/utils/markdown-state.ts:56` | |
| `notion::notion_markdown_to_serialized_editor_state` | `notionMarkdownToSerializedEditorState` | `packages/lexical-core/notion-markdown.ts:22` | |
| `snapshot::notion_markdown_to_loro_snapshot`, `NotionSnapshot` | `notionMarkdownToLoroSnapshot`, `NotionSnapshot`, `NotionSnapshotEndpoint` | `packages/lexical-core/notion-markdown.ts:65`, `:56`; `services/lexical-service/src/endpoints/notion-snapshot.ts:54` | base64 only at the HTTP edge |
| `notion::{NotionLinks, NotionPageLink, NotionUserLink}` | same | `packages/lexical-core/notion/links.ts:6-21` | |
| `notion::notion_ids_in` / `find_notion_page` / `find_notion_user` | same | `packages/lexical-core/notion/links.ts:32`, `:38`, `:47` | |
| `notion::notion_lines` | `notionLines` | `packages/lexical-core/notion/transformers.ts:592` | |
| `notion::notion_transformers` | `notionTransformers` | `packages/lexical-core/notion/transformers.ts:620` | |
| (private) notion container/table/callout/dates/attributes | `containerTransformer`, `containerContent`, `dedent`, `$calloutNodes`, `$tableNode`, `notionInstant`, `dateLabel`, `$dateMention`, `$replaceWithDateMention`, `attributes`, `$replaceWithLink`, `$replaceWithPageReference`, `fileName`, `inlineTransformers`, `EMPTY_BLOCK`, `DROPPED_BLOCK`, `IMAGE_BLOCK` | `packages/lexical-core/notion/transformers.ts:528`, `:418`, `:454`, `:462`, `:490`, `:123`, `:159`, `:169`, `:182`, `:61`, `:82`, `:100`, `:196`, `:220`, `:346`, `:355`, `:365` | |
| (uses) `lexical_mark::unwrap_mark_node` | `$unwrapMarkNode` | `packages/lexical-mark/src/index.ts:22` | upstream |
| (uses) text normalization | `$normalizeTextNode`, `$canSimpleTextNodesBeMerged` | `packages/lexical/src/LexicalNormalization.ts:48`, `:16` | lexical_model |
| (uses) `dfs` | `$dfsIterator` | `packages/lexical-utils/src/index.ts:219` | pre-order, includes start |
| (uses) `lexical_markdown::{convert_from,convert_to}_markdown_string` | `$convertFromMarkdownString`, `$convertToMarkdownString` | `packages/lexical-markdown/src/index.ts:57`, `:77` | `list_indent: 2` |

#### Not ported (DOM/view, HTTP shell, or dead)

- `peerIdPlugin` transform DOM toggle `classList.toggle('local', ..)`: `packages/lexical-core/plugins/peerIdPlugin.ts:145-147`.
- Command objects `INITIALIZE_DOCUMENT_IDS` / `INITIALIZE_LOCAL_STATUS` and their `registerCommand` wiring (functions are called directly): `plugins/nodeIdPlugin.ts:37,203`, `plugins/peerIdPlugin.ts:120,197`.
- `mergeRegister` cleanup plumbing: `plugins/nodeIdPlugin.ts:185`, `plugins/peerIdPlugin.ts:188-205`.
- `CODE_HIGHLIGHT_IDS_TAG` producer `codeNodeUpdateHandler` (Prism re-tokenize, view-only): `apps/web/src/lib/core/component/LexicalMarkdown/collaboration/CollabProvider.tsx:109,380-404`.
- Hono app, `internalAuth` middleware, chanfana OpenAPI wiring, `/lexical` prefix stripping: `services/lexical-service/src/index.ts:29-90`, `services/lexical-service/src/server.ts:6-46`.
- `SyncServiceClient.raw` HTTP fetch (in-process read replaces it): `services/lexical-service/src/lib/sync-service.ts:13-72`.
- Error-to-status mapping and env validation (HTTP shell): `services/lexical-service/src/lib/error-handler.ts:23-79`.
- Presigned-URL fetch (stays with the caller): `services/lexical-service/src/endpoints/cognition-presigned.ts:41-48`.
- `awaitMirrorSync` microtask hack: `packages/lexical-core/markdown-loro-snapshot.ts:11-15`.
- Lazy golden loader `getMarkdownGoldenBytes` (use the static bytes): `packages/lexical-core/markdown-golden.ts:3-18`.
- Golden generator script (golden bytes are frozen): `packages/lexical-core/scripts/generate-golden.ts:1-48`.
- Unused `NODE_ID_LENGTH`: `services/lexical-service/src/constants.ts:1`.
- `console.log('exts')` debug line: `services/lexical-service/src/lib/convsersions.ts:89`.
- sync-service `LexicalServiceClient` (deleted after the gate moves in-process): `services/sync-service/src/outbound/lexical_service.rs:1-76`.
#### 4.3.7 Sync policy and the synced view (`sync.rs`, R2.1)

What S11 §5.5 asks of this crate for the live projection. S11 §1.2 and §1.4 are normative; this
is the list, so WP-28/WP-49 know where the items live.

- `pub static MACRO_SYNC_POLICY: MacroSyncPolicy`, `impl lexical_loro::SyncPolicy for
  MacroSyncPolicy` (S11 §1.4): `is_dropped` = `completion`; `is_transparent` = draft comment marks
  (`comment-mark` with `isDraft`, §4.1a `stripDraftCommentMarks`); the `_json` variants the same on
  `SerializedNode`; `local_state_keys() = ["local"]`; `ignore_in_remote_compare` = `url` on
  image/video with `srcType == "dss"`; `keep_local_on_remote("listitem") = ["indent"]`.
- `pub fn synced_json(state: &EditorState) -> serde_json::Value`: the editor JSON as
  `loroSyncState` (`apps/web/.../LexicalMarkdown/utils.ts:869`) sends it to Loro, with `$.local`
  removed. It drops `completion` subtrees, replaces draft comment marks by their children, removes
  `$.local` (a `$` left holding only local keys is omitted), and **keeps `sharedPeerIds`**:
  `loroSyncState` syncs every other `$` key, and `sharedPeerIds` is synced co-ownership
  (`commentPlugin.ts:220`, S11 §1.2). S8's `editor_synced_json` is this function.
- `pub static LIFT_DRAFT_COMMENT_MARKS: CommandKey<()>` and `RESTORE_DRAFT_COMMENT_MARKS:
  CommandKey<()>`, registered by the collaborative editor presets (§4.0, `MarkdownSync`): lift replaces each draft mark by its children
  and keeps the lifted marks (keys, ranges, props) in a `DraftCommentMarks` `ExtensionState`;
  restore re-wraps them (`reconcile.ts:101-120`). The session brackets `ApplyRemote` with them
  (S11 §4.4). The extension state also holds the draft count the session checks first.
- `SET_LOCAL_PEER` is §4.3.2's PeerId command.

### 4.4 Composers, mention extraction, and the lexical-service route map

Crate `macro_document_model` (`crates/client/lexical/macro_document_model/`). This section ports the
headless composers that lexical-service exposes as POST routes (`/agent-context`, `/agent-announcement`,
`/extract-reply`, `/image-markdown`, `/mentions`). It also maps every lexical-service route to its Rust
replacement and lists every Rust caller that has to switch. Macro paths are relative to the Macro repo
root, at worktree `.`.

Dependencies on other sections (do not redesign them here):
- 4.1a/4.1b node structs: `AgentContextNode`, `AgentActivityNode`/`AgentActivityRow`/`AgentActivityStatus`,
  `AgentSessionMentionNode`, `AwaitNode`, `ConnectAppNode`/`ConnectAppTarget`, `MagicChipNode`/`MagicChipMessage`/
  `MagicChipStatus`/`MagicChipAuthor`, `ReplyTargetNode`/`ReplyTargetParent`/`ReplyTargetParentType`,
  `ImageNode`/`CreateMedia`, `DocumentMentionNode`, `DocumentCardNode`, `GroupMentionNode`, `UserMentionNode`, and their
  `create_*` fns.
- 4.2: `transformers::all_transformers()`, `utils::parsers::markdown_to_embedding_text`,
  `transformers::xml_util::js_json::to_string`, `utils::quote_markdown::quote_markdown`.
- S2 markdown engine: `convert_from_markdown_string(tx, md, &Transformers, Option<NodeKey>, &MarkdownOptions)`,
  `convert_to_markdown_string(state, &Transformers, Option<NodeKey>, &MarkdownOptions)`.
- `crates/trigger_context` (existing Rust crate): `TriggerContext` and its parts. The composers read it directly.

#### Module layout

```
crates/client/lexical/macro_document_model/src/
  headless.rs                  // headless_editor(), MACRO_MARKDOWN, serialize_nodes()
  xml/builder.rs (shared, §4.3.5) // XmlNode, el, text, note, present, build_xml (fast-xml-parser 4.5.7 port)
  composers/mod.rs             // re-exports (R2: in crate macro_document_composers, no feature)
  composers/agent_context/mod.rs      // AgentContextPrompt, compose_agent_context_prompt, escape_agent_context_tags
  composers/agent_context/session.rs  // session_node, current_time_node, render_instructions, render_context
  composers/agent_context/discussion.rs // discussion_node + message/thread/channel/surface/anchor/reply_target renderers
  composers/agent_context/trigger.rs  // trigger_node and one renderer per TriggerContext kind; routine renderers
  composers/agent_context/scalar.rs   // wire_str: scalar fields as the wire spelled them
  composers/agent_announcement.rs     // AgentSessionAnnouncement, compose_agent_session_announcement
  composers/agent_chat_reply.rs       // AgentChatReply*, compose_agent_chat_reply, AGENT_SESSION_LINK_LABEL
  composers/agent_connection_prompt.rs// AgentConnectionPrompt, compose_agent_connection_prompt
  composers/explicit_reply.rs         // extract_explicit_reply
  composers/image_markdown.rs         // ImageMarkdownInput, compose_image_markdown
  composers/wire.rs                   // lexical-service request/response mirrors and handle_* fns (shadow + fixtures)
  mentions/mod.rs              // Mentions, ChannelMention, extract_mentions, extract_channel_mentions
  mentions/message_reference.rs// MessageReferenceKind, message_reference
```

Cargo (R2, B3): there is **no `composers` feature**. The `composers/` modules below live in the
server-side crate `crates/macro_document_composers` (flat, outside `crates/client/`), which depends on
`macro_document_model`, `trigger_context`, `bot_id` and `chrono`. Read `composers/…` paths below as
`macro_document_composers/src/…`. `macro_document_model` never depends on `trigger_context`, so client
crates (`document_session`, `document_session_wasm`) and sync-service link it without pulling
workspace-hack. `mentions` and `headless.rs` stay in `macro_document_model`.

#### Shared headless helpers — `headless.rs`

```rust
/// `createHeadlessEditor({ nodes: [...SupportedNodeTypes, ...NodeReplacements] })`
/// (`EditorConfig::Headless`, §4.0): all 57 `SupportedNodeTypes` (node-list.ts:75) plus
/// `.replace::<CodeNode, CustomCodeNode>(CustomCodeNode::from)` and `.replace::<ListNode, TaskListNode>(TaskListNode::from)`
/// (node-list.ts:135). Used by every composer, `/html`, the snapshots and Notion. **Not** used by
/// the doc-id export routes or the gate, which use `export_registry()` (no replacements,
/// `lib/editor.ts:4-8`).
pub fn headless_editor() -> Editor;
/// `createHeadlessEditor({ nodes: SupportedNodeTypes })` (`EditorConfig::Export`, §4.0). Returns
/// the `Editor` (it owns the `Registry`, S1 §4.1).
pub fn export_registry() -> Editor;

/// Macro's markdown options for every composer: list indent 2 (the @lexical/markdown patch),
/// `$convertFromMarkdownString`/`$convertToMarkdownString` defaults otherwise.
pub const MACRO_MARKDOWN: MarkdownOptions = MarkdownOptions {
    list_indent: 2, should_preserve_new_lines: false, should_merge_adjacent_lines: false };

/// `editor.update(build, { discrete: true })` then
/// `getEditorState().read(() => $convertToMarkdownString(ALL_TRANSFORMERS))` on a fresh `headless_editor()`.
/// One transaction, one commit, so transforms run once before export. An empty root exports "".
pub fn serialize_nodes(build: impl FnOnce(&mut Transaction) -> Result<()>) -> Result<String>;
```

Every composer that both builds and exports uses `serialize_nodes`. Composers that import go through
`convert_from_markdown_string(tx, md, all_transformers(), None, &MACRO_MARKDOWN)` inside their own
transaction. The JS ones (`agent-context.ts:1650`, `explicit-reply.ts:26`, `markdown-mentions.ts:19`) commit the
import as its own discrete update. Rust must do the same: import transaction → `commit()`, then read or mutate in a
second transaction. Import-time transforms (text merge, mention transforms) must finish before the second step reads
the tree.

`AwaitNode` ids are random (`nanoid(21)` from the editor RNG, 4.1a). `compose_agent_chat_reply` output
contains `"awaitId":"<random>"`. Golden fixtures and the shadow differ must mask the regress pattern
`"awaitId":"[A-Za-z0-9_-]{21}"` before comparing.

#### XML builder — `xml/builder.rs` (one module, also used by `/xml` in §4.3.5)

Port of `fast-xml-parser` 4.5.7 `XMLBuilder` (`node_modules/fast-xml-parser/src/xmlbuilder/orderedJs2Xml.js`) with
the options at `packages/lexical-core/transformers/xml/index.ts:8` (`ignoreAttributes:false,
attributeNamePrefix:'', preserveOrder:true, textNodeName:'#text', suppressEmptyNode:true, format:true,
indentBy:'  '`). Composers use it through `buildXml` (`xml/index.ts:19`), and `/xml` (`toXml`, `xml/index.ts:23`) uses the same builder.
The `/xml` section must reuse this module, not a second builder.

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum XmlNode {
    Element { tag: Cow<'static, str>, attrs: Vec<(Cow<'static, str>, String)>, children: Vec<XmlNode> },
    Text(String),
}
/// `el(tag, kids, attrs)` (xml/codecs.ts:40). Attribute order is insertion order.
pub fn el(tag: impl Into<Cow<'static, str>>, children: Vec<XmlNode>, attrs: Vec<(Cow<'static, str>, String)>) -> XmlNode;
pub fn text(value: impl Into<String>) -> XmlNode;               // agent-context.ts:467
pub fn note(value: impl Into<String>) -> XmlNode;               // agent-context.ts:468: el("note", [text])
/// `present(values)` (agent-context.ts:471): keep pairs whose value is Some, in order.
pub fn present<const N: usize>(values: [(&'static str, Option<String>); N]) -> Vec<(Cow<'static, str>, String)>;
/// `builder.build(nodes)`. Output starts with "\n" when `nodes` is non-empty; callers trim it.
pub fn build_xml(nodes: &[XmlNode]) -> String;
```

`build_xml` = `arr_to_str(nodes, indentation = "\n")`. `arr_to_str(list, ind)`, with `prev_tag = false`:
- `Text(t)`: `t' = escape(t)`. If `prev_tag`, push `ind`. Push `t'`. Set `prev_tag = false`.
- `Element{tag, attrs, children}`: `attr_str` = concat of ` {k}="{escape(v)}"`. An empty value gives `k=""`.
  `start = ind + "<" + tag + attr_str`. `value = arr_to_str(children, ind + "  ")`. Then:
  1. if `value` is empty, push `start + "/>"` (suppressEmptyNode; this covers `text("")` children too);
  2. else if `value` ends with `>`, push `start + ">" + value + ind + "</" + tag + ">"`;
  3. else push `start + ">"`. If `value` contains `/>` or `</`, push `ind + "  " + value + ind`, else push `value`.
     Then push `"</" + tag + ">"`.
  Set `prev_tag = true`.
- `escape` applies, in this order and globally: `&`→`&amp;`, `>`→`&gt;`, `<`→`&lt;`, `'`→`&apos;`, `"`→`&quot;`.
  It applies to text and to attribute values alike.

Branch 3 can't match on escaped text, because escaped text never contains `<`. Port it anyway.

#### Agent context — `composers/agent_context/`

```rust
/// A person the session acts for or hears from (agent-context.ts:423).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentContextPerson { pub id: String, pub name: String }

/// agent-context.ts:430
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextCurrentTime {
    pub iso: String,
    pub local: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
}

/// Request body of POST /agent-context (endpoints/agent-context.ts:425), minus the LEGACY fields.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextPrompt {
    pub prompt_markdown: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub instructions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub owner: Option<AgentContextPerson>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub sender: Option<AgentContextPerson>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub current_time: Option<AgentContextCurrentTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub trigger: Option<trigger_context::TriggerContext>,
}

/// composeAgentContextPrompt (agent-context.ts:1638). Response body is `{ "markdown": <this> }`.
pub fn compose_agent_context_prompt(input: &AgentContextPrompt) -> Result<String>;

/// agent-context.ts:1626. `&`→`&amp;`, then `<m-agent-context>`→`&amp;lt;m-agent-context>`,
/// then `</m-agent-context>`→`&amp;lt;/m-agent-context>`, all occurrences.
pub fn escape_agent_context_tags(markdown: &str) -> String;
```

The wire shape is the same as today's `lexical_client::parse_markdown::AgentContextRequest`
(`crates/lexical_client/src/parse_markdown.rs:362`). That struct flattens `owner`/`sender` to top level, and so does this one.

**Algorithm (`agent-context.ts:1638-1682`):**
1. LEGACY guard (`:1639-1644`) is not ported (see below). `wire::agent_context_from_json` rejects a body that
   carries any of `parent, anchor, replyTarget, promptMessageId, thread, channel` (`:482`) with
   `Error::InvalidArgument("legacy conversation fields")`. No Rust caller sends them. `lexical_client` has no such fields.
   This is a deliberate scope cut and a 200→error change versus JS, which rejects legacy fields only together with
   `trigger` (zod `.refine`, `endpoints/agent-context.ts:446-455`; guard `utils/agent-context.ts:1639-1644`) and
   otherwise renders them with `renderConversation` (`:1605-1607`). The shadow differ skips any body carrying a
   legacy field and counts it (`lexical.shadow.skipped{reason="legacy"}`); before phase B a route log confirms the
   count is zero.
2. `ed = headless_editor()`. Tx 1 runs `convert_from_markdown_string(tx, &escape_agent_context_tags(prompt), all_transformers(), None,
   &MACRO_MARKDOWN)`, then commit. This round trip is the sanitizer. Escaping turns user-typed `<m-agent-context>` into
   `&amp;lt;…`. The HTML-entity transformers then decode it once to visible text `&lt;m-agent-context>`, so
   `I_AGENT_CONTEXT` never matches user content.
3. Tx 2: `sections = [render_instructions(instructions), render_context(input)]`, keeping the `Some`s. If none,
   commit nothing new. Otherwise `create_agent_context_node(tx, sections.join("\n"))` (version 1). Insert it
   before the root's first child, or append it to the root when the root is empty (`:1672-1674`). Commit.
4. Return `convert_to_markdown_string(state, all_transformers(), None, &MACRO_MARKDOWN)`. The `I_AGENT_CONTEXT`
   exporter (4.2) owns the envelope `<m-agent-context>{json with <,U+2028,U+2029 escaped}</m-agent-context>`.

`render_instructions` (`:1618`): JS-trim `instructions`. Empty or absent gives `None`. Otherwise
`build_xml([el("instructions",[text(trimmed)])])`, JS-`trimStart`ed.

`render_context` (`:1604`): `nodes = [session_node(owner, sender) if owner] ++ [current_time_node if current_time] ++
[trigger_node(trigger) if trigger]`. Empty gives `None`. Otherwise `build_xml(nodes).trim_start()`. A `sender` without
`owner` is dropped silently, as in JS.

JS trim/trimStart/`\s` use the ECMAScript WhiteSpace+LineTerminator set (includes U+FEFF, U+00A0, U+1680,
U+2000–U+200A, U+2028/9, U+202F, U+205F, U+3000). Use one `js_whitespace(char)` predicate for all of them. Do not
use `str::trim`: Rust's `char::is_whitespace` omits U+FEFF and adds U+0085.

**Scalar rendering (`scalar.rs`).** TS reads the JSON that Rust serialized. Every non-`String` field the renderers
interpolate must render exactly as serde spelled it on the wire:

```rust
/// `serde_json::to_value(v)`: a JSON string gives its contents, a number gives its decimal form.
/// Uuid → lowercase hyphenated; DateTime<Utc> → chrono serde (RFC 3339, `SecondsFormat::AutoSi`, `Z`);
/// BotId and snake_case enums → their serde names; usize `hops` → decimal.
pub(crate) fn wire_str<T: Serialize>(value: &T) -> String;
```

The GitHub `payload` (`:1421`) is `JSON.stringify(JSON.parse(serde_json_output))`. Render it with
`js_json::to_string(&Value)` (4.2). Beyond JS number formatting, that function must hoist integer-like object keys
(`"0"`, `"17"`, canonical u32 < 2^32−1) ahead of the others in ascending numeric order, as JS does. It must also
round integers above 2^53 the way `JSON.parse` does. The workspace serde_json has `preserve_order`
(`crates/workspace-hack/Cargo.toml:142`), so the remaining key order matches.

`readable(md)` (`:746`) = `markdown_to_embedding_text(md)` (4.2).

An empty Rust `Vec` that `trigger_context` skips on the wire (`skip_serializing_if = "Vec::is_empty"`) counts as
**absent**. One example is `RoutineTrigger::Events.entity_ids`: JS would render `only=""` for an explicit `[]`, but the
wire never carries one.

**Renderers.** Notation: `<tag a b? c>` lists attributes in order, and `?` means omitted when absent. Children follow
`[...]`. "note :N" means `note(<string literal at agent-context.ts:N>)`, copied verbatim, with `${…}` interpolations
as shown. Every renderer is a private fn returning `XmlNode`.

| Renderer (agent-context.ts) | Output |
| --- | --- |
| `session_node(owner, sender)` :1549 | `<session owner=owner.name owner_id=owner.id>[ <prompted_by name? id? is_owner/> , note :1555 ]`. `is_owner` = `"true"` iff `sender.id == owner.id` (sender absent → `"false"`). Policy text interpolates `prompter = sender.name` or `"A bot acting for nobody"`, and `owner.name` three times. |
| `current_time_node(t)` :1578 | `<current_time iso time_zone=(t.time_zone or "UTC")>[ text(t.local), note :1588 ]`. `zone` = `in {tz}, the time zone of the primary calendar of the user` or the UTC sentence (:1580-1582). `today` = first 10 UTF-16 units of `iso`. |
| `trigger_node` :1532 | dispatch on `TriggerContext` kind (exhaustive `match`). |
| `mentioned_node(d)` :1206 | `<trigger kind="mentioned">[ note :1211 (+agent_request_note), discussion_node(d, R{marker:"mentioned_you", subject:Prompt, replies_here:true, origin:None}) ]` |
| `follow_up_node` :1223 | `addressed_by` gives (marker, explanation): `mention`→(`mentioned_you`, :1227), `explicit_reply`→(`replied_to_you`, :1231), `inferred`→(`addressed_to_you`, :1237). `<trigger kind="follow_up" addressed_by>[ note :1244 (+agent_request_note), discussion_node(d, R{marker, Prompt, true, None}) ]` |
| `conversation_node(d)` :1256 | `<trigger kind="conversation">[ note :1261, discussion_node(d, R{"wrote_to_you", Prompt, true, origin: Some(:1268)}) ]` |
| `task_assigned_node` :1275 | `<trigger kind="task_assigned" discussion=discussion_id>[ note :1281 (assigner name ×2), <assigned by by_email? by_id at/>, task_node(task) ]` |
| `requested_node` :1297 | `<trigger kind="requested">[ note :1302, <requested by by_email? by_id at repo?/> ]` (`repo` = `repo_url`) |
| `dispatched_node` :1318 | `<trigger kind="dispatched">[ note :1323, <dispatched by by_email? by_id at from_bot? from_session? repo?/> ]` |
| `routine_node` :1507 | `<trigger kind="routine">[ note :1512, <routine id name owner owner_email? owner_id/>, <instructions>[text(instructions)], <triggers>[routine_trigger_node*], routine_firing_nodes(firing)... ]` |
| `agent_request_note(d)` :1199 | `""` without `agent_request`. Otherwise the sentence at :1203 with `sender.name` ×2 and `on_behalf_of.name` ×3, starting with a space. |
| `person_attributes(p, prefix)` :749 | `[prefix=name, {prefix}_email=email?, {prefix}_id=id]` |
| `person_node(tag, p)` :760 | `<tag name email? id/>` |
| `discussion_node(d, R)` :1034 | `<discussion>[ surface_node, (R.replies_here) <origin>[text(R.origin or :1050 template with R.subject and surface_description)], person_node("sender"), (agent_request) <agent_request hops>[person_node("on_behalf_of")], context_reply_target_node, (has_attachments) note :1069, (thread) context_thread_node, (channel non-empty) context_channel_node(channel, thread.is_some()) ]` |
| `surface_description` :850 | channel→`a channel thread`, document_comment→`a document comment thread`, project_comment→`a project comment thread`, crm_company_comment→`a CRM company comment thread`, crm_contact_comment→`a CRM contact comment thread`, call_chat→`a call chat thread` |
| `surface_node` :928 | channel `<channel id name? type=channel_type/>` · document_comment `<document id name>[comment_anchor_node?]` · project_comment `<project id name/>` · crm_company_comment `<crm_company id name/>` · crm_contact_comment `<crm_contact id name/>` · call_chat `<call id title/>` |
| `comment_anchor_node` :862 | spreadsheet `<anchor type="spreadsheet" sheet_id sheet_name range>[note :867]` · pdf_pin `<anchor type="pdf_pin" pin=anchor_id>[note :876]` · pdf_highlight `<anchor type="pdf_highlight" highlight=anchor_id>[ marked_text ? <marked_text>[text] : note :888 ]` · mark `<anchor type="mark" mark=mark_id>[mark_passage_children]` |
| `mark_passage_children` :904 | `current` set → `[note :910, <marked_text>[current.marked_text], <surrounding_text>[current.surrounding_text], (marked_text set and != current.marked_text) <marked_text_when_posted>]`. Else `marked_text` set → `[note :919, <marked_text_when_posted>]`. Else `[]` (self-closing `<anchor …/>`). |
| `context_reply_target_node(t, marker, subject)` :951 | `Subject` = `"The " + subject`. quote → `<reply_target kind="quote" message=message_id thread=thread_id>[ note :963, message ? context_message_node : <preview>[text(readable(preview))] ]` · thread → `<reply_target kind="thread" thread=root_id>[note :977]` · none → `<reply_target kind="none">[note :988]` |
| `context_message_node(m, marker)` :798 | `<message id author author_email? author_id at {marker}?>[ text(readable(content)), attachment_nodes ]`. `{marker}="true"` only when `m.id == d.prompt_message_id`. |
| `attachment_nodes` :782 | each `<attachment type=entity_type id=entity_id url?/>` |
| `discussion_has_attachments` :814 | quoted message (reply_target quote with `message`) has attachments, or any message in `thread` or `channel` threads has them. |
| `context_thread_node` :831 | `<thread root messages_omitted?="true">[ (omitted) note :839, context_message_node* ]` |
| `context_channel_node(ch, beside, marker, subject)` :997 | Each thread renders bare (`context_message_node`) iff `!messages_omitted && messages.len()==1 && messages[0].id == root_id`; otherwise `context_thread_node`. Wrapper: beside → `<channel_background>[note :1017 (subject), ...]`, else `<channel_recent>[note :1023, ...]`. |
| `task_node` :1089 | `<task id title status? priority? due?>[ project? <project id name/>, (assignees non-empty) <assignees>[person_node("assignee")*], (readable(markdown) JS-trimmed non-empty) <description>[text(readable(markdown))] ]`. The description text itself is untrimmed. |
| `document_node` :1118 | `<document id name file_type>[text(readable(text))]` if `text` set, else no children. |
| `transcript_node` :1126 | `<transcript omitted?="true">[ note(lines empty && !omitted ? :1133 : :1134), <line speaker at>[text]*, (omitted) note :1142 ]` |
| `call_started_node` :1151 | `<call id title? channel=channel_name? channel_id? started_at>[ person_node("started_by"), <participants>[person_node("participant")*] ]` |
| `call_node` :1171 | `<call id title? channel? channel_id? started_at ended_at>[ <participants>[…], summary? <summary>[text], transcript_node ]`. `summary` and `transcript` lines are not passed through `readable`. |
| `routine_trigger_node` :1467 | schedule `<schedule cron timezone/>` · once `<once at/>` · events `<events names=events.join(", ") only=entity_ids.join(", ")?>[ github? <github events? actions? repositories? bots="included"/"ignored"/>, <match>[text]* per payload_match, condition? <condition>[text] ]`. Each github list is `join(", ")`, and an empty list counts as absent. |
| `routine_firing_nodes` :1434 | scheduled `[<scheduled for=scheduled_for schedule>[note :1439]]` · manual `[<manual requested_at>[note :1447]]` · event `[<event type=event.event>[routine_event_children], (conditions non-empty) <conditions>[note :1457, <condition>[text]*]]` |
| `routine_event_children` :1347 | document_created/updated → `[document_node]` · document_deleted → `[<document id name/>]` · task_created → `[task_node]` · task_status_changed → `[<change property="status" to=task.status? pull_request=url? by=github_login?/>, task_node]` · task_priority_changed → `[<change property="priority" to=task.priority?/>, task_node]` · task_property_changed → `[<change>[note :1377], task_node]` · email_received → `[<email thread subject from to=to.join(", ") received_at>[<body>[text(body)]]]` (body raw) · channel_created → `[<channel id name?/>]` · channel_message_posted/mentioned/patched → `[discussion_node(d, ROUTINE)]` · channel_message_attachment_created → `[<attachment entity_type entity_id/>, discussion_node(d, ROUTINE)]` · call_started → `[call_started_node]` · call_ended → `[call_node]` · github → `[<github event action? repository? sender?>[ payload absent ? note :1419 : <payload>[text(js_json(payload))] ]]` |
| `ROUTINE` :1341 | `R{marker:"fired_routine", subject:TriggeringMessage ("triggering message"), replies_here:false}` |

```rust
pub(crate) struct DiscussionReading { marker: &'static str, subject: Subject, replies_here: bool, origin: Option<&'static str> }
pub(crate) enum Subject { Prompt, TriggeringMessage }  // "prompt" | "triggering message"
```

**Validation parity.** zod rejects with 400 before composing. To keep the shadow diff clean on bad input, `wire::agent_context_from_json`
applies the same checks and returns `Error::InvalidArgument`. It enforces `min(1)` on every `String` field that the schema marks
`.min(1)` (`endpoints/agent-context.ts:88-409`: person/author `id`, attachment `entity_type`/`entity_id`,
task `id`, document `id`, github `delivery.event`/`action`/`repository`/`sender`, routine `cron`/`timezone`/`events[]`/
`entity_ids[]`/github lists, `current_time.iso`/`local`/`time_zone`) and on `person.id` (`:420`). Uuid/DateTime fields
can't be empty, so they need no check. `time_zone`: `Some("")` is rejected (zod `min(1)`); JS picks the note
sentence by truthiness (`time.timeZone ?`, `:1580`) and the attribute by nullishness (`?? 'UTC'`, `:1593`), so the
check is what keeps the two consistent. `compose_agent_context_prompt` called directly from Rust bypasses `wire`, so
it applies the same `min(1)` checks itself and returns `Error::InvalidArgument`.

#### Agent announcement — `composers/agent_announcement.rs`

```rust
/// agent-announcement.ts:17
#[derive(Clone, Debug, PartialEq)]
pub struct AgentSessionAnnouncement { pub reply_target: Option<ReplyTargetNode>, pub chip: MagicChipNode }

/// composeAgentSessionAnnouncement (agent-announcement.ts:34).
pub fn compose_agent_session_announcement(announcement: &AgentSessionAnnouncement) -> Result<String>;
```

1. If `reply_target` is set, `display_text = js_ws_collapse(js_trim(strip_leading_reply_target_markdown(display_text)))`. Collapsing replaces each
   `/\s+/g` run with one space, JS `\s` (`:37-44`).
2. `serialize_nodes`: if the normalized `display_text` is non-empty, append a `ReplyTargetNode` to root. Then always append
   `MagicChipNode` to root (`:51-54`).

#### Agent chat reply — `composers/agent_chat_reply.rs`

```rust
pub const AGENT_SESSION_LINK_LABEL: &str = "Agent session";   // agent-chat-reply.ts:18
pub const PENDING_REPLY_TEXT: &str = "Thinking…";            // constants.ts:88 (U+2026)

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatReply {
    pub session_id: String,
    pub body: AgentChatReplyBody,
    /// Absent = true.
    #[serde(default, skip_serializing_if = "Option::is_none")] pub link: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentChatReplyBody {
    Pending,
    Markdown { markdown: String },
    Segments {
        segments: Vec<AgentReplySegment>,
        #[serde(default)] pending: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")] footer: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentReplySegment {
    Prose { markdown: String },
    Activity { turn: u32, segment: u32, rows: Vec<AgentActivityRow>, sealed: bool },
}

/// composeAgentChatReply (agent-chat-reply.ts:145).
pub fn compose_agent_chat_reply(reply: &AgentChatReply) -> Result<String>;
```

`AgentActivityRow` is 4.1a's struct. The request schema and the composer normalize each row the same way
(`endpoints/agent-announcement.ts:72-80,189-195`, `agent-chat-reply.ts:118-124`):
- keep `id, label, status`;
- keep `detail` only when it is a non-empty string;
- keep `card` only when it is a non-null object with `kind == "view"` and a non-null object `view`. zod `.catch(null)` turns an
  invalid card into absent, and `z.object` strips unknown keys, so the card is rebuilt as `{kind, view}`;
- drop any other row key.
**Key order on export is `id, label, status, detail, card`.** 4.1a's `AgentActivityRow` serializes `id, label, detail,
status, card`. (R2) Resolved by Q21: rows are ordered maps and the constructor inserts `id, label, status, detail, card`.

Algorithm:
- `chrome(reply, pending)` (`:84`): `serialize_nodes`. If `link != Some(false)`, append
  `Paragraph[AgentSessionMentionNode{id: session_id, label: Some(AGENT_SESSION_LINK_LABEL)}]`. If `pending`, append
  `Paragraph[AwaitNode{text: PENDING_REPLY_TEXT, inline: true}]`, with an RNG `awaitId`.
- `segment_markdown(session_id, seg)` (`:107`): prose → `markdown` verbatim. activity → `serialize_nodes` with one
  `AgentActivityNode{agent_session_id: session_id, turn, segment, rows (normalized), sealed}` on root.
- `Pending`/`Markdown` (`:147-151`): `head = chrome(reply, kind == Pending)`. Pending returns `head`. Markdown returns
  `[head, markdown]` with empty strings dropped (JS `filter(Boolean)`), joined `"\n\n"`.
- `Segments` (`:152-166`): `head = chrome(reply, false)`. `working` = the last segment is `Activity` with `!sealed`.
  `tail = if pending && !working { chrome({link: Some(false)}, true) } else { "" }`. Parts = `[head, segment_markdown*,
  footer.map(|f| format!("_{f}_")).unwrap_or_default(), tail]`. Keep the parts whose JS-trim is non-empty, and join them with `"\n\n"`. The
  footer is not escaped.

#### Agent connection prompt — `composers/agent_connection_prompt.rs`

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConnectionPrompt { pub agent_tag: String, pub message: String, pub chip: ConnectAppNode }

/// composeAgentConnectionPrompt (agent-connection-prompt.ts:19).
pub fn compose_agent_connection_prompt(prompt: &AgentConnectionPrompt) -> Result<String>;
```

`serialize_nodes`: root ← `Paragraph[ Text(agent_tag, format = CODE (16)), Text(format!(" {message} ")),
ConnectAppNode(app_slug, name, target) ]`. Wire validation (`endpoints/agent-announcement.ts:113-122`): `agentTag`, `message`
and `name` are `min(1)`; `appSlug` must match `^[a-z0-9_-]+$`; `target` must be `connections` or `harness`.
Unknown targets are rejected. They are not defaulted the way node import defaults them.

#### Explicit reply — `composers/explicit_reply.rs`

```rust
/// extractExplicitReply (explicit-reply.ts:19).
pub fn extract_explicit_reply(markdown: &str) -> Result<Option<ReplyTargetNode>>;
```

1. Tx 1 imports `markdown` with `all_transformers()` and `MACRO_MARKDOWN`, then commits.
2. Read the root children. If the first child is not a `ReplyTargetNode`, return `None`.
3. `authored` = some later child is not a `ReplyTargetNode` and has a non-empty JS-trimmed `text_content()`. Decorator text
   counts here: mentions, a `MagicChipNode` (status) and so on are authored content. An `ImageNode` (`""`) is not.
4. If `authored`, return `Some(first.clone())`, the `exportComponentProps` with key order `parent, targetMessageId,
   targetThreadId, displayText, senderId`. Otherwise return `None`.
Response: `{ "reply": <ReplyTargetNode JSON> | null }`.

#### Image markdown — `composers/image_markdown.rs`

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// `static_file_id` is the string as given: zod 4.4.3 `.uuid()` accepts only the RFC 9562 form
/// (version digit `[1-8]`, variant `[89abAB]`, plus nil and max; `zod/v4/core/regexes.js` `uuid`), and
/// passes the value through unchanged, case included, into the markdown. `uuid::Uuid` would accept more
/// (braced, `urn:uuid:`, 32-hex, any version) and re-serialize lowercase, changing output bytes.
pub struct ImageMarkdownInput { pub static_file_id: String, pub url: String, pub width: NonZeroU32, pub height: NonZeroU32 }

/// composeImageMarkdown (image-markdown.ts:16).
pub fn compose_image_markdown(image: &ImageMarkdownInput) -> Result<String>;
```

`serialize_nodes`: root ← `ImageNode` from `CreateMedia{ src_type: "sfs", id: static_file_id (verbatim), url, width,
height, constrained_width: 400, constrained_height: 400, scale: None }`, `alt = "Generated image"`. Wire validation
(`endpoints/image-markdown.ts:15-20`): `staticFileId` matches the zod `uuid` regex verbatim (a regress static, or
an equivalent scan); `url` passes zod `.url()`, which validates `js_trim(url)` (JS `trim`, Unicode whitespace
including U+00A0, U+FEFF, U+2028; `zod/v4/core/schemas.js:192`) with `new URL`, so Rust checks
`url::Url::parse(js_trim(&url))` and passes the **untrimmed** `url` to the composer, as JS does (Q23); width and
height are integers in `1..=4294967295`.

#### Mention extraction — `mentions/`

Today: `/mentions` (`endpoints/mentions.ts:48`) → `extractChannelMentionsFromMarkdown` (`utils/markdown-mentions.ts:12`)
→ `$extractChannelMentions` (`utils/mentions.ts:156`). Rust `crates/lexical_mention_extractor` does **no parsing**. It
is a 53-line adapter: `LexicalMentionExtractor` (`lib.rs:12`) implements the `messages` port
`MessageMentionExtractor` (`lib.rs:36`) by calling `LexicalClient::extract_mentions` over HTTP (`lib.rs:25`). It maps
each `ExtractedMention{entity_type, entity_id}` to `messages::domain::models::SimpleMention` (`crates/messages/src/domain/models.rs:412`).
All semantics live in lexical-core.

```rust
/// Wire type of channel message references (message-references.ts:4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, strum::EnumString, strum::IntoStaticStr)]
#[serde(rename_all = "snake_case")] #[strum(serialize_all = "snake_case")]
pub enum MessageReferenceKind {
    User, Bot, Document, Form, Database, Channel, Thread, Call, CalendarEvent, Chat, AgentSession, Project,
    #[serde(rename = "static/image")] #[strum(serialize = "static/image")] StaticImage,
    #[serde(rename = "static/video")] #[strum(serialize = "static/video")] StaticVideo,
    Group, Automation, CrmCompany, CrmContact, ExternalChat,
}

/// `{ entityType, entityId }` (mentions.ts:90).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMention { pub entity_type: MessageReferenceKind, pub entity_id: String }

/// Response body of POST /mentions: `{ "mentions": [ChannelMention, ...] }`, document order, deduplicated.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mentions { pub mentions: Vec<ChannelMention> }

/// extractChannelMentionsFromMarkdown (markdown-mentions.ts:12). 4.2 lists this under
/// `utils/markdown_mentions.rs` as `extract_channel_mentions_from_markdown`: it is this one item. Keep one
/// definition, here, and `pub use` it there.
pub fn extract_mentions(markdown: &str) -> Result<Mentions>;

/// $extractChannelMentions (mentions.ts:156) over a committed state.
pub fn extract_channel_mentions(state: &EditorState) -> Result<Vec<ChannelMention>>;

/// messageReference (message-references.ts:28).
pub fn message_reference(kind: &str, id: &str) -> Option<ChannelMention>;
```

`extract_mentions`: tx 1 imports `markdown` with `all_transformers()` and `MACRO_MARKDOWN`, then commits. Then
`Mentions { mentions: extract_channel_mentions(state)? }`.

`extract_channel_mentions` visits nodes depth-first in pre-order from the root (`$dfsIterator`), with
`seen: HashSet<(MessageReferenceKind, String)>`. `push(kind, id)`: `m = message_reference(kind, id)`. If it is `None` or
`m.entity_id` is empty, drop it. If `(type, id)` is already in `seen`, drop it. Otherwise record it and append. Per node:
- `DocumentMentionNode`, or `DocumentCardNode` with `block_name` `form` or `database` → `push(document_mention_entity_type(block_name), document_id)`;
- `AgentActivityNode` → for each row whose `card` passes `is_agent_activity_card` (object, `kind=="view"`, has key
  `view`): `push("form", id)` for each id in `view_form_ids(card.view.widgets)`;
- `AgentSessionMentionNode` → `push("agent_session", id)`;
- `GroupMentionNode` → `push("group", group_alias)`;
- `UserMentionNode` → `push(if user_id.starts_with("bot|") { "bot" } else { "user" }, user_id)`;
- every other node, including Contact, Date, PR and Tag mentions and other document cards, is skipped.

`document_mention_entity_type(block_name)` (`mentions.ts:101`): `channel|project|chat|call|automation|form|database|external_chat`
→ itself; `routine`→`automation`; `email`→`thread`; `calendar`→`calendar_event`; `company`→`crm_company`;
`contact`→`crm_contact`; `initiative`→`initiative`; `pipeline`→`crm_pipeline`; anything else → `document`. `initiative`
and `crm_pipeline` are then dropped by `message_reference`.

`view_form_ids(widgets)` (`mentions.ts:133`) walks JSON. `widgets` must be an array: JS throws a TypeError otherwise,
and the route returns 500, so Rust returns `Err(Error::InvalidArgument)`. For each widget, `type=="cards"` →
`items` filtered on `type=="form"`, mapped to `id`; `type=="container"` → recurse into `children`; otherwise nothing.
A non-string `id` is skipped. JS would push it, then serialize a non-string `entityId`; record that in the skip list.

`message_reference(kind, id)` (`message-references.ts:28`): `email`/`email_thread` → `thread`; `routine` → `automation`; `user`
with `id.starts_with("bot|")` → `bot`. If the result parses as a `MessageReferenceKind`, return `Some({kind, id})`, else `None`.

Callers parse the markdown of every posted message and of whole documents (`documents/src/outbound/mention_tracker.rs:36`).
Run it inside `tokio::task::spawn_blocking` when `markdown.len() > 64 KiB`, and inline below that. The adapter span is
`lexical.extract_mentions` with fields `markdown_bytes` and `mention_count`; it records no content.

#### Wire mirrors — `composers/wire.rs`

These are for shadow mode, fixture replay and the conformance corpus only. Rust callers call the typed fns above directly.

```rust
#[derive(Serialize, Deserialize)] pub struct MarkdownResponse { pub markdown: String }       // agent-context, agent-announcement, image-markdown
#[derive(Serialize, Deserialize)] pub struct MarkdownRequest { pub markdown: String }        // mentions, extract-reply, html, snapshot/markdown
#[derive(Serialize, Deserialize)] pub struct ExtractReplyResponse { pub reply: Option<ReplyTargetNode> }

/// endpoints/agent-announcement.ts:110: z.union tried in order; the handler (:159-202) checks
/// `connectionPrompt` in body, then `chatReply`, then falls back to the announcement shape.
pub enum AgentAnnouncementRequest {
    ConnectionPrompt { connection_prompt: AgentConnectionPrompt },
    ChatReply { chat_reply: AgentChatReply },
    SessionAnnouncement { reply_target: Option<AnnouncementReplyTarget>, chip: AnnouncementChip },
}
/// endpoints/agent-announcement.ts:26. At least one of `parent` or `channel_id` is required (refine :35).
#[derive(Deserialize)] #[serde(rename_all = "camelCase")]
pub struct AnnouncementReplyTarget { pub parent: Option<ReplyTargetParent>, pub channel_id: Option<String>,
    pub target_message_id: String, pub target_thread_id: String, pub display_text: String, pub sender_id: String }
/// endpoints/agent-announcement.ts:44. `promptedMessage` is a required object; null is rejected.
#[derive(Deserialize)] #[serde(rename_all = "camelCase")]
pub struct AnnouncementChip { pub agent_session_id: String, pub channel_id: Option<String>,
    pub prompted_message: MagicChipMessage, pub status: MagicChipStatus }

pub fn agent_context_from_json(body: &serde_json::Value) -> Result<AgentContextPrompt>;
pub fn handle_agent_announcement(body: &serde_json::Value) -> Result<MarkdownResponse>;
pub fn handle_extract_reply(body: &MarkdownRequest) -> Result<ExtractReplyResponse>;
pub fn handle_image_markdown(body: &serde_json::Value) -> Result<MarkdownResponse>;
pub fn handle_mentions(body: &MarkdownRequest) -> Result<Mentions>;
```

`SessionAnnouncement` → `AgentSessionAnnouncement`. `parent` = `parent`, or else `{channel, channel_id}` (`:204-209`).
`chip.prompted_message` becomes `Some(Some(msg))`. Fields are copied, and unknown keys are ignored (zod strips them).

#### Mapping table (composers + mentions)

| Rust item | Ports | Source (file:line) | Notes |
| --- | --- | --- | --- |
| `headless_editor` | `createHeadlessEditor({nodes:[...SupportedNodeTypes,...NodeReplacements]})` | `packages/lexical-core/utils/agent-context.ts:1646` (same in every composer) | full node list, not a preset |
| `serialize_nodes` | `serialize` | `packages/lexical-core/utils/agent-chat-reply.ts:76` | generalised for all composers |
| `build_xml` | `buildXml` | `packages/lexical-core/transformers/xml/index.ts:19` | fast-xml-parser 4.5.7 ordered builder |
| `el` | `el` | `packages/lexical-core/transformers/xml/codecs.ts:40` | |
| `text`, `note` | `text`, `note` | `packages/lexical-core/utils/agent-context.ts:467`, `:468` | |
| `present` | `present` | `packages/lexical-core/utils/agent-context.ts:471` | |
| `AgentContextPrompt` | `AgentContextPrompt` (non-legacy fields) | `packages/lexical-core/utils/agent-context.ts:440` | wire: `services/lexical-service/src/endpoints/agent-context.ts:425` |
| `AgentContextPerson` | `AgentContextPerson` | `packages/lexical-core/utils/agent-context.ts:423` | |
| `AgentContextCurrentTime` | `AgentContextCurrentTime` | `packages/lexical-core/utils/agent-context.ts:430` | |
| `trigger_context::TriggerContext` (existing) | `TriggerContext` and 30 sub-types | `packages/lexical-core/utils/agent-context.ts:20-339` | reuse the Rust crate (`crates/trigger_context/src/lib.rs:24`) |
| `compose_agent_context_prompt` | `composeAgentContextPrompt` | `packages/lexical-core/utils/agent-context.ts:1638` | |
| `escape_agent_context_tags` | `escapeAgentContextTags` | `packages/lexical-core/utils/agent-context.ts:1626` | |
| `render_instructions` | `renderInstructions` | `packages/lexical-core/utils/agent-context.ts:1618` | private |
| `render_context` | `renderContext` | `packages/lexical-core/utils/agent-context.ts:1604` | private, trigger path only |
| `session_node` | `sessionNode` | `packages/lexical-core/utils/agent-context.ts:1549` | private |
| `current_time_node` | `currentTimeNode` | `packages/lexical-core/utils/agent-context.ts:1578` | private |
| `trigger_node` | `triggerNode` | `packages/lexical-core/utils/agent-context.ts:1532` | private |
| `mentioned_node` | `mentionedNode` | `packages/lexical-core/utils/agent-context.ts:1206` | private |
| `follow_up_node` | `followUpNode` | `packages/lexical-core/utils/agent-context.ts:1223` | private |
| `conversation_node` | `conversationNode` | `packages/lexical-core/utils/agent-context.ts:1256` | private |
| `task_assigned_node` | `taskAssignedNode` | `packages/lexical-core/utils/agent-context.ts:1275` | private |
| `requested_node` | `requestedNode` | `packages/lexical-core/utils/agent-context.ts:1297` | private |
| `dispatched_node` | `dispatchedNode` | `packages/lexical-core/utils/agent-context.ts:1318` | private |
| `routine_node` | `routineNode` | `packages/lexical-core/utils/agent-context.ts:1507` | private |
| `routine_trigger_node` | `routineTriggerNode` | `packages/lexical-core/utils/agent-context.ts:1467` | private |
| `routine_firing_nodes` | `routineFiringNodes` | `packages/lexical-core/utils/agent-context.ts:1434` | private |
| `routine_event_children` | `routineEventChildren` | `packages/lexical-core/utils/agent-context.ts:1347` | private |
| `ROUTINE` | `routineDiscussion` | `packages/lexical-core/utils/agent-context.ts:1341` | private const |
| `agent_request_note` | `agentRequestNote` | `packages/lexical-core/utils/agent-context.ts:1199` | private |
| `discussion_node` | `discussionNode` | `packages/lexical-core/utils/agent-context.ts:1034` | private |
| `DiscussionReading`, `Subject` | `DiscussionReading` | `packages/lexical-core/utils/agent-context.ts:769` | private |
| `context_channel_node` | `contextChannelNode` | `packages/lexical-core/utils/agent-context.ts:997` | private |
| `context_reply_target_node` | `contextReplyTargetNode` | `packages/lexical-core/utils/agent-context.ts:951` | private |
| `surface_node` | `surfaceNode` | `packages/lexical-core/utils/agent-context.ts:928` | private |
| `mark_passage_children` | `markPassageChildren` | `packages/lexical-core/utils/agent-context.ts:904` | private |
| `comment_anchor_node` | `commentAnchorNode` | `packages/lexical-core/utils/agent-context.ts:862` | private |
| `surface_description` | `surfaceDescription` | `packages/lexical-core/utils/agent-context.ts:850` | private |
| `context_thread_node` | `contextThreadNode` | `packages/lexical-core/utils/agent-context.ts:831` | private |
| `discussion_has_attachments` | `discussionHasAttachments` | `packages/lexical-core/utils/agent-context.ts:814` | private |
| `context_message_node` | `contextMessageNode` | `packages/lexical-core/utils/agent-context.ts:798` | private |
| `attachment_nodes` | `attachmentNodes` | `packages/lexical-core/utils/agent-context.ts:782` | private |
| `person_node` | `personNode` | `packages/lexical-core/utils/agent-context.ts:760` | private |
| `person_attributes` | `personAttributes` | `packages/lexical-core/utils/agent-context.ts:749` | private |
| `readable` | `readable` | `packages/lexical-core/utils/agent-context.ts:746` | = `markdown_to_embedding_text` |
| `task_node` | `taskNode` | `packages/lexical-core/utils/agent-context.ts:1089` | private |
| `document_node` | `documentNode` | `packages/lexical-core/utils/agent-context.ts:1118` | private |
| `transcript_node` | `transcriptNode` | `packages/lexical-core/utils/agent-context.ts:1126` | private |
| `call_started_node` | `callStartedNode` | `packages/lexical-core/utils/agent-context.ts:1151` | private |
| `call_node` | `callNode` | `packages/lexical-core/utils/agent-context.ts:1171` | private |
| `wire_str` | (implicit JSON round trip) | `services/lexical-service/src/endpoints/agent-context.ts:88-409` | new |
| `AgentSessionAnnouncement` | `AgentSessionAnnouncement` | `packages/lexical-core/utils/agent-announcement.ts:17` | |
| `compose_agent_session_announcement` | `composeAgentSessionAnnouncement` | `packages/lexical-core/utils/agent-announcement.ts:34` | |
| `AGENT_SESSION_LINK_LABEL` | `AGENT_SESSION_LINK_LABEL` | `packages/lexical-core/utils/agent-chat-reply.ts:18` | |
| `PENDING_REPLY_TEXT` | `PENDING_REPLY_TEXT` | `packages/lexical-core/constants.ts:88` | re-exported at agent-chat-reply.ts:20 |
| `AgentReplySegment` | `AgentReplySegment` | `packages/lexical-core/utils/agent-chat-reply.ts:26` | |
| `AgentChatReplyBody` | `AgentChatReplyBody` | `packages/lexical-core/utils/agent-chat-reply.ts:42` | |
| `AgentChatReply` | `AgentChatReply` | `packages/lexical-core/utils/agent-chat-reply.ts:58` | |
| `chrome` | `chrome` | `packages/lexical-core/utils/agent-chat-reply.ts:84` | private |
| `segment_markdown` | `segmentMarkdown` | `packages/lexical-core/utils/agent-chat-reply.ts:107` | private |
| `compose_agent_chat_reply` | `composeAgentChatReply` | `packages/lexical-core/utils/agent-chat-reply.ts:145` | |
| `AgentConnectionPrompt` | `AgentConnectionPrompt` | `packages/lexical-core/utils/agent-connection-prompt.ts:12` | |
| `compose_agent_connection_prompt` | `composeAgentConnectionPrompt` | `packages/lexical-core/utils/agent-connection-prompt.ts:19` | |
| `extract_explicit_reply` | `extractExplicitReply` | `packages/lexical-core/utils/explicit-reply.ts:19` | |
| `ImageMarkdownInput` | `ImageMarkdownInput` | `packages/lexical-core/utils/image-markdown.ts:8` | |
| `compose_image_markdown` | `composeImageMarkdown` | `packages/lexical-core/utils/image-markdown.ts:16` | |
| `MessageReferenceKind` | `MessageReferenceKind` | `packages/lexical-core/utils/message-references.ts:4` | typed enum |
| `ChannelMention` | `AuthoredMessageReference` / `ChannelMention` | `packages/lexical-core/utils/message-references.ts:24`, `packages/lexical-core/utils/mentions.ts:90` | one type |
| `message_reference` | `messageReference` | `packages/lexical-core/utils/message-references.ts:28` | |
| `document_mention_entity_type` | `documentMentionEntityType` | `packages/lexical-core/utils/mentions.ts:101` | private |
| `view_form_ids` | `viewFormIds` | `packages/lexical-core/utils/mentions.ts:133` | private, JSON walk |
| `extract_channel_mentions` | `$extractChannelMentions` | `packages/lexical-core/utils/mentions.ts:156` | |
| `extract_mentions` | `extractChannelMentionsFromMarkdown` | `packages/lexical-core/utils/markdown-mentions.ts:12` | 4.2 name re-exports this |
| `Mentions` | `/mentions` response | `services/lexical-service/src/endpoints/mentions.ts:12` | |
| `wire::*` | zod request schemas | `services/lexical-service/src/endpoints/{agent-context.ts:425,agent-announcement.ts:110,extract-reply.ts:9,image-markdown.ts:15,mentions.ts:8}` | shadow/fixtures only |

#### Not ported

- LEGACY conversation types `AgentContextMessage`…`AgentContextAnchor` — `packages/lexical-core/utils/agent-context.ts:346-420` (no Rust caller sends them).
- `LEGACY_CONVERSATION_FIELDS`, `legacyConversationFieldsIn` — `agent-context.ts:482`, `:1596` (replaced by the wire check).
- LEGACY renderer `messageNode`, `threadNode`, `describeOrigin`, `replyTargetNode`, `markChildren`, `anchorNode`, `channelNode`, `renderConversation` — `agent-context.ts:494-741`.
- `$isMentionNode`, `$extractAllMentions` — `packages/lexical-core/utils/mentions.ts:66`, `:78` (web only, no route).
- `buildMentionMarkdownString` — `packages/lexical-core/utils/mentions.ts:209` (web only, M3).
- `quoteMarkdown` — `packages/lexical-core/utils/quote-markdown.ts:6`. No route or composer uses it; only tests do. 4.2 owns it.

#### Golden fixtures (become Rust tests)

Record each test's input and output as JSON fixtures, `crates/client/lexical/macro_document_model/tests/fixtures/composers/*.json`,
with the await-id mask applied.

| File | Cases | Covers |
| --- | --- | --- |
| `packages/lexical-core/tests/agent-context.test.ts` | 38 | sanitizer round trip, envelope, legacy cases (port only the non-legacy ones; record legacy as skipped) |
| `packages/lexical-core/tests/agent-trigger-context.test.ts` | 19 | every `TriggerContext` kind |
| `packages/lexical-core/tests/agent-announcement.test.ts` | 10 | announcement; its `quoteMarkdown` cases go to 4.2 |
| `packages/lexical-core/tests/agent-chat-reply.test.ts` | 10 | chat reply states |
| `packages/lexical-core/tests/agent-connection-prompt.test.ts` | 2 (`it.each`) | connection prompt |
| `packages/lexical-core/tests/agent-activity-markdown.test.ts` | 3 | activity node export used by chat reply |
| `packages/lexical-core/tests/explicit-reply.test.ts` | 6 | extract reply |
| `packages/lexical-core/tests/generated-image.test.ts` | 2 | image markdown |
| `packages/lexical-core/tests/channel-mentions.test.ts` | 13 | `extract_mentions` |
| `packages/lexical-core/tests/form-references.test.ts` | 5 | form/database cards, activity cards, `message_reference` |
| `packages/lexical-core/tests/external-chat-references.test.ts` | 2 | `external_chat` |
| `packages/lexical-core/tests/reply-target-node.test.ts` | 6 | shared with 4.1b |
| `services/lexical-service/src/endpoints/agent-context.test.ts` | 3 | route validation (legacy + trigger → 400) |
| `services/lexical-service/test/agent-context.test.ts` | 5 | wire examples; mirrored in `crates/trigger_context/src/test.rs:384` |
| `services/lexical-service/src/endpoints/agent-announcement.test.ts` | 7 | union dispatch, card `.catch(null)` |
| `services/lexical-service/src/endpoints/extract-reply.test.ts` | 2 | |
| `services/lexical-service/src/endpoints/image-markdown.test.ts` | 3 | validation |
| `crates/lexical_client/src/parse_markdown/test.rs`, `crates/lexical_client/src/parse_markdown.rs:751-939` | 1 + inline | request JSON shapes; keep as `wire` serde tests |

These Rust adapter tests assert HTTP request bodies today, and are rewritten against the in-process call:
`crates/agent_harness/src/outbound/agent_prompt_composer/test.rs`, `crates/agent_harness/src/outbound/channel_announcer/test.rs`,
`crates/image_generation/src/outbound/lexical/test.rs`.

---

#### Route map (all lexical-service routes)

Routes come from `services/lexical-service/src/index.ts:70-88`: 17 functional routes plus two health checks. The doc-id GET routes
fetch `GET {SYNC_SERVICE_URL}/document/{id}/raw` (`services/lexical-service/src/lib/sync-service.ts:26`, 5 s timeout). They
then convert the `SerializedEditorState`. In Rust the fetch moves to the caller, through `SyncServiceClient::get_raw`
(`crates/sync_service_client/src/get_raw.rs:5`), and the conversion becomes a pure fn over
`load_raw_state(raw_json: &str) -> Result<EditorState>` (`headless.rs`: strict `parse_editor_state` with
`export_registry()`, **no** node replacements, as `lib/editor.ts:4-8`; so a legacy `"list"`/`"code"` node
exports as `list`/`code` in `/search` `rawContent` and `/cognitionv2` `tag`, with no `previewEnabled`). The
corpus has a legacy `list`/`code` case (§6.3).
(R2) The owning section's signature is authoritative; this table only points at it. Rows 8, 10 and 12
were corrected in R2 to the section names.

| # | Method + path | Handler | Request → response | Rust replacement | `lexical_client` method | Rust callers |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | GET `/health`, GET `/internal/health` | `index.ts:70`, `:88` | — → `{message}` / `{status}` | none (deleted with the service) | — | none |
| 1 | GET `/plaintext/:docId` | `endpoints/plaintext.ts:37` → `toPlaintext` (`lib/convsersions.ts:19`) | — → `{data: string}` | `text::to_plaintext(state: &EditorState) -> Result<String>` | none | **none** |
| 2 | GET `/cognition/presigned?url=` | `endpoints/cognition-presigned.ts:35` → `toCognitionText` (`lib/convsersions.ts:73`); falls back to one plain-markdown node (`:73`) | — → `{data: CognitionNode[]}` | `cognition::to_cognition_text_from_bytes(body: &[u8]) -> Result<Vec<CognitionNode>>` (the caller does the presigned fetch) | `parse_markdown_for_ai_from_url` `crates/lexical_client/src/parse_markdown.rs:539` | **none** |
| 3 | GET `/cognition/:docId` | `endpoints/cognition-text.ts:41` → `toCognitionText` | — → `{data: [{nodeId,content,rawContent,type}]}` | `cognition::to_cognition_text(state: &EditorState) -> Result<Vec<CognitionNode>>` | `parse_markdown_for_ai` `parse_markdown.rs:533` | **none** |
| 4 | GET `/cognitionv2/:docId` | `endpoints/cognition-v2.ts:52` → `toCognitionV2` (`lib/convsersions.ts:115`) | — → `{data: NewMdNode[]}` | `cognition::to_cognition_v2(state: &EditorState) -> Result<Vec<NewMdNode>>` | `parse_cognition_v2` `parse_markdown.rs:556` | `crates/documents/src/inbound/attachment/markdown.rs:28`; `crates/documents/src/inbound/toolset/read_content.rs:258` |
| 5 | GET `/search/:docId` | `endpoints/search-text.ts:41` → `toSearchText` (`lib/convsersions.ts:46`) | — → `{data: [{nodeId,content,rawContent}]}` | `search::to_search_text(state: &EditorState) -> Result<Vec<SearchableNode>>` | `parse_markdown` `parse_markdown.rs:485` | `services/search_processing_service/src/process/document/raw_document.rs:610` |
| 6 | GET `/markdown/:docId?target=internal\|external\|embedding` | `endpoints/markdown.ts:43` → `toMarkdownText` (`lib/convsersions.ts:160`) | — → `{data: string}` | `markdown_export::to_markdown_text(state: &EditorState, target: MarkdownTarget) -> Result<String>` | `get_markdown` `parse_markdown.rs:495`; `get_embedding_markdown` `parse_markdown.rs:511` | `get_markdown`: `crates/task_dedup/src/bin/pull_task_corpus.rs:469`, `:494`; `crates/collab_surface/src/outbound/surface_init.rs:160`; `crates/documents/src/outbound/markdown_text.rs:7` (`LiveMarkdownReader` impl); `crates/skills/src/outbound/document_skill_reader.rs:94`; `crates/scheduled_action/src/outbound/event_content.rs:318`; `crates/agent_trigger/src/outbound/dss_task_assignment_context.rs:96`. `get_embedding_markdown`: `crates/task_dedup/src/bin/backfill_task_embeddings.rs:410`; `crates/documents/src/inbound/axum_router/task_duplicates.rs:213` |
| 7 | GET `/comment-mark/:docId/:markId` | `endpoints/comment-mark.ts:42` → `toCommentMarkContext` (`lib/convsersions.ts:37`) | — → `{data: {markedText, surroundingText} \| null}` | `comments::to_comment_mark_context(state: &EditorState, mark_id: &str) -> Result<Option<CommentMarkContext>>` | `resolve_comment_mark` `parse_markdown.rs:522` | `crates/channel_bots/src/outbound/lexical_comment_marks.rs:29`; `crates/documents/src/outbound/lexical_comment_marks.rs:31`; `crates/agent_trigger/src/outbound/discussion_context.rs:84` (`MarkReader` impl) |
| 8 | POST `/comment-only-change` | `endpoints/comment-only-change.ts:43` → `isCommentOnlyChange` (`lib/comment-only-change.ts:26`) | `{before:{root}, after:{root}}` → `{commentOnly: bool}` | (R2) `comment_gate::is_comment_only_root_change(before_root: &serde_json::Value, after_root: &serde_json::Value) -> Result<bool>` (§4.3.3; the wire carries `{before:{root}, after:{root}}`); `default-features = false` build | none: sync-service has its own client, `LexicalServiceClient::is_comment_only_change` `services/sync-service/src/outbound/lexical_service.rs:43` | S6 inventory M10 (today `socket/protocol.rs:387`); after S6 C9 the `CommentGate` port (R2 H2) |
| 9 | GET `/xml/:docId` | `endpoints/xml.ts:37` → `toXml` (`packages/lexical-core/transformers/xml/index.ts:23`) | — → `{data: string}` | `xml::to_xml(state: &EditorState) -> Result<String>` (uses `xml_builder::build_xml`) | none | **none** |
| 10 | POST `/snapshot/markdown` | `endpoints/markdown-snapshot.ts:39` → `markdownToLoroSnapshot` | `{markdown}` → `application/octet-stream` bytes | (R2) `macro_document_model::snapshot::markdown_to_loro_snapshot(markdown: &str) -> Result<Vec<u8>>` (§4.3.6; import with Macro transformers, then `lexical_loro::snapshot`) | `markdown_to_loro_snapshot` `parse_markdown.rs:562` | `crates/collab_surface/src/outbound/surface_init.rs:61`; `crates/documents/src/outbound/markdown_init.rs:29` (`LexicalSnapshotPort` impl, reached from `:139`) |
| 11 | POST `/snapshot/notion` | `endpoints/notion-snapshot.ts:54` → `notionMarkdownToLoroSnapshot` | `{markdown, links:{pages:{id:{documentId,name}}, users:{id:{userId,email}}}}` → `{snapshot: base64, markdown}` | `notion::notion_markdown_to_snapshot(markdown: &str, links: &NotionLinks) -> Result<NotionSnapshot>` | `notion_to_loro_snapshot` `crates/lexical_client/src/notion.rs:76` | `crates/documents/src/outbound/markdown_init.rs:63` (`LexicalSnapshotPort` impl, reached from `:156`) |
| 12 | POST `/html` | `endpoints/html.ts:44` → `markdownToHtml` (`lib/html.ts:61`) | `{markdown}` → `{html, text}` | (R2) `macro_document_model::html::markdown_to_html(markdown: &str) -> Result<RenderedBody>` (§3.9; feature `html`) | `markdown_to_html` `parse_markdown.rs:582` | `crates/email/src/inbound/toolset.rs:190` |
| 13 | POST `/mentions` | `endpoints/mentions.ts:48` | `{markdown}` → `{mentions:[{entityType,entityId}]}` | `mentions::extract_mentions(&str) -> Result<Mentions>` | `extract_mentions` `parse_markdown.rs:598` | `crates/lexical_mention_extractor/src/lib.rs:25`; `crates/documents/src/outbound/mention_tracker.rs:36`; `crates/agent_harness/src/outbound/prompt_mentions.rs:47` (`MentionSource` impl) |
| 14 | POST `/extract-reply` | `endpoints/extract-reply.ts:55` | `{markdown}` → `{reply: ReplyTargetData \| null}` | `composers::extract_explicit_reply(&str) -> Result<Option<ReplyTargetNode>>` | `extract_explicit_reply` `parse_markdown.rs:726` | `crates/agent_trigger/src/outbound/lexical_explicit_reply_extractor.rs:28`; `crates/agent_trigger/src/outbound/discussion_context.rs:104` (`QuoteReader` impl). `crates/agent_trigger/src/domain/service.rs:660` calls the port, not the client. |
| 15 | POST `/agent-announcement` | `endpoints/agent-announcement.ts:157` | union (see `wire`) → `{markdown}` | `compose_agent_session_announcement`, `compose_agent_chat_reply`, `compose_agent_connection_prompt` | `compose_agent_announcement` `parse_markdown.rs:632`; `compose_agent_connection_prompt` `:653`; `compose_agent_chat_reply` `:676` | `crates/agent_harness/src/outbound/channel_announcer.rs:366` (announcement); `:506` (connection); `:349`, `:375`, `:570` (chat reply) |
| 16 | POST `/agent-context` | `endpoints/agent-context.ts:488` | `AgentContextPrompt` JSON → `{markdown}` | `composers::compose_agent_context_prompt(&AgentContextPrompt) -> Result<String>` | `compose_agent_context` `parse_markdown.rs:695` | `crates/agent_harness/src/outbound/agent_prompt_composer.rs:64` |
| 17 | POST `/image-markdown` | `endpoints/image-markdown.ts:36` | `{staticFileId,url,width,height}` → `{markdown}` | `composers::compose_image_markdown(&ImageMarkdownInput) -> Result<String>` | `compose_image_markdown` `parse_markdown.rs:614` | `crates/image_generation/src/outbound/lexical.rs:31` |

Routes with no Rust callers: `/plaintext`, `/cognition/presigned`, `/cognition/:docId`, `/xml`. A repo-wide search
(TS, Rust, workers) found no HTTP caller of these either. Delete these routes without porting them. Port
`to_plaintext`/`to_cognition_text`/`to_xml` only if the owning section finds an internal user. `parse_markdown_for_ai`, `parse_markdown_for_ai_from_url`, `CognitionResponseData` and `MarkdownNode` go with them.

`LexicalClient` construction sites (each needs a `SyncServiceClient` for in-process doc-id routes):
`services/agent_harness_service/src/main.rs:1227`, `services/agent_harness_service/src/trigger.rs:154`,
`services/agent_harness_service/src/scheduling.rs:414`, `services/agent_harness_service/src/cognition/server.rs:175`,
`services/agent_trigger_service/src/main.rs:139`, `services/document_storage_service/src/server.rs:362`,
`services/document_upload_finalizer_handler/src/runtime.rs:81`, `services/search_processing_service/src/main.rs:277`,
`crates/ai_tools/src/build_context.rs:271`, `crates/documents/src/bin/backfill_markdown_content_location.rs:176`,
`crates/task_dedup/src/bin/pull_task_corpus.rs:342`, `crates/task_dedup/src/bin/backfill_task_embeddings.rs:278` (both
production bins; both read `LexicalServiceUrl`). Test-only:
`crates/documents/src/inbound/axum_router/tests.rs:1099`, `crates/documents/src/inbound/toolset/comment_test.rs:203`,
`crates/documents/src/inbound/toolset/edit_document/test.rs:709`, `crates/email/src/inbound/toolset/test.rs:432`,
`services/agent_harness_service/src/cognition/api/context/test.rs:367`, `crates/collab_surface/src/outbound/surface_init/test.rs:32`,
`crates/agent_trigger/src/outbound/dss_task_assignment_context/test.rs:74`, `crates/image_generation/src/outbound/lexical/test.rs:20,37`.

Struct fields and pass-throughs that hold `Arc<LexicalClient>` and change type in phase B:
`crates/documents/src/inbound/toolset.rs:94,215-254`; `crates/documents/src/inbound/axum_router.rs:216,287`;
`crates/documents/src/inbound/axum_router/get_text.rs:44` (`read_text(.., LiveMarkdownReader)`);
`crates/documents/src/inbound/attachment/service.rs:33,41`; `services/search_processing_service/src/inbound/kafka_consumer/context.rs:16`,
`kafka_consumer/document.rs:159`, `process/context.rs:10`; `crates/ai_tools/src/tool_context/forms.rs:78`, `initiatives.rs:37`;
`services/document_storage_service/src/server.rs:1652` (`pg_collab_surface_service(lexical_client, ..)`). The phase-B PR
regenerates this list from `rg -l lexical_client` (71 files at this commit), grouped as construction, field, call and type
use, and fails review if a file is unaccounted for.

Adapter wiring that changes when the adapters stop wrapping `LexicalClient`: `LexicalMentionExtractor::new` at
`services/agent_harness_service/src/main.rs:1282`, `services/document_storage_service/src/server.rs:1357`, `crates/ai_tools/src/tool_context.rs:295`.
`LexicalExplicitReplyExtractor::new` at `services/agent_harness_service/src/trigger.rs:215`, `services/agent_trigger_service/src/main.rs:217`.
`MessageDiscussionReader::new` at `services/agent_harness_service/src/trigger.rs:189`, `services/agent_trigger_service/src/main.rs:184`.
`LexicalPromptMentions::new` at `services/agent_harness_service/src/main.rs:1297`. `LexicalAgentPromptComposer::new` at `services/agent_harness_service/src/main.rs:1300`.
`LexicalCommentMarks::new` at `services/document_storage_service/src/server.rs:1560` (channel_bots) and `crates/documents/src/inbound/toolset.rs:235`.
`LexicalCommsMentionTracker::new` at `services/document_storage_service/src/server.rs:1644`. `LexicalImageMarkdownComposer::new` at `crates/ai_tools/src/tool_context/images.rs:85`.
`LexicalSyncMarkdownInitializer::new` at `services/document_upload_finalizer_handler/src/runtime.rs:88`, `crates/documents/src/bin/backfill_markdown_content_location.rs:175`.
`LexicalSyncSurfaceInitializer::new` at `crates/collab_surface/src/outbound.rs:38`.

**`lexical_client` types callers use, and what replaces them:**

| `lexical_client` type | Used by | Replacement |
| --- | --- | --- |
| `LexicalClient` | all files above | removed in phase B; phase A keeps it as the switch facade |
| `parse_markdown::MarkdownTarget` (`parse_markdown.rs:397`) | task_dedup bin, collab_surface, documents `markdown_text.rs`, skills, scheduled_action, agent_trigger | `markdown_export::MarkdownTarget` (same three variants) |
| `parse_markdown::EmbeddingMarkdown` (`parse_markdown.rs:428`) | `crates/task_dedup/src/lib.rs:23` (re-export), task_dedup domain + tests, documents `create_task.rs`, `task_duplicates.rs` | move the newtype into `task_dedup` unchanged; `get_embedding_markdown` becomes `EmbeddingMarkdown::render(&EditorState)` calling `to_markdown_text(.., Embedding)` |
| `types::MarkdownParseResult` (`types.rs:47`) | `services/search_processing_service/src/parsers/markdown.rs:2`, `process/document/raw_document.rs:6` | `search::SearchableNode { node_id, content, raw_content }` |
| `types::NewMdNode` (`types.rs:33`) | `crates/documents/src/inbound/attachment/markdown.rs:8`, `crates/documents/src/inbound/toolset/read_content.rs:52` | `cognition::NewMdNode` (same serde shape) |
| `parse_markdown::ExtractedExplicitReply` (`parse_markdown.rs:65`) | agent_trigger `lexical_explicit_reply_extractor.rs`, `discussion_context.rs`, domain `service.rs`, tests | `ReplyTargetNode`. agent_trigger converts `parent` with `MessageParent::parse(kind, id)` (`crates/messages/src/domain/models.rs:60`). The legacy `channelId` decode (`parse_markdown.rs:93-110`) is no longer needed: `extract_explicit_reply` always yields `parent`. |
| `parse_markdown::ExtractedMention` | via `extract_mentions` return only | `ChannelMention` (typed `entity_type`). `prompt_mentions.rs:52` compares `== USER_MENTION_TYPE`; switch it to `MessageReferenceKind::User`. |
| `parse_markdown::ImageMarkdownRequest` | `crates/image_generation/src/outbound/lexical.rs:6` | `ImageMarkdownInput` (owned; `static_file_id: String`, `NonZeroU32`) |
| `parse_markdown::{AgentAnnouncementChip, AgentAnnouncementReplyTarget, AgentChatReply, AgentChatReplyBody, AgentReplySegment, AgentActivityRow, AgentActivityStatus, AgentConnectionChip, AgentConnectionPrompt}` | `crates/agent_harness/src/outbound/channel_announcer.rs:29` | `MagicChipNode` (`prompted_message: Some(Some(MagicChipMessage{turn, author}))` from `agent_fold` `MessageId`), `ReplyTargetNode` (parent from `MessageParent`, `channel_id` dropped), `composers::{AgentChatReply, AgentChatReplyBody, AgentReplySegment}`, 4.1a `AgentActivityRow` (`card: serde_json::to_value(agent_fold ActivityCard)`), `composers::AgentConnectionPrompt` with `ConnectAppNode{target: ConnectAppTarget}` |
| `parse_markdown::{AgentContextPerson, AgentContextPeople, AgentContextCurrentTime}` | `crates/agent_harness/src/outbound/agent_prompt_composer.rs:5` | `composers::{AgentContextPerson, AgentContextCurrentTime}` set on `AgentContextPrompt.owner`/`.sender`/`.current_time` (owned) |
| `parse_markdown::{CommentMarkContext, RenderedBody}` | return values only | `comments::CommentMarkContext`, `lexical_html::RenderedBody` |
| `notion::{NotionSnapshotRequest, NotionSnapshotLinks, NotionSnapshotPage, NotionSnapshotUser, NotionSnapshot}` | `crates/documents/src/outbound/markdown_init.rs:12` | `notion::{NotionLinks, NotionPage, NotionUser, NotionSnapshot}` (snapshot section) |

Mock seams stay as they are: `LexicalSnapshotPort` (`documents/src/outbound/markdown_init.rs:24`, mocked at `:247-332`) and
`ExplicitReplyExtractor` (`agent_trigger/src/domain/service/test.rs:650`). Their production impls switch from `LexicalClient` to the
in-process fns.

#### Migration ordering (SCOPE.md §5 M1)

Phase A flips one route group at a time inside `lexical_client`. Callers don't change. Each `LexicalClient` method
dispatches on its group's mode, `RouteMode::{Service, Shadow, InProcess}`. The mode comes from the services' existing
`MacroConfig` (CS-14), through one Doppler key per service, `LEXICAL_ROUTE_MODES` (for example `markdown=in_process,snapshot=shadow`).
It is added to `dev`, `prd`, `local/lcl_personal` and a `BootStubEnv` placeholder (CS-18). If the key is missing, startup fails. If
in-process mode errors, the call returns the error and never falls back to HTTP. In `Shadow`, the service result is returned and the in-process result is computed
beside it. A span `lexical.shadow` records `route`, `equal` and both lengths, never content. Shadow in prod needs explicit
permission (D8). In-process calls get a span `lexical.<route>` with byte counts. CPU-heavy calls (whole-document import and export)
run in `spawn_blocking`. Phase B starts once every group is `InProcess` and the corpus diff is clean. It replaces each adapter's
`LexicalClient` with the in-process fns, applies the type migration table above, then deletes `crates/lexical_client`,
`crates/lexical_mention_extractor` (its port impl moves into `messages`' wiring as a 10-line adapter over `extract_mentions`) and
`services/lexical-service`. Nothing is deployed without permission.

Phase B infra removal (one row, after the code deletion, and a deploy, so it needs explicit permission; the
rollback baseline keeps the stack until no deployed version calls it, per `.agents/rules/config-and-service-urls.md`,
and every hand-copied URL entry is removed in the same change): `infra/stacks/lexical-service/*`;
`infra/stacks/doppler-projects/index.ts:22`; `infra/packages/shared/src/gateway_priorities.ts:25,57`;
`infra/packages/shared/src/service_urls.ts:23,58,86`; `crates/macro_service_urls/src/lib.rs:644` (`LexicalServiceUrl`);
`services/search_processing_service/src/config.rs:135-136` (`lexical_service_url`); `docker/lexical-service.Dockerfile`;
sync-service's `LEXICAL_SERVICE_URL`/`LEXICAL_SERVICE_AUTH_KEY` in every `[env.*.vars]` block and secret.

| Order | Group | Routes | Callers that flip |
| --- | --- | --- | --- |
| 1 | markdown export | `/markdown`, `/search`, `/cognitionv2`, `/comment-mark` (delete `/plaintext`, `/cognition*`, `/xml` routes) | `get_markdown` ×7, `get_embedding_markdown` ×2, `parse_markdown` ×1 (search_processing_service), `parse_cognition_v2` ×2, `resolve_comment_mark` ×3 (call sites in the route table). Needs `SyncServiceClient::get_raw` at each construction site. |
| 2 | import / snapshots | `/snapshot/markdown`, `/snapshot/notion`, `/mentions`, `/extract-reply` | `markdown_to_loro_snapshot` ×2, `notion_to_loro_snapshot` ×1, `extract_mentions` ×3, `extract_explicit_reply` ×2. Exit: byte-identical snapshots against `MARKDOWN_GOLDEN`. |
| 3 | gate | `/comment-only-change` | (R2, H2) Rewritten against S6's `CommentGate` port; see "R2 resolutions" H2. Lands only after S6 C9 (port) and C16 (old `socket/protocol.rs` deleted). Until then production keeps the lexical-service HTTP adapter. The in-process impl `InProcessCommentGate` lives once, in `sync_server_core` behind feature `in-process-gate`, over `macro_document_model::comment_gate::is_comment_only_root_change`; `sync_sim` reuses it. Selection by Worker var `COMMENT_GATE_MODE` (`http` \| `in_process`) in every `[env.*.vars]` block and `wrangler.docker.toml`. Gate error or `Err` refuses (fail closed, S6 M10). Flip gate: the S8 §13 parity test. |
| 4 | composers | `/agent-context`, `/agent-announcement`, `/image-markdown` | `compose_agent_context` ×1, `compose_agent_announcement` ×1, `compose_agent_connection_prompt` ×1, `compose_agent_chat_reply` ×3, `compose_image_markdown` ×1. Shadow diff masks `awaitId`. |
| 5 | html | `/html` | `markdown_to_html` ×1 (`crates/email/src/inbound/toolset.rs:190`). |

#### Open items

- **Activity row key order.** Resolved (Q21): 4.1a stores rows and the node payload as ordered maps, and the
  composer constructor inserts `id, label, status, detail, card` (`agent-chat-reply.ts:118-124`).
- `js_json::to_string` (4.2) must also hoist integer-like keys and apply `JSON.parse` precision loss. The GitHub payload is
  the only composer input that carries arbitrary JSON.
- zod `.url()`: resolved (Q23). Keep the check as `url::Url::parse(js_trim(s))`, output untrimmed; `staticFileId` stays a
  `String` checked with the zod regex (P3-14).

---

## 5. Open questions

### 5.0 Counts

| Section | Public items specified | Mapping rows | Not-ported entries | Notes |
| --- | ---: | ---: | ---: | --- |
| §1a rich-text, plain-text, list, link, hashtag, overflow, tab | 11 node types + ~130 fns/types | ~160 | ~48 | CR-1..CR-6 originate here; §1a.4b plain text added in R1 |
| §1d clipboard | ~14 | 9 | ~10 | added in R1 (C-1) |
| §1b table | ~130 | ~100 | ~30 | 33 Macro-imported `@lexical/table` symbols covered |
| §1c code, mark, selection, utils, text, offset | ~95 | 112 | 52 | |
| §2 lexical_markdown | 4 traits + 5 types + 18 built-ins + 5 groups | ~70 | 10 | 40 live regex sites |
| §3 lexical_html | ~35 | 79 | 32 | 16 upstream + every Macro node's exportDOM |
| §4.1 custom nodes | 41 nodes + 2 abstract bases, ~155 fns | ~200 | per node | **41** registered custom nodes, not 40 (`AccountManagerRequestNode` is new); 57 classes in `SupportedNodeTypes` |
| §4.2 transformers | 79 consts + 1 factory | ~95 | — | lists are **63 / 66 / 89** (internal / external / all); union 93 objects = 13 upstream unchanged + **80 Macro** (not 61/65/87, 74) |
| §4.3 ids, gate, exports, XML, Loro | ~45 | ~75 | 14 | 4 StateKeys; snapshot code lives in `lexical_loro` |
| §4.4 composers, mentions, routes | 7 composers + helpers | ~85 | — | 19 routes (17 + 2 health), 17 `lexical_client` methods, 18 golden test files |

Routes with **no Rust caller**: `/plaintext`, `/xml`, `/cognition/:docId`, `/cognition/presigned`.
Dropped (Q12).

### 5.1 Behaviour: copy the JS bug, or fix it?

Rule (§0.2 decision 6): anything that changes stored JSON, caller-visible markdown or the comment-only
gate stays bug-compatible unless the fix is provably safe (JS throws, the path is interactive-only, or the
value never leaves the process). Rulings (R1):

- **Q1 `/html` throws on every list today. Fix (Rust and JS).** `TaskListNode.exportDOM` checks
  `instanceof HTMLElement` (`packages/lexical-core/nodes/TaskListNode.ts:100`), and the linkedom
  shim (`services/lexical-service/src/lib/html.ts:38`) doesn't install `HTMLElement`; production runs
  on Bun on ECS (`server.ts:41`), which has no such global. Verified: `markdownToHtml("- a\n- b\n")`
  throws under Bun. JS has no output, so the fix is safe. Rust emits the intended output; patch JS now
  (`typeof HTMLElement !== 'undefined' && ...`, or install it in `withDOM`) so shadow mode compares
  like with like (§3.0 finding 2).
- **Q2 `$updateAllOwnership` is a no-op from the root. Copy.** §4.3.2. A fix would make every client
  set `local` on load; leave it until JS is fixed in step.
- **Q3 `DocumentMentionNode` stamps `createdAt = now` on import when it is missing. Copy, with an
  injected clock** (`tx.now_ms()`); fixtures inject a fixed clock on both sides rather than masking
  (§4.1a). SnapshotNode `snapshotDate` follows the same rule (§4.1b).
- **Q4 `$diffNodeDeleteAtStart` reverses the order of the restored blocks. Fix, in JS and Rust
  together** (§4.1a). Confirmed: `previousSibling.insertAfter(node)` in a loop reverses the order
  (`packages/lexical-core/nodes/DiffNode.ts:212-216`). Interactive only (diffPlugin Backspace), with no
  route or shadow surface; Rust inserts each restored block after the previously inserted one, keeping
  document order.
- **Q5 Lossy imports:**
  - `ClassedBlockNode` drops `attributes`.
  - Several Macro elements drop format, indent and direction.
  - `DiffTextNode` drops its whole `$`, and `SearchMatchNode` drops `ids`.
  - Most nodes keep only `$.id` (`ImportPolicy`).

  **Copy the loss** while any JS writer is live: a Rust superset would flip-flop in Loro (Rust keeps
  the keys, the next JS write drops them). ClassedBlock `attributes` is the one with user-visible
  value; track it as a post-cutover fix.
- **Q6 `CustomCodeNode` saves as version 1 and normalizes the language only on its first writable
  clone. Copy exactly** via CR-16 (§4.1a). No "normalize at create only" fallback.
- **Q7 EquationNode `btoa` throws above U+00FF. Fix:** `btoa_or_utf8` (Latin-1 bytes when every
  unit <= U+00FF, byte-identical; UTF-8 bytes otherwise). JS throws, so any output is safe (§3.4).
- **Q8 External export with no `window`. Copy:** document mentions, cards and snapshots throw in JS
  (`transformers/mentions.ts:311,779`, `transformers/snapshot.ts:86-89`); Rust returns
  `Error::MissingHostname` unless the caller passes `host`. Never default.
- **Q9 `BookingLinkMentionNode` default URL. Copy the headless path for server routes; take
  `host: Option<&str>`** so the wasm editor in the browser matches the browser (§4.1a).

Known deliberate deviations (each has a test that pins the Rust behaviour and a ledger entry, §6.5):
- MarkNode import without `ids` (F2a-18): Rust defaults `ids = []`. JS sets `__ids = undefined`, and
  `getIDs()` (`MarkNode.ts:113-115`, `Array.from(undefined)`) then throws on export, so such a
  document cannot be exported by lexical-service today. JS has no output, so this is safe.
- Lone surrogates in regex group captures become U+FFFD (R-5, §2.9).
- loro-mirror MovableList moves use post-deletion indices (F2b-18, §4.3.6); JS moves the wrong item.
- `/agent-context` bodies with legacy conversation fields and no `trigger` are rejected (F2b-23,
  §4.4); the shadow differ skips them.
- Equation `btoa` above U+00FF (Q7), `/html` lists (Q1), `$diffNodeDeleteAtStart` order (Q4).

### 5.2 Core (`lexical_model`) contract

- **Q10 CR-1..CR-22 (§0.3) are blocking for M1.** CR-16 (writable-clone hook) and CR-17
  (registries without replacements) were added in R1, with CR-18..CR-21; CR-22 in the R1
  consistency pass; CR-13 includes JS integer-like key hoisting (Q18). S1 R1 now states each one or
  names its equivalent (§0.3 status column).
  The most important are:
  - CR-2/CR-3, subclass projection plus replacement. Seven Macro and upstream subclasses depend on it.
  - CR-10, the simple-text rule. It keeps legacy highlight nodes and Macro text subclasses
    unmerged.
  - CR-13, ordered maps and the JS number writer. The comment gate, XML, HTML and Loro all depend
    on it.

  The core takes only `fn` transforms, so CR-6 is `tx.extension::<C>()` (S1 §14.3).
- **Q11 Unknown node types. Decided (S1 D-23):** `opaque_unknown_types(true)` keeps an opaque record
  that round-trips its JSON verbatim, on for collaborative document sessions (Loro/sync-server
  documents written by newer clients); routes and the gate leave it off and return an error, as JS
  does (§4.0).

### 5.3 Scope

- **Q12 Decided: drop** `/plaintext`, `/xml`, `/cognition` v1 and `/cognition/presigned`. No Rust or
  TS caller exists (only `lexical_client`'s 17 methods and sync-service's `LexicalServiceClient`).
  The `xml` codec module stays because `xml/builder.rs` is shared with the composers; only the
  route goes.
- **Q13 Deferred** to M4's own spec.
- **Q14 Deferred to after M3**, except `text/entity.rs`, which hashtag uses and which backs Macro
  text-entity features. Overflow is node-only (the character-limit model is not ported, §1a.17).

### 5.4 Regex and numbers (verify before M1)

- **Q15 regress `i`-flag folding. Answered: it does not match V8** (verified for U+017F and
  U+212A). Mitigation M-I (§2.9) is required before M1; it affects stored JSON.
- **Q16 Lone `{`. Answered: regress accepts it** and matches the same spans as V8; no escaping.
- **Q17 Hashtag ranges. Copy** the truncated ranges (confirmed), and apply M-I (the hashtag regex
  uses `i`).
- **Q18 Integer-like key order. Copy:** the ordered-map writer implements JS own-property order
  for every pass-through object (§4.1a rule 4).
- **Q19 linkify-it. Accepted as a full port**, with a differential fuzz harness against
  linkify-it 5.0.2, after fixing the candidate merge order (§4.2.3).

### 5.5 Fixtures and shadow mode

- **Q20 Non-determinism. Decided:** inject, do not mask, wherever a source can be seeded: a fixed
  clock on both sides (JS fake timers in the generator, `tx.now_ms()` in Rust) for `createdAt` and
  `snapshotDate`; a seeded id generator on both sides for nanoid ids (11 by default, 8 on the web).
  Masks remain only for the chat reply's `awaitId` (`nanoid(21)` inside JS code the generator cannot
  seed) and are ledgered in `corpus/normalize.json` (§6.5). The golden root id `"root"` is frozen as
  bytes (§4.3.6).
- **Q21 `AgentActivityRow` order. Decided:** rows and the node payload are ordered
  `serde_json::Map`s with typed accessors (§4.1a). No struct reorder.
- **Q22 HtmlRenderNode. Decided:** parse and re-serialize in production with the htmlparser2 port
  (§3.8); compared byte for byte, no test-only normalization.
- **Q23 zod `.url()`. Decided:** keep the check as `url::Url::parse(js_trim(s))`, output
  untrimmed; `staticFileId` is a verbatim string checked with the zod regex (§4.4).

### 5.6 Corrections to SCOPE.md and the notes found while writing this spec

- Custom nodes: **41**, not 40.
- Transformers: 63/66/89, with **80** Macro transformers, not 74.
- lexical-service has 17 functional routes plus **2** health routes.
- The dead legacy markdown block is `utils.ts:30-404`, not 72-323.
- In `MarkdownImport.ts` the inline-format regexes at `:327,341-350,360` are built but never read.
  Only the code-span regex (`:337`) is live, so negative lookahead matters less than SCOPE.md §2b
  claims. regress is still needed for the KaTeX lookbehind and the unknown-mention backreference.
- `CHECK_LIST` is not in upstream `TRANSFORMERS`, and `[X]` imports as unchecked.
- `crates/lexical_mention_extractor` does no parsing. It forwards to `/mentions`.
- lexical-service's doc-id routes register **no plugins and no node replacements** per request
  (`lib/editor.ts:4`), so exports see only stored ids and keep `list`/`code` types; `/html`, the
  composers and the snapshots do add `NodeReplacements` (§4.0). The `ids` module is for editors and
  snapshots, not for the export routes.
- lexical-service runs on Bun on ECS, not workerd (`server.ts:41`); the html.ts comment is stale.

## 6. Test requirements S3 hands to S4

S4 owns the harness; these are the package-level cases and gates S4 must carry (audit R1-D items
A1, A2, A3, A5, A6, A8, A9, F7, G1, and the fixtures R1-B asked for). Each test uses the `// covers:`
convention so the coverage matrix (§6.1) can find it.

### 6.1 Traceability

- Every S3 node (41 Macro + 16 upstream classes, plus the core's opaque unknown-type record, S1 D-23), every Macro transformer const (79 +
  `list_item_image`), every route replacement (§4.4 route map rows 1-17, minus the four dropped by Q12)
  and every mapping-table row marked "Y"/P0 gets an id `S3:<module>:<item>` and at least one test that
  names it in `// covers:`. CI fails when an id has no test and no ledger entry (S4 coverage matrix).
- P0 MODEL/BRIDGE symbols in S3 scope that no upstream unit test names (R1-D A2) each get an A-hand
  literal test whose expected value is recorded from upstream: `$findMatchingParent`, `$dfsIterator`,
  `$wrapNodeInElement`, `$unwrapNode`, `$getTableNodeFromLexicalNodeOrThrow`,
  `$getTableCellNodeFromLexicalNode`, `$unmergeCell`, `$insertTableRowAtSelection`, `$computeTableMap`,
  `$deleteTableColumnAtSelection`, `registerTableCellUnmergeTransform`, `$generateJSONFromSelectedNodes`,
  `$generateNodesFromSerializedNodes`, `$ensureForwardRangeSelection`, `$getMarkIDs`,
  `INSERT_ORDERED/UNORDERED/CHECK_LIST_COMMAND` (via `insert_list`), `CLEAR_EDITOR_COMMAND`
  (`clear_editor`), `ORDERED_LIST`, `TEXT_FORMAT_TRANSFORMERS`.
- Each AMBIGUOUS S2 item in S3 scope (e.g. MD-LIST-04 `[X]` imports unchecked, MD-CODE-06, OVF-08) gets
  one A-hand test pinning upstream's actual output, or a `divergence-<n>` ledger entry linked to §5.1.

### 6.2 Macro node coverage (R1-D A6)

- The corpus job emits a node-type and field histogram (types and key presence only, no content). It is
  the evidence for every "absent in, absent out" field (§4.1a rule 2) and every strict enum.
- A synthetic per-node generator covers all 41 Macro nodes and every serialized field, including absent,
  `null` and `""` variants of each optional or truthiness-tested field. Each case runs through: JSON round
  trip under `Export` and `Headless`; markdown internal, external and embedding; XML; HTML; search text;
  cognition v2; Loro snapshot. All R == U.
- Nodes with no lexical-core test today get explicit literal tests first: `BookingLinkMentionNode` (url
  default with and without `host`, `localhost`, `www.`), `CompletionNode`, `DecoratorBlockNode` (format
  never serialized), `DiffInsertNode`, `DiffDeleteNode`, `DiffTextNode` (`ImportedState::None`),
  `InlineSearchNode`, `SearchMatchNode` (ids reset, ElementData reset), plus `ThemeMentionNode`,
  `HorizontalRuleNode`, `ImageNode`/`VideoNode` (missing `srcType/id/url/width/height`).
- M1 is gated on every node having at least one case per route above.

### 6.3 Literal fixtures named in this spec

- Tables (R1-D A3, F2a-1, F2a-2): A-hand tests from upstream runs for `$computeTableMap`, insert row,
  insert column, delete row, delete column on spanned tables; two span-changing ops in **one**
  transaction (insert row then insert row; merge then insert; insert then delete) compared with upstream
  (live-cell rule); out-of-range column insert writes a `null` `colWidths` slot.
- Code: Home/End in an ordinary paragraph returns false and changes nothing (F2b-4); a DiffTextNode in a
  code block makes `get_code_lines` return `Err` (F2b-5); empty code-text node in `start_of_code_in_line`
  (F2b-6).
- Selection: `set_blocks_type` with a block decorator holding the anchor leaves the decorator in place
  (F2b-1).
- Lists: item-only dirty under a non-check list keeps stored `checked` (F2a-6); copy of an item with stored
  `true` under a bullet list keeps `true` (F2a-7); orphan empty item loses its indent (F2a-8).
- Link: object-form TOGGLE_LINK ignores config attributes and defaults rel to `noreferrer` (F2a-10);
  autolink edit with unchanged url does not mark the node dirty (F2a-13); linkify tie between email and
  fuzzy link picks email (F2a-15).
- Markdown: export escape sets with and without preserve-newlines, including a backslash (F2a-4);
  text-format sort puts CODE last (F2a-4).
- nodeId: after an edit that dirties the root, `root.$` has no `id` (F2b-13); two duplicate ids pasted in
  one update, winner matches upstream (F2b-16). peerId: register against a loaded document resolves
  `local` (F2b-14); `Some("")` peer ids at each of the five truthiness sites (F2b-15).
- Comment gate: comment mark inside a bullet list item with `checked:false` (F2b-9); `code` rewritten as
  `custom-code` with the same text gives `false`; a language change on `code` gives `false` (F2b-8);
  asymmetric `$` merge (F2b-10).
- Registries: a legacy `"list"`/`"code"` document through `/search` and `/cognitionv2` keeps `list`/`code`
  and has no `previewEnabled` (P3-1).
- Loro: delete `[0]`, swap `[1, 2]` gives the new state (F2b-18); new `text` key with `null` reads back
  `""` (F2b-20); no `checked: null` in a snapshot of a bullet list (F2b-22).
- AgentActivity: imported rows in arbitrary key order and with `"card": null` round-trip byte for byte;
  composed rows emit `id, label, status, detail, card` (Q21, P3-13).

### 6.4 Differential and fuzz harnesses

- Comment gate (R1-D A9, security boundary): `diff/gate-fuzz`, mutation fuzzing over `(before, after)`
  JSON pairs with R's verdict == lexical-service's verdict. Mutations: text-node splits and merges; format
  and style bits; NodeState changes, including non-identity `$` on one neighbour; mark id swaps and
  overlapping ids; moving a mark across blocks; changing text inside a newly added mark; marks under list
  items; `code`↔`custom-code` and `list`↔`task-list` type swaps; legacy CodeHighlightNode; unknown types;
  key-order permutations. Plus Loro-level fuzzing: random Loro ops → server projection → gate, through
  `sync_server_core`. Fixed seeds per PR, 1M nightly; any accept-vs-reject difference blocks release.
- regress icase: `regex_icase_v8` (§2.9, mitigation M-I).
- linkify-it: differential fuzz against linkify-it 5.0.2 (Q19).
- HtmlRenderNode: `fragment.rs` differential fuzz against linkedom 0.18.13 `template.innerHTML` (Q22).
- Lone surrogates: a corpus scan for `\ud[89ab]` escapes in stored text sizes the R-5 deviation.

### 6.5 Normalization ledger (R1-D A8)

`corpus/normalize.json` lists every mask, applied symmetrically and reported with a count: `awaitId`
(`"awaitId":"[A-Za-z0-9_-]{21}"`, §4.4) is the only content mask. `createdAt`, `snapshotDate` and nanoid
ids are **not** masked; the generator and Rust inject a fixed clock and a seeded id generator (Q20). The
`/html` corpus runs against the Q1-fixed JS, so it needs no `html-tasklist-patch` mask. Each §5.1 known
deviation has a ledger entry `divergence-<n>` and a test pinning Rust's output.

### 6.6 Size and surface gates (R1-D F7, G1)

- sync-service Worker bundle size is gated with at least 20% headroom under the Cloudflare limit once
  `macro_document_model` (`default-features = false`) is linked; the build asserts that neither
  `lexical_html`, the htmlparser2 port, nor `macro_document_composers`/`trigger_context` is in the Worker's dependency graph.
- (R2, B3/M3) Client layer check, next to the Worker assertion: `cargo tree -p document_session_wasm
  --target wasm32-unknown-unknown -i workspace-hack` and the same for `macro_document_model`,
  `lexical_node_id` and `document_id` find nothing; `cargo check --target wasm32-unknown-unknown` passes
  for every crate in §0.1 except `macro_document_composers`.
- Email compose e2e covers an HTML body with bullet, numbered and check lists through the
  `markdown_to_html` path (Q1).

## R1 resolutions

Audit R1-B (`audit-r1-B.md`): 73 findings, Q1-Q23, A-1..A-12. Audit R1-D: package-related items only.
"Accepted" means the spec now says what the fix column of the audit asked, with the text at the cited
place; deviations from the audit's suggested fix are stated.

| ID | Sev | Resolution |
| --- | --- | --- |
| C-1 | Critical | Accepted. New §1d `lexical_rich_nodes::clipboard`: JSON export (incl. `'html'` destination quirk, hoisting), fresh-key import, `insert_generated_nodes` + `update_selection_on_insert`, envelope + namespace check, plain importer, MIME priority table as data, `do_drop`, `get_html_content` behind `html`. §0.1/§1 layout updated; S2 clipboard rows retargeted to `lexical_rich_nodes` (factual correction). |
| C-2 | High | Accepted. New §1a.4b `plain_text` with the differing functions and a reuse/differs table (PT-01/02/05/07/09/15). S2 plain-text rows retargeted. |
| C-3 | High | Accepted, option (a): `lexical_html` depends on `lexical_model` only and defines `ExportDom`; `lexical_rich_nodes` and `macro_document_model` hold impls behind `html` features. §0.1 table and graph, §3 crate text and §3.1 paths fixed; 40→41. |
| C-4 | Medium | Accepted. `arrow_left/right` take `is_parent_rtl` from the view and return `ArrowOutcome::MoveCharacter`; names removed from A4; all `lexical_utils::`/`lexical_selection::` paths renamed to `lexical_rich_nodes::{utils,selection}::` (plus `lexical_list`/`lexical_mark`/… phantoms). |
| C-5 | Medium | Accepted as a normative rule in §1a.0 (S1 signatures govern every override; `ExtractDestination` renamed `CopyDestination` everywhere) rather than copying S1 verbatim, because S1 is being revised in parallel. Missing hooks are CR-18; `export_json_fixup` stays CR-5. |
| C-6 | Medium | Accepted. `rich_text::clear_editor` (XB-04) added; XB-07/08/17/19/22/23 listed as not ported in §1a.17 with reason. |
| C-7 | Medium | Accepted. `clipboard::do_drop` (CLP-53..56), re-exported from `rich_text`. |
| C-8 | Low | Accepted (not-ported option): character-limit model listed in §1a.17, React-only, Macro unused. |
| C-9 | Low | Accepted. Rows for INSERT_ORDERED/UNORDERED_LIST, `CheckListConfig`, `SerializedHeadingNode`/`QuoteNode`/`OverflowNode`; prism `loadCodeLanguage`/`isCodeLanguageLoaded`/`CodePrismExtension` not ported. `InsertTableCommandPayloadHeaders` was already mapped (§1b, `IncludeHeaders`). |
| C-10 | Low | Accepted. §2.12 entry for the React HR transformer. |
| F2a-1 | High | Accepted, but **not** the audit's recommended deviation: per the user ruling (stored JSON is bug-compatible), §1b.0 now specifies the live-cell rule that reproduces JS exactly (snapshot for frozen cells, live reads for already-writable cells), needing CR-19; ops text updated; two-ops-in-one-transaction fixture in §6.3. |
| F2a-2 | Medium | Accepted (keep length): `col_widths: Option<Vec<Option<JsNumber>>>`, insert at the clamped index, `null` slot. |
| F2a-3 | Medium | Accepted. `None` returns without unescape; the invented empty-node sentence replaced by core `split_text` semantics. |
| F2a-4 | Medium | Accepted. Escape sets as code-unit lists; step 0 filter/sort added to §2.7. |
| F2a-5 | Low | Accepted. `check_has_format` reworded. |
| F2a-6 | Medium | Accepted. Transform uses parent-aware `get_checked` (dead branch kept, commented). |
| F2a-7 | Low | Accepted. `reset_on_copy_from` tests `get_checked(original)`. |
| F2a-8 | Medium | Accepted. Orphan item: format carried, indent set while detached (lost). |
| F2a-9 | Low | Accepted. Skip branch and "no `handled`" note added; non-Range selections run the node loop. |
| F2a-10 | Medium | Accepted. Object form ignores config attributes. |
| F2a-11 | Low | Accepted. `rel = Unset -> "noreferrer"` stated once as step 0. |
| F2a-12 | Low | Accepted. Empty `getNodes()` continues at step 4. |
| F2a-13 | Medium | Accepted. `!==` guards and `|| null` copied. |
| F2a-14 | Low | Accepted. TLD continuation falls through; skip branch spelled out. |
| F2a-15 | Medium | Accepted. `choose(choose(schemed, email), fuzzy)`. |
| F2a-16 | Low | Accepted. linkify-it line refs corrected. |
| F2a-17 | Low | Accepted. ESCAPED_AUTO_LINK/AUTO_LINK rows say the split stays and the middle is not re-parsed. |
| F2a-18 | Low | Accepted. Default kept; listed as a known deviation in §5.1 (JS throws, so safe). |
| F2b-1 | Medium | Accepted. Element checks on anchor/focus blocks; `is_block` defined as `INTERNAL_$isBlock`. |
| F2b-2 | Medium | Accepted (explicit `&mut Selection` option); the two-selection mix is specified. |
| F2b-3 | Low | Accepted. `prev` is the pre-patch map. |
| F2b-4 | High | Accepted. `is_selection_in_code` guard added; paragraph Home/End test in §6.3. |
| F2b-5 | Medium | Accepted. `is_code_text` = `text` or `code-highlight` only. |
| F2b-6 | Low | Accepted. Missing unit counts as non-blank. |
| F2b-7 | Low | Accepted. `handle_key_tab` returns the action; the view dispatches the command. |
| F2b-8 | High | Accepted. §4.0 `EditorConfig::{Export, Headless, Preset}`; the gate uses `Export`; gate fixtures in §6.3 and fuzz in §6.4. Needs CR-17. |
| F2b-9 | Medium | Accepted. Point (e) replaced: intrinsic transforms run as upstream; fixture added. |
| F2b-10 | Low | Accepted. Asymmetric predicate and one-merge-per-direction stated (point f) and required of S1 as CR-21. |
| F2b-11 | Low | Accepted. Third `None` case added. |
| F2b-12 | Low | Accepted. IndexMap equality cited; `arbitrary_precision` assertion added. |
| F2b-13 | Medium | Accepted. `NodeIdPlugin::register` takes a class list; CR-14 redefined as `transform_types`; root test. |
| F2b-14 | Medium | Accepted. Synthetic all-Created pass for PeerIdPlugin. |
| F2b-15 | Low | Accepted. Five truthiness sites listed; non-string serialized peerId rule. Global rule 8 in §0.2. |
| F2b-16 | Low | Accepted. Points to CR-20 transform order; duplicate fixture in §6.3. |
| F2b-17 | Medium | Accepted. Both fresh-map and existing-map (inference) paths specified; M1 scope restricted to snapshots. |
| F2b-18 | Medium | Accepted as a deliberate fix (post-deletion indices); ledgered in §5.1; test added. |
| F2b-19 | Low | Accepted with a different choice: copy JS (no `Err`; id-less items inserted, never deleted; duplicates as JS) rather than a documented deviation, per the bug-compatible default. |
| F2b-20 | Low | Accepted (copy): new `text` key with a non-string becomes an empty LoroText. |
| F2b-21 | Low | Accepted. `&MACRO_MARKDOWN` passed explicitly for markdown and Notion snapshots. |
| F2b-22 | Low | Accepted. `to_json` omits JS-`undefined` fields; rule 9 in §0.2. |
| F2b-23 | Low | Accepted. Cut kept; shadow differ skips legacy bodies and counts them. |
| F2b-24 | Low | Accepted. `Some("")` time zone rejected in `wire` and in direct Rust calls. |
| R-1 | High | Accepted. §2.9 states regress `i` differs; mitigation M-I = patched regress fork with ECMAScript non-unicode `Canonicalize` (V8 table), exhaustive `regex_icase_v8` conformance test; no `i` pattern ships on a stored-JSON path until it lands. The audit's other two options (expand classes, post-match check) rejected with reasons in §2.9. |
| R-2 | Medium | Accepted. `btoa_or_utf8`. |
| R-3 | Medium | Accepted with a different parser: production parse + re-serialize of `__html`, but with a port of htmlparser2 10.1.0 (what linkedom uses), not html5ever, whose HTML5 tree builder would not be byte-identical. Differential fuzz vs linkedom. |
| R-4 | Medium | Accepted. CR-16 `on_writable_clone`; fallback removed. |
| R-5 | Low | Accepted. Known deviation in §5.1; corpus scan in §6.4. |
| R-6 | Low | Accepted. `host: Option<&str>` with the exact `buildBookingUrl` rules. |
| P3-1 | High | Accepted. Two registries (§4.0), `load_raw_state` uses `export_registry()`, headless.rs doc fixed, §5.6 corrected, legacy `list`/`code` corpus case. |
| P3-2 | High | Accepted. One `ImportPolicy`/`ImportedState` (4 variants) and one `SearchText` (`Cow`); all 19 §4.1b impls rewritten; SearchMatchNode = `IdAndPeer` + `IMPORT_ELEMENT_DATA = false` + `from = Raw` ignoring `ids`. |
| P3-3 | High | Accepted. UTF-8 fallback via `btoa_or_utf8`; the §4.1b "return Error" sentence replaced. |
| P3-4 | Medium | Accepted. §4.1a rule 2 extended with the field list (Option + `#[opt]`, `undefined` rendering); Media fields made `Option`, divergence dropped. |
| P3-5 | Medium | Accepted. Injected clock, truthiness (empty string stamped). |
| P3-6 | Medium | Accepted. "only MagicChip emits null" claim deleted; MagicChip `channel_id` is `double_option`. |
| P3-7 | Medium | Accepted. Missing construction sites, test-only sites and field/pass-through holders added; phase-B PR regenerates from `rg -l lexical_client`. |
| P3-8 | Medium | Accepted. Phase-B infra removal row (deploy, needs permission; rollback baseline). |
| P3-9 | Low | Accepted. Auth sentence corrected (`/html`, `/health` unauthenticated). |
| P3-10 | Low | Accepted. 80 → 79 consts at §4.2. |
| P3-11 | Low | Accepted. Mapping rows for `orderedListTransformer`, `createEntityToUnicodeTransformer`. |
| P3-12 | Low | Accepted. Filtered copies keep `&'static` identity. |
| P3-13 | Low | Accepted. Node payload stored as an ordered map; composer constructor order stated. |
| P3-14 | Medium | Accepted. `static_file_id: String`, zod regex, verbatim output. |
| P3-15 | Low | Accepted. `url::Url::parse(js_trim(s))`, untrimmed output. |
| Q1 | — | Fix (Rust and JS); rationale corrected to Bun/ECS (§3.0, §5.1). |
| Q2 | — | Copy (§4.3.2, §5.1). |
| Q3 | — | Copy with injected clock (§4.1a, §5.1). |
| Q4 | — | Fix in JS and Rust (§4.1a DiffNode, §5.1). |
| Q5 | — | Copy the loss (§5.1, §4.1b open item 4). |
| Q6 | — | Copy exactly via CR-16 (§4.1a, §5.1). |
| Q7 | — | Fix: `btoa_or_utf8` (§3.4, §5.1). |
| Q8 | — | Copy: `Error::MissingHostname` (§5.1). |
| Q9 | — | Copy headless path + `host` (§4.1a, §5.1). |
| Q10 | — | CR-1..CR-21 blocking for M1; CR-16..CR-21 added (§0.3, §5.2). |
| Q11 | — | Opaque `UnknownNode` in the model; strict routes error (§4.0, §5.2). |
| Q12 | — | Drop the four routes; keep the shared xml module (§5.3). |
| Q13 | — | Deferred to M4 (§5.3). |
| Q14 | — | Deferred to after M3 except `text/entity.rs` (§5.3). |
| Q15 | — | Answered (does not match); M-I required (§2.9, §5.4). |
| Q16 | — | Answered (accepted); verbatim source (§4.2.3, §5.4). |
| Q17 | — | Copy truncated ranges + M-I (§1a.13, §5.4). |
| Q18 | — | Copy JS own-property order in the ordered-map writer (§4.1a rule 4, §5.4). |
| Q19 | — | Full linkify-it port + differential fuzz (§4.2.3, §6.4). |
| Q20 | — | Inject clock and id generator; mask only `awaitId` (§5.5, §6.5). |
| Q21 | — | Ordered maps with accessors (§4.1a, §5.5). |
| Q22 | — | Production parse/serialize (htmlparser2 port) (§3.8, §5.5). |
| Q23 | — | Keep check with `js_trim`; untrimmed output (§4.4, §5.5). |
| A-1 | — | §1a.0 normative hook-signature rule (C-5). |
| A-2 | — | §4.0 registries, per-route table (P3-1, F2b-8). |
| A-3 | — | §1b.0 live-cell rule (F2a-1). |
| A-4 | — | CR-20 cited from nodeId, gate and autolink. |
| A-5 | — | §0.2 rule 9 and §4.1a rule 2 field list (a global rule plus list, not a per-node column). |
| A-6 | — | §0.2 rule 8. |
| A-7 | — | §4.3.6: `set_state` is snapshot-only in M1; both diff paths specified for later reuse. |
| A-8 | — | F2a-4 code-unit lists. |
| A-9 | — | C-3. |
| A-10 | — | C-1, C-2. |
| A-11 | — | §4.0 EditorType table with classes and replacements. |
| A-12 | — | F2b-23 (shadow skips legacy bodies), P3-9 (auth as production caller sends it). |
| R1-D A1 | High | §6.1 S3 ids and `// covers:` requirement. |
| R1-D A2 | High | §6.1 list of S3-scope P0 symbols needing A-hand tests. |
| R1-D A3 | Medium | §6.3 table A-hand tests. |
| R1-D A5 | Medium | §6.1 AMBIGUOUS rule for S3 scope. |
| R1-D A6 | High | §6.2 histogram, synthetic per-node generator, named untested nodes, M1 gate. |
| R1-D A7 | Medium | Not S3 (web plugin test classification is S4's); the model halves those plugins call are covered by §6.3. |
| R1-D A8 | Medium | §6.5 normalization ledger; masks reduced to `awaitId` by Q20. |
| R1-D A9 | High | §6.4 gate differential fuzz, JSON- and Loro-level. |
| R1-D F7 | Medium | §6.6 Worker size gate and dependency-graph assertion (package part only). |
| R1-D G1 | High | §6.6 email-compose list case (package part only). |

Core requirements S3 now places on the S1 R1 revision: CR-14 (redefined), CR-16, CR-17, CR-18, CR-19,
CR-20, CR-21 (§0.3).

## R1 consistency pass

Checked every `lexical_model` name S3 uses against S1 Revision R1 (the source of truth) and
changed S3 to match. S1 was edited only for the two requirements that were still open (CR-19,
CR-22) and to record the D-23 ruling.

- §0.3: CR table gains an "S1 R1 status" column citing the S1 section for each CR. CR-1..CR-18,
  CR-20, CR-21 satisfied as written; CR-19 (`Transaction::is_writable`) and new CR-22
  (`Error::Invariant(&'static str)`) satisfied by S1 additions in this pass. CR texts restated in
  S1 terms (CR-2 no `Extends`; CR-6 via `ExtensionState`; CR-8 `committed_state`/`previous_selection`;
  CR-14 `transform_each` + `TransformScope`; CR-16 `after_clone`; CR-18 `can_select_before` via
  `node_trait`/`get_dyn`).
- §1a.0 rewritten: A1–A6 use S1 names (`Text`/`TextData`, `NodeKind`, `type_name`, `cast`,
  `create`/`create_exact`, `get_mut`, `copy_node(k, skip_reset)`, handle setters on
  `tx.element(k)`/`tx.text(k)`, caret names, `tx.extension::<C>()`, builders always take
  `EditorMode`). Hook-signature rule corrected: `insert_new_after`/`collapse_at_start` **take a
  `SelectionSlot`** (the old text said they take none); `remove`/`replace`/`insert_after`/
  `insert_before`/`reset_on_copy`/`is_parent_required`/`create_parent_element`/`import`/
  `adjust_export_json` are `NodeType` hooks; predicates take views; non-hooks listed. Applies to
  all of S3, not only §1a. `Result<T>` documented as a crate-local alias.
- Ancestry: every `Extends<Base>`/`base()`/`base_mut()`/`AsRef`/`AsMut`/"delegate to *Data" became
  `type Parent = Base` + `as_parent`/`as_parent_mut` (TaskListNode, AutoLinkNode, CustomCodeNode,
  CommentNode, SearchMatchNode); `list_node_overrides!`/`link_node_overrides!` removed (inheritance
  is S1's delegate-to-`Parent` default); `MarkData`/`CodeData` embeds became `MarkNode`/`CodeNode`.
  §1c.0 R1–R4 rewritten (R2 now says subclasses inherit).
- Hook renames: `export_json_fixup` → `adjust_export_json` (ListItemNode no longer writes
  `indent`; the framework uses the virtual getter), `on_writable_clone` → `after_clone`,
  `reset_on_copy_from`/`reset_on_copy_node_from` → `reset_on_copy(tx, this, original)`,
  `create_parent_element_node` → `create_parent_element`; CodeHighlightNode `set_format` →
  `coerce_format`; TableCellNode `collapse_at_start` made an associated fn; TableNode
  `can_select_before` moved to a package trait. 11 `insert_new_after`/`collapse_at_start`
  signatures now take `SelectionSlot`; Heading reads `tx.range_at(slot)`.
- Other renames: `node_mut` → `get_mut`, `type_of` → `type_name`, `Id<TextNodeData>` → `Id<Text>`,
  `Kind::` → `NodeKind::`, `tx.prev_state()` → `tx.committed_state()`, `tx.prev_selection()` →
  `tx.previous_selection()`, `commit.prev_state()` → `commit.prev`, `Commit::{created(), ..}` →
  `changes.mutations`, `create_with_replacement` → `create`, `.replace::<A, B>()` gains its
  `with` fn, `lexical_model::Node` → `NodeType`, invalid `pub use lexical_model::{select_all,
  clone_with_properties, find_matching_parent, get_adjacent_sibling_or_parent_sibling_caret,
  split_node, create_children_array}` replaced by the S1 methods, `get_character_offsets` →
  `Read::character_offsets`, `js_json` = S1 `to_js_json_string`/`js_number`.
- Transforms with captured config (autolink, text entity, nodeId, peerId) now read
  `ExtensionState`; nodeId's `Box<dyn IdGenerator>` became a seeded `NanoIdRng` in `NodeIdState`
  (S1 A-Q5); `transform_types` → `transform_each(.., TransformScope::Types(..))`.
- §1b.5 TableSelection block replaced by S1 §9.1's (`nodes`/`StateRef`/`SelectionSlot` hooks, `dirty`
  and `set` kept, typed constructor is a free fn); §1b.13 core points closed; `format_cells` uses
  `format_text_at(detached slot)`.
- §4.0, Q11, §6: unknown node types are S1's `opaque_unknown_types` (D-23 ruling: on for
  collaborative document sessions, off for `export_registry()`/`headless_editor()` and routes); the
  S3 `UnknownNode`/`from_json_lenient` are gone. Builders name their `EditorMode`;
  `export_registry()` returns an `Editor`; `headless_builder`/`preset_builder` added for sessions.
- §4.1a rule 5: `ImportPolicy` lowering onto `NodeType::import` + `JsonImport`/`StateImportFilter`
  specified. BookingLinkMentionNode keeps its host in a skipped field because `after_clone` has no
  config access.
- `tx.now_ms()` (Macro node constructors, Q3) is an S3 extension-trait helper over a `NodeClock`
  `ExtensionState`, since S1's core reads no clock; `export_json_shallow` became `export_node` with
  `children` emptied.
- The R1 resolutions table above is left as the historical record; where it names an old
  identifier, this section's name governs.

## R2 resolutions

Revision R2. Inputs: `audit-r2-1.md` (package-side items), `audit-r2-2.md` (package-side unmapped
exports, untraceable behaviours, transformer coverage) and `audit-r2-4.md` (crate layout, route map,
gate flip, loro version). S1 is not edited here; core changes S3 needs are CR-23 onward (§R2.3).
**Precedence:** where the body above and this section disagree, this section wins. Body rows edited
in place in R2 carry `(R2)`: the header, §0.1 table, §3.6 `CopyDestination`/`ExportDom`, §4.1a rule 5,
§4.1b Watermark and open items 1 and 3, §4.2 Q8 label, §4.3.1 item 4, §4.4 composers Cargo note,
activity-row note, route map rows 8/10/12 and group 3, §1b.5 "Decided", §2.9 `vendor/regress`, §6.6.

### R2.1 Audit R2-1 (fidelity), package items

| ID | Sev | Resolution |
| --- | --- | --- |
| R2-07 | major | Accepted. `pub fn insert_generated_nodes(tx: &mut Transaction<'_>, nodes: &[NodeKey], selection: SelectionSlot) -> Result<()>`: dispatch `InsertClipboardNodes { nodes, selection }` (CR-26); if no handler returns true, `tx.insert_nodes_at(selection, nodes)` then `update_selection_on_insert(tx, selection)`. `insert_clipboard_nodes_in_table(tx, nodes, selection: SelectionSlot)` reads the slot. `ids::prepare_clipboard_nodes` keeps returning false (not handled). |
| R2-08 | major | Accepted. `pub fn patch_style_text(tx: &mut Transaction<'_>, selection: SelectionSlot, patch: &StylePatch) -> Result<()>`: collapsed branch reads `tx.range_at(selection)` and writes `tx.set_selection_style_at(selection, css: Arc<str>)` (R2-54/R2-57 names); the text loop always runs on `Active` (`for_each_selected_text_node` uses `$getSelection()`, LSEL-14/15), so `split_text` remaps the active points; the final element pass uses `tx.selection_at(selection)?.nodes(view)`. `escape_formats_for_trigger(tx, selection: SelectionSlot, trigger)` the same, through `tx.toggle_selection_format_at(slot, ..)`; upstream `selection !== $getSelection()` becomes `slot != SelectionSlot::Active`. Every Macro caller passes `Active`. |
| R2-09 | major | Accepted, in place (§4.3.1 item 4): `$applyIdFromSerialized`/`$applyPeerIdFromSerialized` are ported as `ImportedState::IdOnly`/`IdAndPeer`. |
| R2-10 | minor | Accepted, in place (§4.1a rule 5): the non-empty-string clean-up applies to `IdOnly`/`IdAndPeer` only; `Full` keeps the raw `$` map. |
| R2-11 | minor | Accepted. §1a.4b rows: **SELECT_ALL** gets its own row, "`tx.select_all(None)` on any selection, including none; returns true" (`lexical-plain-text/src/index.ts:349`). **CONTROLLED_TEXT_INSERTION**: "Range only, else false. `Text(s)` → `insert_text(s)`. `Event { data, data_transfer }`: `data_transfer` present → `clipboard::insert_data_transfer_for_plain_text(tx, dt, Active)`; else `insert_text(data)` when `js_truthy(data)`. Returns true in every Range case." The payload enum is S1's `ControlledTextInsertion::{Text, Event}`. |
| R2-12 | minor | Accepted. §4.3.3 step 4 reads "when CR-21's asymmetric `can_merge(prev, next)` holds"; phantom paths `lexical_list::get_list_depth`, `lexical_link::sanitize_url`, `lexical_table::compute_table_map_skip_cell_check`, `lexical_mark::unwrap_mark_node` read `lexical_rich_nodes::{list,link,table,mark}::…`; `is_block` (§1c.3 `set_blocks_type`) is "a non-inline DecoratorNode, or a non-root, **non-shadow-root**, non-inline ElementNode with `can_be_empty() != false` whose first child is None, text, a LineBreak or inline" (`LexicalUtils.ts:2006-2024`); the insert-column loop reads `prev -= span(v).col_span` live (§1b.0 live-cell rule; always `v`, never the current `after`). |
| R2-13 | minor | Accepted. `patch_style_text` final pass: "once each within the final pass; the dedupe set starts empty, so an empty anchor element already patched in the collapsed branch is patched a second time and a `Compute` patch runs twice, as upstream (`lexical-node.ts:323-345`)". Fixture `selection::patch_style_text_compute_runs_twice_on_empty_anchor`. |
| R2-14 | minor | Accepted. `update_selection_on_insert`, element point: walk `caret_range(caret_from_point(anchor, Previous), child_caret(ROOT, Next).flipped())` depth-first, skipping the anchor caret itself; the first Text origin wins (select its end); stop at any element origin that is not inline, entering or exiting (`clipboard.ts:419-431`). |
| R2-15 | minor | Accepted. Every S3 `impl … for` block uses S1's exact signatures, including R2-38's kind-trait shape (`impl ElementNode for X { type Parent = …; … }`, `Parent`/`as_parent*` no longer on `NodeType`). Concretely: predicates take the view (`fn can_indent(&self, _: ElementView<'_>) -> bool`, `can_merge_when_empty`, Hashtag, Overflow `exclude_from_copy(&self, node: ElementView<'_>, destination: Option<CopyDestination>)`, TableRow/TableCell, Code `can_indent`, Mark, every Macro decorator's `is_inline`/`is_keyboard_selectable`/`text_content(&self, node: DecoratorView<'_>) -> Cow<'_, str>`); `extract_with_child(&self, node: ElementView<'_>, child, selection: Option<&Selection>, destination)`. Deleted: `exclude_from_copy` on DecoratorNodes (dead upstream: `excludeFromCopy` is called only for `$isElementNode`, `LexicalEditor.ts:767`, `clipboard.ts:492`) and `is_keyboard_selectable` on `impl ElementNode for CompletionNode`. Helpers forward the selection: `code::hooks::collapse_at_start(tx, code, restore_selection: bool)`, `mark::hooks::insert_new_after(tx, mark, selection: SelectionSlot, restore_selection: bool)`. CI: crate `lexical_spec_doctests` compiles every S3 `impl` block against S1's traits (WP acceptance for WP-21/22/25). |
| R2-16 | minor | Accepted; moved to "copied" in §5.1. `TableRowNode.height: DoubleOption<JsNumber>` (absent / `null` / value; `"height": null` round-trips). `TableCellNode.col_span`/`row_span: JsNumber` read with JS `x \|\| 1` (absent, `0`, `NaN` → 1; negative and fractional kept and exported verbatim). The table map treats a non-integer span as JS does: loop bounds compare as f64 (`for (j = 0; j < colSpan; j++)`), so `1.5` covers 2 slots; fixtures `table::fractional_col_span_round_trips`, `table::row_height_null_round_trips`. |
| R2-19 | major | Accepted (CR-27). §1a.4 `select_all` row (and §1a.4b): handlers call `tx.select_all(None)`: whole document even inside a table cell. `select_all_in_table` (TBL-PLG-4) keeps its own condition. |
| R2-20 | major | Accepted (CR-28). `CodeNode` sets `const HAS_LANGUAGE_FIELD: bool = true` (inherited by `CustomCodeNode`); nothing else in S3 sets it. |
| R2-21 | major | Accepted (CR-21 in S1). `rich_text::delete_word(tx, direction, target: ModifyTarget, character_target: ModifyTarget)` and `delete_line` likewise; plain-text the same. |
| R2-31 | minor | Accepted. `insert_node_to_nearest_root`: "…`SiblingCaret(last of get_nodes, Next)` when `get_nodes` is non-empty. With no selection, or an empty `get_nodes`, append an empty paragraph to root and use the caret before it (`lexical-utils/src/index.ts:510-521`)". |
| R2-32 | minor | Accepted. `slice_selected_text_node_content(view, selection, node) -> Cow<str>` returns the full text unless the node `is_selected`, is not token or segmented, the selection has start/end points, and the node is the anchor or focus node. First/last by `is_backward()`: first = backward ? focus : anchor. |
| R2-33 | minor | Accepted. `get_selection_style_value_for_property`: "For a RangeSelection only, exclude the boundary nodes…; other selection kinds fold every text node. A node's value is `style[property]` if truthy, else `default`." |
| R2-34 | minor | Accepted. `unmerge_cell_node`: "new cells are inserted directly after `cell`, i = 1..col_span-1, so the final row order is `cell, i=col_span-1, …, i=1` and column `start+k` gets `col_styles[col_span-k] \| row_styles[0]`. Bug-compatible (`LexicalTableUtils.ts:977-984`)". Fixture `table::unmerge_header_bits_reversed`. |
| R2-35 | minor | Accepted. `ListItemNode::collapse_at_start`, nested branch: "the children move into a paragraph that is never inserted, so they are GC'd; `list_node_parent.select()` puts the caret at the parent item's end. Port as is" (`LexicalListItemNode.ts:406-418`). Fixture `list::collapse_at_start_nested_drops_content`. |
| R2-36 | minor | Accepted. `trim_text_content_from_anchor(tx, anchor: SelectionSlot, delete_count: usize)`; re-read `tx.anchor_at(slot)` at the split step (`lexical-node.ts:214-221`). |
| R2-37 | minor | Accepted. `backspace_action` order: decorator-target check, then the indented-block outdent check, then Range/Node. Returns `BackspaceAction::{Outdent, DeleteCharacter { range: bool }, NotHandled}`; the JS glue applies the `IS_IOS && ko-KR` bail-out only for `DeleteCharacter { range: true }` (`lexical-rich-text/src/index.ts:1001-1012`). |
| R2-44 | major | Accepted (CR-24). CR-22 now reads `Error::Invariant(Cow<'static, str>)` plus `lexical_model::invariant!(fmt, args…)`, which formats `%s` positions as upstream (`LexicalTableSelection.ts:74`, `LexicalTableSelectionHelpers.ts:851`). |
| R2-45 | major | Accepted. §1a.0's `Result<T>` sentence is replaced: each package crate defines `#[derive(Debug, thiserror::Error)] pub enum Error { #[error(transparent)] Model(#[from] lexical_model::Error), … }` and `type Result<T> = std::result::Result<T, Error>`. Variants: `lexical_rich_nodes::Error::{MissingHostname, InvalidArgument(Cow<'static, str>)}`; `lexical_markdown::Error::{InvalidArgument(..), MissingNode { type_name: &'static str }}` (`check_dependencies`); `lexical_html::Error::UnregisteredNodeType { type_name: String }`; `macro_document_model::Error::{RichNodes(#[from]), Markdown(#[from]), Html(#[from]), Loro(#[from] lexical_loro::Error), InvalidArgument(..), UnknownSerializedType { type_name }}`. Hooks, transforms and plugin handlers registered with the core still return `lexical_model::Error` (the core calls them); package-level failures inside them use `Error::Invariant`. |
| R2-46 | major | Accepted, in place (§3.6): `pub use lexical_model::CopyDestination`; `ExportDom` keeps only `export_dom`. The `DomRenderConfig` defaults call `Read::exclude_from_copy(key, Some(Html))` and `Read::extract_with_child(key, child, selection, Html)`. |
| R2-47 | major | Accepted. Every S3 signature a transaction can reach takes `StateRef<'_>` (or `impl Read`), never `&EditorState`: `ExcludeParent = fn(StateRef<'_>, NodeKey) -> bool` (a `fn` pointer, see R2-53), `TableSelectionExt::get_nodes(&self, view: StateRef<'_>)`, `visit_recursively(view, ..)`, `is_at_node_end(view, point)`, `get_id`/`get_peer_id`/`get_shared_peers`/`get_local` (§4.3.1–4.3.2), `peer_id_valid(PeerIdTarget::Node(StateRef<'_>, NodeKey))`. Functions only called on committed state (exports, gate, XML) keep `&EditorState` and call `state.view()`. |
| R2-48 | major | Accepted (CR-23). `NodeIdPlugin`/`PeerIdPlugin` implement `Plugin::after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), lexical_model::Error>`; the free `after_commit(editor: &mut Editor, ..)` fns are deleted. NodeId's follow-up has no tag (synced); PeerId's is tagged `LOCAL_STATUS_TAG`. Order: plugins in registration order, sharing one follow-up per round (CR-23 as restated in R2.1); History records the follow-up as its own commit (S1 decides merge; core `History` is not used by collab sessions, S7 §2.2). Initialization (`skipInitialization: false`) is `build()` running `after_commit` with the synthetic all-Created commit when `initial_state` is set. |
| R2-52 | minor | Accepted (CR-25). `TableSelection: Clone + Copy`; `TableSelectionExt::insert_nodes(self, tx, nodes)`; S3 uses `Selection::as_table()`/`is_table()`. |
| R2-53 | minor | Resolved without amending S1:17. Matchers and `ExcludeParent` become data and `fn` pointers in `ExtensionState` (`AutoLinkConfig { matchers: Vec<RegexLinkMatcher>, exclude_parents: Vec<ExcludeParent> }`; `create_link_matcher_with_reg_exp` returns data). `ChangeHandler` is removed. (R2.1: superseded by S1 §14.5) the autolink transform emits the plugin event `AutoLinkChanged { url: Option<String>, prev_url: Option<String> }` (`tx.emit(&AUTO_LINK_CHANGED, ..)`), which rolls back with the transaction; the host reads `Commit::events_of` / `Effect::PluginEvent`. There is no `AutoLinkChanges` extension state. Macro passes no `onChange`. Hashtag/text-entity `GetMatch`/`CreateEntity` are `fn` pointers. All `ExtensionState` types are `Send + Sync` (R2-41). |
| R2-38/39/40/41/54/57 | — | S1-side; S3 follows: kind-trait `Parent` shape in every impl (R2-15); `StateRef` by-value borrows; `EditorState::root_text_content()`/`is_empty_state()` replace the shadowing inherent names in every S3 sketch that calls them on `&EditorState`; `_at` names (`anchor_at`, `set_selection_style_at`, `toggle_selection_format_at`); `Arc<str>` selection and props styles. |

**Fresh line-check, `$setBlocksType`** (`lexical-selection/src/range-selection.ts:86-147`), done for
R2: block collection, `$isPointAtBlockStart` (`:56-79`) and map order match §1c.3; divergences fixed
here: (a) `is_block` must exclude shadow roots (R2-12); (b) the signature cannot take
`Option<&Selection>` from the active selection while `tx.replace` remaps it (the R2-08 problem):
`pub fn set_blocks_type(tx: &mut Transaction<'_>, selection: Option<SelectionSlot>, create: fn(&mut Transaction<'_>) -> Result<NodeKey>, after_create: fn(&mut Transaction<'_>, NodeKey, NodeKey) -> Result<()>) -> Result<()>`, collecting the blocks from `tx.selection_at(slot)` into an `IndexMap` before the first replace; (c) a `TableSelection` has start/end points (`getStartEndPoints` returns them), so "no start/end points" means `NodeSelection` only. `set_blocks_type_default` passes `copy_block_format_indent`. Same slot change for `wrap_nodes(tx, selection: SelectionSlot, ..)`.

### R2.2 Audit R2-2 (completeness), package items

**G-2 (duplicate ids).** S3 cites the `@lexical/selection` behaviours as `LSEL-nn` (S2's §3D rename);
every `SEL-nn` in S3 §1c.3 means core §3A unless written `LSEL-`.

**G-5 (package command constants): one `static` per package command**, `CommandKey<P>` dispatched as
S1 `Command::Extension` (S1 Q3); handlers are the already-mapped fns at the priorities §1a.9/§1a.11/§1b.7
already give:

| Rust static (module) | Upstream | Payload `P` | Handler |
| --- | --- | --- | --- |
| `list::INSERT_ORDERED_LIST` | `INSERT_ORDERED_LIST_COMMAND` | `()` | `insert_list(tx, ListType::Number)` |
| `list::INSERT_UNORDERED_LIST` | `INSERT_UNORDERED_LIST_COMMAND` | `()` | `insert_list(tx, ListType::Bullet)` |
| `list::INSERT_CHECK_LIST` | `INSERT_CHECK_LIST_COMMAND` | `()` | `insert_list(tx, ListType::Check)` (registered by `register_list`; the click/keyboard half stays JS) |
| `list::REMOVE_LIST` | `REMOVE_LIST_COMMAND` | `()` | `remove_list(tx)` |
| `list::UPDATE_LIST_START` | `UPDATE_LIST_START_COMMAND` | `UpdateListStart { list: NodeKey, new_start: JsNumber }` | `update_list_start` |
| `link::TOGGLE_LINK` | `TOGGLE_LINK_COMMAND` | `ToggleLinkPayload::{Url(String), Attributes { url, attributes: ToggleLinkAttributes }, Remove}` | `handle_toggle_link_command` |
| `table::INSERT_TABLE` | `INSERT_TABLE_COMMAND` | `InsertTableCommandPayload { columns: String, rows: String, include_headers: Option<IncludeHeaders> }` (`InsertTableCommandPayloadHeaders` = `IncludeHeaders`) | `insert_table` |
| `rich_text::DRAG_DROP_PASTE` | `DRAG_DROP_PASTE` | — | not ported (`File` payload; JS-only, ledger `js-by-design`) |

§1a.16/§1a.17 "the constant itself is view" is withdrawn for these seven. G-11:
`INSERT_CHECK_LIST_COMMAND` is now a Rust item, so S4's Tier C dispatch stands.

**G-6 (transformer lists): the order that is behaviour.** `Transformers::new` splits a list by type,
keeping list order within each type (`transformersByType`, `utils.ts:429`). Those per-type sequences
are what import, export and shortcuts iterate, so they are what the three order tests assert
(`macro_document_model::transformers::tests::{internal,external,all}_transformers_order_equals_ts`,
each against a literal list, plus the TS side recording the same names by object identity). Computed
under bun from the worktree at `72ae7f6d95` (identity-labelled, matches §4.2.1). Labels:
`HTF_EXP` = `HTML_TEXT_FORMAT_EXPORTER`; `HTF_U`/`HTF_SUP`/`HTF_SUB` = `HTML_TEXT_FORMAT_IMPORTERS[0..3]`;
`ENT[amp,nbsp,lt,gt,quot,copy,reg,trade]` = `HTML_ENTITY_TRANSFORMERS` in that order
(`utils/html-entities.ts:2-11`); `LII(..)` = that list's own `list_item_image(..)` instance;
`M_OL`/`M_CL`/`M_UL` = `MACRO_ORDERED_LIST`/`MACRO_CHECK_LIST`/`MACRO_UNORDERED_LIST`
(`customTransformers.ts:62-64`); `TF9` = `INLINE_CODE, BOLD_ITALIC_STAR, BOLD_ITALIC_UNDERSCORE, BOLD_STAR, BOLD_UNDERSCORE, HIGHLIGHT, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH`.

- **INTERNAL (63)**
  - element (22): I_DATABASE_QUERY_BLOCK, I_PASTE_NODE, PRESERVE_LINES, VIDEO_LINK, HR, I_VIDEO, I_IMAGE_CONSTRAINED, IMAGE, I_DOCUMENT_CARD, I_AGENT_SESSION_CARD, I_MAGIC_CHIP, I_AGENT_ACTIVITY, I_REPLY_TARGET_NODE, I_AGENT_CONTEXT, I_TABLE_NODE, I_MACRO_QUOTE, I_WATERMARK, HEADING, QUOTE, M_OL, M_CL, M_UL
  - multiline (3): HTML_BLOCKQUOTE, CODE, I_CURSOR_SYSTEM_NOTIFICATION
  - text-format (9): TF9
  - text-match (29): I_DATABASE_QUERY, I_SNAPSHOT_NODE, I_HTML_RENDER, LINK_XML, MARK_XML, SEARCH_MATCH, LII(I_IMAGE_CONSTRAINED, IMAGE), I_USER_MENTION, I_GROUP_MENTION, I_DOCUMENT_MENTION, I_PR_MENTION, I_BOOKING_LINK_MENTION, I_AGENT_SESSION_MENTION, I_CONTACT_MENTION, I_DATE_MENTION, I_AWAIT_NODE, I_EQUATION_NODE, I_THEME_MENTION, I_TAG_MENTION, I_CONNECT_APP, I_ACCOUNT_MANAGER_REQUEST, HTF_EXP, HTF_U, HTF_SUP, HTF_SUB, LINK, ESCAPED_AUTO_LINK, AUTO_LINK, UNKNOWN_MENTION
- **EXTERNAL (66)**
  - element (26): I_DATABASE_QUERY_BLOCK, HR, VIDEO_LINK, I_VIDEO, IMAGE, E_TABLE_NODE, E_USER_MENTION, E_GROUP_MENTION, E_PASTE_NODE, E_DOCUMENT_MENTION, I_DOCUMENT_CARD, E_DOCUMENT_CARD, E_PR_MENTION, E_BOOKING_LINK_MENTION, E_AGENT_SESSION_MENTION, E_CONTACT_MENTION, E_DATE_MENTION, E_REPLY_TARGET_NODE, E_TAG_MENTION, E_WATERMARK, E_SNAPSHOT_NODE, HEADING, QUOTE, M_OL, M_CL, M_UL
  - multiline (3): HTML_BLOCKQUOTE, E_MULTILINE_BLOCK_EQUATION_NODE, CODE
  - text-format (9): TF9
  - text-match (28): UNLINKED_TEXT, I_DATABASE_QUERY, MARK_XML, LII(IMAGE), BR_TAG_TO_LINE_BREAK, I_DOCUMENT_MENTION, I_PR_MENTION, I_BOOKING_LINK_MENTION, I_AGENT_SESSION_MENTION, I_CONNECT_APP, E_BLOCK_EQUATION_NODE, E_INLINE_EQUATION_NODE, ENT[amp, nbsp, lt, gt, quot, copy, reg, trade], HTF_EXP, HTF_U, HTF_SUP, HTF_SUB, LINK, ESCAPED_AUTO_LINK, AUTO_LINK, UNKNOWN_MENTION
- **ALL (89)**
  - element (36): I_DATABASE_QUERY_BLOCK, I_PASTE_NODE, E_PASTE_NODE, PRESERVE_LINES, VIDEO_LINK, HR, I_VIDEO, I_IMAGE_CONSTRAINED, IMAGE, I_TABLE_NODE, E_TABLE_NODE, E_SNAPSHOT_NODE, E_USER_MENTION, E_GROUP_MENTION, E_DOCUMENT_MENTION, I_DOCUMENT_CARD, E_DOCUMENT_CARD, I_AGENT_SESSION_CARD, E_AGENT_SESSION_MENTION, E_PR_MENTION, E_BOOKING_LINK_MENTION, E_CONTACT_MENTION, E_DATE_MENTION, I_MAGIC_CHIP, I_AGENT_ACTIVITY, I_REPLY_TARGET_NODE, I_AGENT_CONTEXT, I_MACRO_QUOTE, I_WATERMARK, E_WATERMARK, E_TAG_MENTION, HEADING, QUOTE, M_OL, M_CL, M_UL
  - multiline (4): HTML_BLOCKQUOTE, E_MULTILINE_BLOCK_EQUATION_NODE, CODE, I_CURSOR_SYSTEM_NOTIFICATION
  - text-format (9): TF9
  - text-match (40): I_DATABASE_QUERY, I_SNAPSHOT_NODE, I_HTML_RENDER, LINK_XML, MARK_XML, SEARCH_MATCH, LII(I_IMAGE_CONSTRAINED, IMAGE), BR_TAG_TO_LINE_BREAK, I_USER_MENTION, I_GROUP_MENTION, I_DOCUMENT_MENTION, I_PR_MENTION, I_BOOKING_LINK_MENTION, I_AGENT_SESSION_MENTION, I_CONTACT_MENTION, I_DATE_MENTION, I_AWAIT_NODE, I_EQUATION_NODE, I_THEME_MENTION, I_TAG_MENTION, I_CONNECT_APP, I_ACCOUNT_MANAGER_REQUEST, E_BLOCK_EQUATION_NODE, E_INLINE_EQUATION_NODE, ENT[amp, nbsp, lt, gt, quot, copy, reg, trade], HTF_EXP, HTF_U, HTF_SUP, HTF_SUB, LINK, ESCAPED_AUTO_LINK, AUTO_LINK, UNKNOWN_MENTION

Derived orders the same tests assert (identical for all three lists, because the text-format set is
the upstream nine):
- export element order = multiline ++ element (MD-EXP-02, `MarkdownExport.ts:46`); export text-match
  order = the text-match sequence above, skipping entries without `export`;
- export text-format order (MD-EXP-03: `format.length == 1`, stable sort, code-containing last):
  BOLD_STAR, BOLD_UNDERSCORE, HIGHLIGHT, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH, INLINE_CODE;
- import `format_by_tag` key order: `` ` ``, `***`, `___`, `**`, `__`, `==`, `*`, `_`, `~~`;
- shortcut index by last tag character (MD-SC-12): `` ` ``→[INLINE_CODE]; `*`→[BOLD_ITALIC_STAR, BOLD_STAR, ITALIC_STAR]; `_`→[BOLD_ITALIC_UNDERSCORE, BOLD_UNDERSCORE, ITALIC_UNDERSCORE]; `=`→[HIGHLIGHT]; `~`→[STRIKETHROUGH].

The private table lists of §4.2.1 (`internal_transformers_within_tables`, `external_transformers_within_tables`)
get `…_within_tables_order_equals_ts` tests the same way. §4.2.1's "CUSTOM_TRANSFORMERS: 20" holds:
`MACRO_ORDERED_LIST` is the Rust name of `customTransformer(ORDERED_LIST)` (`orderedListTransformer`).
For S4 §8.5 (S4 owns the edit): source files to add are `customTransformers.ts`, `index.ts` (the three
lists, by the tests above), `unknownFallback.ts`, `utils/html-entities.ts`, `utils/parsers.ts`,
`utils/quote-markdown.ts`, `utils/markdown-mentions.ts`, `utils/auto-link.ts` and the linkify-it port;
"fired" tracing per fixture replaces the "const appears in an API list" rule (G-6a).

**G-7 (Rust ports no upstream suite reaches).** S3 adds A-hand cases, one per P0/P1 symbol:
`hand::clipboard_gaps::{get_clipboard_data_from_selection, insert_data_transfer_for_rich_text, insert_data_transfer_for_plain_text, export_mime_type_from_selection, write_drag_source_to_data_transfer, handle_rich_text_drop}`,
`hand::overflow_gaps::{create_and_is_overflow_node, overflow_transform}`, `hand::text_gaps::root_text_content`.
The config-2 alias list itself is S4's.

**G-10 / T1a / T1b: every unmapped or not-ported package export, by name.** Ledger kinds:
`rust` (a Rust item), `js-by-design` (stays upstream JS on the web, cite this row), `n/a` (type-only
or React-only).

| Export(s) | Package | Ruling |
| --- | --- | --- |
| `$exportMimeTypeFromSelection` | clipboard | `rust`: `clipboard::export_mime_type_from_selection(view, mime: &str, selection) -> Result<Option<String>>`, one mime stack (CLP-22). Replaces "add if a caller appears" (§1d) |
| `$writeDragSourceToDataTransfer` | clipboard | `rust`: `clipboard::drag_source_payload(view, selection) -> ClipboardData` (model half; the JS glue writes the `DataTransfer`) |
| `GetClipboardDataConfig`, `ClipboardImportConfig`, `ClipboardImportOutput`, `ExportMimeTypeConfig`, `ExportMimeTypeFunction`, `ImportMimeTypeConfig`, `ImportMimeTypeFunction`, `ImportMimeTypePriority`, `LexicalClipboardData` | clipboard | `rust` as data: `clipboard::{ClipboardConfig { export: Vec<(MimeType, ExportMimeFn)>, import: Vec<(MimeType, ImportMimePriority, ImportMimeFn)> }, ClipboardData}` (`fn` pointers; the §1d MIME priority table is the default value); `ImportMimeTypePriority` = `ImportMimePriority(i32)` |
| `ClipboardImportExtension`, `GetClipboardDataExtension`, `ClipboardDOMImportExtension` | clipboard | `js-by-design`: extension wiring; Rust registration is `register_rich_text`/`register_plain_text` with `ClipboardConfig` (CLP-40, CLP-44: no extension → the static default, which is the Rust default) |
| `getDefaultCodeLanguage` | code-core | `rust`: `code::get_default_code_language()` (already §1c.1; row added) |
| `CodePrismConfig`, `Tokenizer` (prism, shiki), `CodeShikiExtension`, `ShikiTokenizer`, `CodeHighlighterShikiConfig`, `CodeHighlighterShikiExtension`, `CodeShikiConfig`, `PrismTokenizer`, `getCodeLanguages`, `isCodeLanguageLoaded`, `loadCodeLanguage`, `CodePrismExtension`, `$createCodeHighlightNode`, `CodeExtension`, `CodeImportExtension`, `CodeIndentExtension`, `registerCodeIndentation`, `CodeImportRules` | code-* | `js-by-design` (§0.2 decision 1, highlighting is view-only). G-11: `getCodeLanguages`'s test moves to the shim (`view_gaps.test.ts`) |
| `generateContent`, `registerLexicalCommandLogger` | devtools-core | `js-by-design` |
| all 32 `@lexical/extension` names of T1a (`LexicalBuilder`, `buildEditorFromExtensions`, `$getExtensionDependency`, `$getExtensionOutput`, `$getPeerDependency`, `getExtensionDependencyFromEditor`, `getPeerDependencyFromEditor(OrThrow)`, `getKnownTypesAndNodes`, `KnownTypesAndNodes`, `ClickAfterLastBlock*`, `InitialState*`, `NestedEditorExtension`, `EditorStateExtension`, `NodeSelectionExtension`, `NormalizeTripleClickSelection*` (R2.1: now has a Rust item, below), `NormalizeInlineElementsConfig`, `DecoratorTextExtension`, `$isDecoratorTextNode`, `SerializedDecoratorTextNode`, `HorizontalRuleExtension`, `SerializedHorizontalRuleNode`, `$defaultShouldInsertAfter`, `applyFormatToDom`, `ClearEditorConfig`, `ClearEditorExtension`, `registerClearEditor`, `TabIndentationConfig`, `CanIndentPredicate`) | extension | `js-by-design` (Tier B core config). Exceptions with a Rust item: (R2.1) `ClickAfterLastBlock*`, `$defaultShouldInsertAfter` → `click_after_last_block` (§1a.19); `NormalizeTripleClickSelection*` → `normalize_triple_click` (§1a.18); `registerClearEditor` → `rich_text::clear_editor` (XB-04); `CanIndentPredicate`/`TabIndentationConfig` → `tab::TabIndentConfig { max_indent: Option<u32>, can_indent: fn(StateRef<'_>, NodeKey) -> bool }` read by `tab::indent_with_limit` |
| `SerializedDocument`, `editorStateFromSerializedDocument`, `serializedDocumentFromEditorState` | file | `js-by-design` (Macro unused) |
| `HistoryExtension`, `SharedHistoryExtension`, `HistoryExtensionOutput`, `HistoryStateEntry`, `SharedHistoryConfig`, `registerHistory`, `createEmptyHistoryState`, `HistoryConfig` | history | S1-owned (§12); not an S3 item |
| `$setRenderContextValue`, `RenderContextRoot`, `contextValue`, `$getSessionDOMRenderConfig`, `$updateRenderContextValue`, `ContextPairOrUpdater`, `DOMOverrideOptions`, `DOMRenderConfig`, `DOMRenderExtensionOutput`, `DOMRenderMatch`, `DOMRenderMatchConfig`, `NodeMatch`, `RenderContextExport`, `RenderContextReader`, `contextUpdater` | html | `js-by-design`, added to §3.11 by name. `lexical_html` reproduces only `DEFAULT_EDITOR_DOM_CONFIG`'s export path (HREN-19) with `RenderContextExport = true` implied |
| `ChangeHandler` | link | removed (R2-53): plugin event `AutoLinkChanged` + `AUTO_LINK_CHANGED` (R2.1, S1 §14.5) |
| `registerPlainText`, `PlainTextExtension` | plain-text | `rust`: `plain_text::register_plain_text(b: EditorBuilder) -> EditorBuilder` (§1a.4b; row added); the extension is `js-by-design` (PT-16) |
| `InsertTableCommandPayloadHeaders` | table | `rust`: `table::IncludeHeaders` (G-5 table) |
| `$generateNodesFromDOM`, `$generateDOMFromRoot`, `$generateNodesFromDOMViaExtension`, `$getRenderContextValue`, `$withRenderContext`, `CoreImportExtension`, `DOMImportExtension`, `DOMRenderExtension`, `HorizontalRuleImportExtension`, `createRenderState`, `defineImportRule`, `defineOverlayRules`, `domOverride`, `parseSelector` | html | `js-by-design` (§3.11; HTML import is JS) |
| `DRAG_DROP_PASTE`, `RichTextImportExtension`, `RichTextImportRules` | rich-text | `js-by-design` |
| `registerTableSelectionObserver`, `TableImportExtension`, `TableImportRules`, `TableRowSchema`, `TableSchema`, `applyTableHandlers`, `$getTableAndElementByKey` | table | `js-by-design` (observer DOM half; §1b.12) |
| `LinkImportExtension`, `LinkImportRules`, `toggleLink`, `TOGGLE_LINK_COMMAND` | link | `toggleLink` → `rust` `link::toggle_link`; `TOGGLE_LINK_COMMAND` → `rust` (G-5); import names `js-by-design` |
| `CheckListExtension`, `ListImportExtension`, `ListImportRules`, `ListSchema`, `registerCheckList`, `insertList`, `removeList`, `REMOVE_LIST_COMMAND`, `UPDATE_LIST_START_COMMAND`, `INSERT_CHECK_LIST_COMMAND` | list | `insertList`/`removeList` → `rust` `list::{insert_list, remove_list}` (deprecated aliases, same fns); commands → `rust` (G-5); `registerCheckList`, extensions, import rules `js-by-design` |
| `NormalizeInlineElementsExtension`, `TabIndentationExtension` | extension | `js-by-design` (wiring); model halves in `tab` |
| `$isRootTextContentEmptyCurry`, `$canShowPlaceholderCurry` | text | `rust` via the non-curried fns `text::{is_root_text_content_empty, can_show_placeholder}`; the curried forms are `js-by-design` (closures) |
| `objectKlassEquals`, `ObjectKlass`, `$filter`, `$isEditorIsNestedEditor`, `makeStateWrapper`, `StateConfigWrapper` (UTL-28) | utils | `js-by-design` (`instanceof`/editor-object/JS-accessor helpers; Rust uses `Iterator::filter_map` and `StateKey` directly) |
| `copyToClipboard`, `applyFormatFromStyle`, `DecoratorTextNode`, `INSERT_HORIZONTAL_RULE_COMMAND`, `MarkExtension`, `OverflowExtension`, `$addNodeStyle`, `$isParentElementRTL`, `$moveCaretSelection`, `$moveCharacter`, `$getComputedStyleForElement`, `$getComputedStyleForParent`, `$isParentRTL` | various | `js-by-design` (DOM, extension wiring, or deprecated no-op `$addNodeStyle`, LSEL-02) |

**Unresolved items of audit R2-2 §5 owned by S3.**

| # | Ruling |
| --- | --- |
| 4 (Q13) | ai-editing-worker op helpers stay TypeScript until M4 (S7 row 114); M4's own spec owns any port. |
| 5 (Q14) | Ported now: `hashtag`, `text` (entity), `offset`, `tab` (model halves), `overflow` node + transform (§1a.14, `hand::overflow_gaps`). Stays upstream JS until M5: TabIndentation/Overflow extensions' wiring, the upstream React AutoLinkPlugin. |
| 6 | Closed in place (§4.1b): CR-1/CR-2. |
| 7 | Owner S4 §3.6 corpus; default: divergence kept with ledger entries and the two corpus scans (in place). |
| 8, 9, 10 | Relabelled in place: Q8 decided, Q21 resolved, `Selection::Table` decided. |
| 11 | `$exportMimeTypeFromSelection` is now a Rust item (table above). |
| 12 | Route map is a pointer table; owning sections are authoritative (in place). |

**Appendix B: package behaviour ids with no trace → Rust items.** Each Rust item gets a `/// s2: <ids>`
doc line (G-1c). `js` = no Rust item by design (VIEW/BRIDGE DOM half, or not-ported family);
`test` = behaviour is an absence or a quirk, pinned by the named test.

| S2 ids | Rust item / ruling |
| --- | --- |
| RT-18 | `rich_text::backspace_action` (R2-37 order) |
| RT-19 | `rich_text::delete_key_applies` |
| RT-24 | `clipboard::do_drop` returns `false` for non-Lexical drags; native drop then reaches CONTROLLED_TEXT_INSERTION (js) |
| RT-33 | `rich_text::escape_formats_for_trigger` (R2-08 slot), triggers `Space`/`Tab`, returns false |
| RT-34 | test `rich_text::register_rich_text_has_no_tab_indent` |
| RT-36 | `rich_text::move_to_start` |
| RT-42 | `heading::HeadingNode` `collapse_at_start` |
| RT-44, LNK-N-12, TBL-TBL-12, LST-NODE-10, HTML-00/01/03/07/10/11/13/14/15/18/20/26/27/28/29/30/60 | js (HTML import, §3.11) |
| RT-45 | `tab::indent_with_limit` (INDENT at CRITICAL, `max_indent`, `can_indent`); KEY_TAB routing js |
| PT-03, PT-04, PT-08 | `plain_text` reuse rows: `rich_text::remove_text`, `insert_line_break`, `plain_text::delete_key` (`DELETE_CHARACTER(false)` on Range) |
| PT-13 | `clipboard::insert_data_transfer_for_plain_text` (PASTE_TAG on the transaction); event filtering js |
| PT-16 | js (extension wiring) |
| LSEL-00 | §1c.3 mapping table (export list) |
| LSEL-02 | js (deprecated no-op) |
| LSEL-04, LSEL-51, LSEL-38 | js (DOM) |
| LSEL-11, LSEL-13, LSEL-15 | `selection::patch_style_text` (R2-08, R2-13) |
| LSEL-14, LSEL-16 | `selection::for_each_selected_text_node` |
| LSEL-17 | `selection::ensure_forward_range_selection` |
| LSEL-21 | `selection::is_at_node_end` |
| LSEL-32 | `selection::blocks::is_point_at_block_start` (private, used by `set_blocks_type`) |
| MD-ST-01/02/03 | `lexical_markdown::state::{LIST_MARKER_STATE, CODE_FENCE_STATE, HARD_LINE_BREAK_STATE}` |
| MD-QUOTE-02, -03 | `builtin::QUOTE` (`replace`, `export`) |
| MD-QUOTE-04, MD-CODE-09, MD-IMP-37, MD-FMT-10, MD-SC-19, MD-ARR-06 | test (quirk pins): `markdown::nested_quote_stays_literal`, `…::fence_indent_kept`, `…::nested_block_syntax_literal`, `…::underline_dropped_by_upstream_list`, `…::no_check_list_shortcut_by_default`, `…::check_list_after_unordered_becomes_bullet` |
| MD-LIST-08 | `builtin::list::get_indent` (with `MarkdownOptions::list_indent`) |
| MD-LIST-11 | `builtin::list::list_export` |
| MD-CODE-07 | `builtin::code::Code::replace` |
| MD-LINK-06 | `builtin::link::Link::replace` |
| MD-IMP-06, MD-IMP-09 | `import::import_blocks`, `import::normalize_tabs` |
| MD-IMP-11, MD-IMP-13 | `normalize::normalize_markdown` |
| MD-IMP-18 | `import::text::import_text_transformers` (code-span node reuse quirk) |
| MD-IMP-21 | `Transformers::new` (`format_by_tag`) + `import::text_format::find_outermost_text_format_transformer` |
| MD-IMP-25, -26, -27 | `import::text_format::{is_flanking, can_emphasis}` (`intraword` not read on import) |
| MD-IMP-29, -32, -33 | `import::text_format::process_emphasis` |
| MD-IMP-34 | `import::text_format::find_outermost_text_format_transformer` |
| MD-IMP-36 | `util::unescape_text` (after transforms, per node) |
| MD-EXP-02 | `export::export_top_level_elements` |
| MD-EXP-03 | `Transformers::new` (`export_text_format`) |
| MD-EXP-07, -08, -10, -12, -13, -14, -15 | `export::export_text_format` |
| MD-SC-03, -04 | `shortcuts::ShortcutTrigger::from_commit`, `markdown_shortcut_anchor` |
| MD-SC-07 | `shortcuts::markdown_shortcuts` (HISTORY_PUSH tag) |
| MD-SC-08 | `shortcuts::run_element_transformers` |
| MD-SC-12, -13, -14, -15 | `shortcuts::run_text_format_transformers` |
| MD-SC-17 | `shortcuts::markdown_shortcuts_on_enter` |
| LNK-N-03 | `link::node` getters/setters (`url`, `target`, `rel`, `title`) |
| LNK-TR-01..04 | `link::transform::link_node_transform` |
| LNK-TG-03, -04, -06, -09 | `link::toggle::toggle_link` |
| LNK-TG-08 | `link::toggle::split_link_at_selection` |
| LNK-AL-02 | `link::auto::find_first_match` |
| LNK-AL-03 | `link::auto::AutoLinkConfig` default separator + `is_separator` |
| LNK-AL-04 | `link::auto::is_content_around_is_valid` (`is_previous_node_valid`, `is_next_node_valid`) |
| LNK-AL-05 | test `link::auto::no_punctuation_trimming` |
| LNK-AL-06 | `link::auto::auto_link_text_transform` (`exclude_parents`) |
| LNK-AL-07 | `link::auto::get_text_nodes_to_match` |
| LNK-AL-11 | `link::auto::handle_bad_neighbors` |
| LNK-AL-12 | `link::auto::replace_with_children` |
| LNK-AL-13 | `link::auto::toggle_auto_link_unlinked` |
| LNK-AL-15 | js (React) |
| HT-03, -05, -07 | `hashtag::get_hashtag_match` (character tables verbatim, Thai range kept) |
| TXT-01 | `text::register_lexical_text_entity` |
| TXT-02, -04, -05 | `text::text_entity_text_transform` (TXT-04 quirk pinned by `text::null_combined_match_stops`) |
| OFF-04 | `offset::create_offset_view` (quirk pinned by `offset::inline_element_adds_block_size`) |
| TBL-CELL-4 | `table::TableCellNode::{has_header_state, has_header}` |
| TBL-MAP-2 | `table::compute_table_map` |
| TBL-NORM-1 | `table::table_cell_transform` |
| TBL-NORM-4 | `table::table_transform` (col widths repair) |
| TBL-PLG-4 | `table::select_all_in_table` |
| TBL-EXT-2 | `table::register_table` flags (static at build in Rust; re-registration on flag change is js) |
| TBL-PTR-5 | `table::fix_range_selection_for_tables` |
| TBL-PTR-1, -2, -3, -6, -7, TBL-KEY-3 | js (pointer/DOM); model halves already mapped in §1b.10 |
| TBL-KEY-15 | `table::controlled_text_insertion_in_table` |
| TBL-KEY-16 | `table::insert_paragraph_at_table_edge` |
| LST-INS-2 | `list::insert_list` (empty-item branch, AMBIGUOUS pinned by S4 §1.8c) |
| LST-IND-4 | test `list::item_indent_unused_while_attached` |
| LST-CHK-5 | js (focus mode); `list::check_list_item_at_caret_start` is the model predicate |
| CODE-KEY-1 | `code::is_selection_in_code` |
| CODE-KEY-3 | `code::handle_key_tab` |
| CODE-KEY-7 | `code::handle_arrow` (Alt+Up/Down line move) |
| CODE-KEY-11 | test `code::shift_enter_and_backspace_use_core` |
| CODE-PR-5, CODE-SH-7 | js (highlighting is view-only) |
| CLP-22 | `clipboard::export_mime_type_from_selection` |
| CLP-40, CLP-44, CLP-46 | js (DOM import) / `clipboard::ClipboardConfig::default()` (CLP-44) / test `clipboard::multiline_plain_text_is_paragraphs` (CLP-46) |
| HTML-48 | `lexical_html::walk` (`$appendNodesToHTML` hoist) |
| HTML-50 | js (dev warning) |
| HREN-02, -05, -09, -12, -13, -14, -18 | js (render context, G-10) |
| HREN-19 | `lexical_html::DefaultDomRenderConfig` |
| HDL-03 | js |
| UTL-01 | §1c.4 mapping (re-exports point at S1 items) |
| UTL-28 | js (`makeStateWrapper`) |

### R2.3 Core change requests (S1 owner applies; S3 depends on them)

| Id | Requirement | From |
| --- | --- | --- |
| CR-23 | (restated R2.1 to S1 §14.2) `Plugin::after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error>` (default `Ok(())`). After a non-no-op commit, **one follow-up transaction per round, shared by every plugin**: plugins run in registration order, once per commit of the chain, oldest first; tags merge; nothing flushes between them. A no-op follow-up is dropped and ends the rounds; otherwise it goes to `Commit::following` and the next round runs on it. More than 99 rounds stop with `Error::EndlessFollowUps` in `Commit::follow_up_error` (an `Err` from a body rolls that follow-up back, recorded the same way). History records the main commit, then each follow-up. Run by `Editor::update`/`try_update`/`dispatch`/`set_editor_state`, `Editor::run_after_commit`, `EditorCore::apply` (follow-ups in `Output::commits`) and `build()` (synthetic all-Created commit when `initial_state` is set; `Editor::take_initial_commits`/`EditorCore::take_initial_output`). No `CommitHook` | R2-48, R2-4 H5, S1 R2.1 |
| CR-24 | `Error::Invariant(Cow<'static, str>)` and `invariant!(fmt, args…)` (replaces CR-22's `&'static str`) | R2-44 |
| CR-25 | `TableSelection: Copy`; `Selection::as_table()`/`is_table()` | R2-52 |
| CR-26 | `Command::InsertClipboardNodes { nodes: Vec<NodeKey>, selection: SelectionSlot }` | R2-07 |
| CR-27 | `Transaction::select_all(&mut self, expand: Option<SelectionSlot>)` with R2-19's semantics | R2-19 |
| CR-28 | `NodeType::HAS_LANGUAGE_FIELD` (registry ORs along `Parent`), `Read::has_language_field(key)`, used by `insert_nodes` CASE 1 | R2-20 |
| CR-29 | `delete_word`/`delete_line` take `target` and `character_target` | R2-21 |
| CR-30 | `_at` slot setters (`set_selection_style_at`, `toggle_selection_format_at`, `anchor_at`, `focus_at`), `Arc<str>` selection style | R2-54, R2-57, R2-08 |
| CR-31 | Every `ExtensionState` type and erased trait object is `Send + Sync`; S3's `NodeIdState`, `PeerIdState`, `AutoLinkConfig`, `TabIndentConfig`, `ClipboardConfig`, `NodeClock` comply | R2-41 |

### R2.4 Audit R2-4 (implementability), S3 items

| ID | Sev | Resolution |
| --- | --- | --- |
| B3 | Blocker | Accepted, preferred fix, in place (§0.1, §4.4). New server-side crate `crates/macro_document_composers` (flat, not `crates/client/`; depends on `macro_document_model`, `trigger_context`, `bot_id`, `chrono`; normal hakari member). It holds `composers/*` and `composers/wire.rs`; `macro_document_model` has **no default features and never depends on `trigger_context`**. Callers (all route group 4, agent crates) depend on `macro_document_composers`. Features of `macro_document_model`: `html` only. Client crates may depend on it with plain `workspace = true`. CI assertion added to §6.6. S7's `document_session` needs no `default-features = false`. |
| B4 | Blocker | Accepted, option (a). New spec **S13** (`S13-types-crates.md`) specifies `lexical_node_id` and `document_id` (flat now, `crates/types/` after reorg phase 3; nutype with a fixed fallback; stored formats; dependants). §4.3.1 uses `LexicalNodeId` per S13 §1.3: `NODE_ID` stays `StateKey<Option<String>>` (stored bytes, `""` round-trips), `get_id -> Option<LexicalNodeId>`, `set_id(.., LexicalNodeId)`, `assert_id`/`regen_id -> LexicalNodeId`, `NodeIdMappings` keyed by `LexicalNodeId`; `NANOID_ALPHABET`/length consts re-exported from `lexical_node_id`. Node data fields holding document ids stay `String` with typed `Option<DocumentId>` accessors. M1 does not wait on the reorg: WP-25 creates both crates (R2.1: WORKPLAN numbering; WP-23 is the markdown transformers). |
| H1 | High | Accepted, in place: row 8 → `comment_gate::is_comment_only_root_change` (sync-service calls the root variant: the wire carries `{before:{root}, after:{root}}`); row 10 → `macro_document_model::snapshot::markdown_to_loro_snapshot`; row 12 → `macro_document_model::html::markdown_to_html`. `lexical_loro` depends only on `lexical_model` + `loro`. Crate-graph question: **`macro_document_model` depends on `lexical_loro`** (non-optional; the snapshot fns call `lexical_loro::snapshot`), stated in §0.1. |
| H2 | High | Accepted, coordinated with S6 (S6 not edited here). The gate's Rust implementation is `macro_document_model::comment_gate` (§4.3.3). S6's `CommentGate` port keeps calling lexical-service over HTTP (S6 §2.3, "unchanged in this pass") until the flip. The flip (route group 3) lands after S6 C9 and C16: `sync_server_core` gains `InProcessCommentGate` behind feature `in-process-gate` (one impl; `sync_sim` uses the same type, so S8 needs no second copy, CS-26). It converts `RootChange` to the two root `Value`s and calls `is_comment_only_root_change`; `Err` → refuse; no timeout (the 4.5 s timeout stays on the HTTP adapter). Selection: Worker var `COMMENT_GATE_MODE = "http" \| "in_process"` in every `[env.*.vars]` block and `wrangler.docker.toml`, read once at startup; a missing value fails startup. Flip gate: S8 §13 parity test green plus shadow (`lexical.shadow` route `gate`) clean in dev. Then delete `outbound/lexical_service.rs` and `LEXICAL_SERVICE_URL`/`LEXICAL_SERVICE_AUTH_KEY`. No edit to `socket/protocol.rs` (S6 deletes it). Sync-service citations in S3 refer to S6 inventory ids (M10) rather than line numbers (M9). |
| H4 | High | Decision: **Rust and web both on loro 1.16.2.** crates.io has no `loro` 1.16.3 (the index goes 1.16.2 → 1.17.0), so "bump Rust to the catalog" is impossible; S6/S7 already cite 1.16.2 source. WP-00: root `Cargo.toml` `loro = "=1.16.2"`; root `package.json` catalog `loro-crdt` `1.16.2` (exact); `services/sync-service/package.json` `loro-crdt` from `^1.13.7` to the catalog. If WP-00 finds a fix in the `loro-crdt` 1.16.3 changelog that Macro needs, both move together to the first version published on both registries (1.17.x) in one PR instead. Mixed-version check (S8 §7.2 TS peers on the catalog version; Rust snapshots import in that `loro-crdt`) stays. |
| H5 | High | CR-23. |
| H8 (`record_timestamp`) | High | §4.3.6's `raw_state_to_loro_snapshot` keeps `set_record_timestamp(true)` (JS parity for server-created snapshots, byte-identical to `markdown-loro-snapshot.ts`). S7 D-4(a) binds `doc_sync_core`/`document_session` only. Doc comment on the fn says so. |
| M2 | Medium | Accepted, in place: `vendor/regress` with `README-MACRO.md`; the `regex_icase_v8` test lives in `lexical_markdown`. |
| M3 | Medium | `crates/client/lexical/*` crates need no hakari entry (`traversal-exclude-globs = ["crates/client/*"]` is a prefix match). Flat crates need entries: `lexical_node_id`, `document_id` (S13 §0). `macro_document_composers` is a normal member. Layer check: §6.6. |
| M5 | Medium | Each S3 crate's `AGENTS.md` Checks block: `cargo test -p <crate>`; `cargo test -p <crate> --all-features`; `cargo check -p <crate> --target wasm32-unknown-unknown` (every crate except `macro_document_composers`); `cargo clippy -p <crate> --all-targets --all-features`; `cargo x deps --check`; `cargo shear`; `just check`. |
| M6 | Medium | S3 routes: in-process `lexical.<route>` spans are children of the caller's request span; `spawn_blocking` work enters `Span::current()` captured before the spawn (`.in_scope`); fields `route`, `bytes_in`, `bytes_out`, `document_id` where the route has one, `outcome`, and `error.kind` on `Err` (gate: `gate.comment_only` bool, `error.kind` on refuse-by-error). No content. Acceptance per flip group: the trace is found in local Tempo (`live-debug`). Web spans are S7's. |
| M8 | Medium | Until M3, a node change lands in TS (`packages/lexical-core/nodes`) and Rust (`macro_document_model`) together; `.agents/rules/web/lexical-nodes.md` gains that rule and the S4 §3.6b per-node generator plus `just lexical-fixtures --check` is a required check on `packages/lexical-core/nodes/**`. Applied by WP-25 (rule file edit is a repo change, not a spec change). |
| M9 | Medium | Accepted for S3: sync-service references use S6 ids (M10 gate, H6 document id). |
| L3 | Low | `NodeIdMappings` uses `std::collections::HashMap`; iteration never reaches output. D-3's ast-grep rule is scoped to `doc_sync_core`/`document_session` and does not cover `macro_document_model`; a doc comment on `NodeIdMappings` says why. |

## R2.1 consistency

Final pass, part B: S1 R2.1's "Changes other specs must make" (S3 group) and the remaining "S3
follows" items of S1's R2 tables, applied. S1 is unchanged. Body text edited in this pass carries
`(R2.1)` or an R2 id; where it and the R2 resolutions disagree, this section and the body win.

| Item | Change |
| --- | --- |
| Kind-trait impl shape (R2-15, R2-38) | §0.3 CR-1, CR-2, CR-5, CR-18 status cells and the §1a.0 CR bullets and hook-signature list now place `Parent`, `as_parent*`, the mutator hooks (`remove`, `replace`, `insert_after`, `insert_before`), `reset_on_copy`, `create_parent_element`, `is_parent_required`, `adjust_export_json` and `json_version` in the kind-trait impl (`common_node_hooks!`), not `NodeType`; §4.1b open item 1 likewise. CR-22 status notes CR-24 |
| CR-23 | Restated to S1 §14.2: one follow-up per round shared by every plugin, registration order, tags merge, rounds until a no-op, 99-round guard (`EndlessFollowUps` in `Commit::follow_up_error`), History records main then follow-ups; initial pass at `build()` handed over by `take_initial_commits`/`take_initial_output`. R2-48's row points at it |
| NodeId/PeerId plugins (§4.3.1, §4.3.2) | Stale free `after_commit(editor, commit) -> Result<Option<Commit>>` signatures replaced by `impl Plugin` (`name`, `commands`, `handle`, `after_commit(&self, tx, commit)`); NodeId has no commands. Both write into the round's shared follow-up; PeerId tags it `local-status`. `register` adds the plugin; the initial pass runs at `build()` with `initial_state`. No `CommitHook` |
| S11 §5.1/§5.5 | PeerId `after_commit` carries the `from-loro` remote rule; `SET_LOCAL_PEER: CommandKey<SetLocalPeer>` is PeerId's extension command. New §4.3.7: `MacroSyncPolicy` (`SyncPolicy` impl), `synced_json` (strips `$.local`, drops `completion`, draft marks transparent, **keeps `sharedPeerIds`**, matching TS `loroSyncState`, which syncs every other `$` key), `LIFT_DRAFT_COMMENT_MARKS`/`RESTORE_DRAFT_COMMENT_MARKS`; module `sync.rs` in the §4 layout |
| `default_node` / `flag_probe` / `FLAGS_PER_INSTANCE` (S1 §3.2 R2.1) | Rule added to §1a.0. Audit below |
| `HAS_LANGUAGE_FIELD` | Noted on CodeNode's §1c.1.2 sketch (R2-20 already decided it) |
| Slot-taking helpers | Body signatures now match R2-07/R2-08/R2-36: `patch_style_text(tx, SelectionSlot, ..)`, `escape_formats_for_trigger(tx, SelectionSlot, ..)`, `insert_generated_nodes(tx, nodes, SelectionSlot)`, `insert_clipboard_nodes_in_table(tx, nodes, SelectionSlot, ..)`, `trim_text_content_from_anchor(tx, SelectionSlot, usize)`; SELECT_ALL row reads `select_all(None)`; rich- and plain-text `delete_word`/`delete_line` take `direction, target, character_target` |
| Autolink (R2-53 superseded) | `ChangeHandler`/`change_handlers` removed from the §1a.12 sketch; the transform emits `AutoLinkChanged { url, prev_url }` with `tx.emit(&AUTO_LINK_CHANGED, ..)` (S1 §14.5). `AutoLinkChanges` extension state dropped (R2-53 row, CR-31, mapping row). `ExcludeParent` is the `fn(StateRef<'_>, NodeKey) -> bool` pointer |
| Package `Error` enums (R2-45) | §1a.0 `Result<T>` sentence now says each crate's `Error` wraps `lexical_model::Error` |
| `TableSelectionExt` (R2-47, R2-52) | §1b.5 trait takes `self` by value and `StateRef<'_>` |
| `StateRef` in callbacks, `CopyDestination` | Already applied in R2 (R2-47, R2-46); no change |
| `ClipboardPayload::html_nodes` | §1d `insert_data_transfer_for_rich_text` and `do_drop` take `html_nodes: Option<&[SerializedNode]>` instead of a JS `html_import` callback |
| New plugins (S1 §14.4) | §1a.18 `normalize_triple_click` (SELECTION_CHANGE at `Critical`/`Before`, `fix_focus_overselection` when `selection_change_context().triple_click`), §1a.19 `click_after_last_block` (`default_should_insert_after`, `ClickAfterLastBlockConfig`, `INSERT_AFTER_LAST_BLOCK`); §1a.1 layout; §1a.17 and the T1a `@lexical/extension` row list them as exceptions with a Rust item |
| Platform branches | §1a.4: handlers with `IS_IOS`/`IS_ANDROID`/`IS_APPLE` branches, and Macro's `native-ios-backspace` and `word-navigation` ports, read `tx.view_host()` (`ViewHost { engine, os }`, `ViewEngine::Native` on native views) |
| Table observer | §1b.8: model handlers read whichever `Selection::Table` is installed, including one the view sent as `ViewSelection::Table` (S1 §9.2) |
| `export_node` → `export_json` | §4.3.4 `to_search_text` `rawContent` uses `Read::export_json` (S1 R2.1: `exportJSON()` with `children: []`); the R1 note on `export_json_shallow` is historical |
| Loro | Unchanged: Rust `loro` and catalog `loro-crdt` both `=1.16.2` (H4); nothing says the catalog stays 1.16.3 |
| Stale-identifier grep | No `CommitHook`, `commit_hook`, `commit_with_hooks`, `ViewPlatform`, `CoreConfig.platform`, `MergeActionGetter`, `has_current`, `lexical_model` `wire` feature or `Option<Transaction>` remains in S3 (`wire` hits are the composers' `wire.rs`). S2 §3D references are already `LSEL-nn` (R2.2 G-2) |

**Type-table flag audit (S12 Q3).** Every `is_inline`, `can_insert_text_before`/`after`,
`is_keyboard_selectable`, `is_isolated` and `is_shadow_root` override in §1a–§1d and §4.1a/§4.1b was
checked against the TS sources (`packages/lexical-core/nodes/*.ts`, upstream `packages/lexical-*/src`).
All return constants except three Macro decorators, which set `FLAGS_PER_INSTANCE = true`. Their
state is already a serialized prop, so the view's mirror answers:

| Type | Instance-dependent answer | Prop |
| --- | --- | --- |
| `AgentSessionMentionNode` | `is_inline = !expanded` (`AgentSessionMentionNode.ts:57`) | `expanded` (exported only when true) |
| `AwaitNode` | `is_inline = inline` (`AwaitNode.ts:80`) | `inline` |
| `DatabaseQueryNode` | `is_inline = displayMode == "scalar"` (`DatabaseQueryNode.ts:83`) | `displayMode` |

No upstream package type the port registers has an instance-dependent flag (the only one,
playground `EquationNode.isInline`, is not ported). Every other type: `impl_default_node!()` when
`$createX` takes no required argument (built-ins, Heading, Quote, List, ListItem, Link, AutoLink,
Hashtag, Overflow, Table, TableRow, TableCell, Code, CodeHighlight, Mark, and Macro's
`AwaitNode`, `DiffDeleteNode`, `HorizontalRuleNode`, `InlineSearchNode`, `UnlinkedTextNode`),
else a `flag_probe` with a minimal valid instance (the other Macro nodes, whose `$createX` takes a
params object). `BuildError::NoFlagProbe` makes a miss loud at the first `build()`, and the S1 §8.5
debug check catches a type whose answers vary but that lacks `FLAGS_PER_INSTANCE`. WP-25/WP-26
confirm the per-node choice. (`AwaitNode` has both a default and `FLAGS_PER_INSTANCE`; the latter
wins, S1 §3.2.)
