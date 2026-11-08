# S1: `lexical_model` API spec

Revision: R2.1 (audit rounds 1 and 2 resolved; every finding has a row in "R1 resolutions" or
"R2 resolutions" at the end. R2.1 folds in what S3, S4, S11 and S12 require of `lexical_model`;
"R2.1 consistency" at the end lists each change. Where an R1 row and an R2 or R2.1 row disagree,
the later row and the body text win).

Target: Lexical v0.45.0 (`target/lexical-upstream/packages/lexical/src`, plus
`packages/lexical-history/src/index.ts`). Crate: `crates/client/lexical/lexical_model/`.
Inputs: `SCOPE.md`, `notes-api.md`, `notes-core.md`, `notes-conformance.md`,
`repo-reorg-plan.md`, `CODING.md`, `.agents/rules/rust/*.md`.

This is the document implementers code against. Every public item has a full signature.
Paths like `LexicalSelection.ts:1754` point at the upstream code each item ports. Read
that code before implementing the item: the algorithm is upstream's, and only the shape
changes.

Decisions already made, not reopened here:
- Port the semantics of web Lexical faithfully, behind an idiomatic Rust API.
- No thread-local globals, no stored callbacks, no `Rc<RefCell>`.
- `Transaction` is a value: dropping it rolls back, `commit()` returns a `Commit`.
- `NodeKey` is a Copy, generational handle.
- The node map is persistent, with clone-on-first-write.
- Node types are serde structs plus traits whose defaults are upstream's.
- There are four base kinds: Element, Text, Decorator, LineBreak.
- Transforms are plain `fn` items registered at build time, run with upstream's fixpoint
  algorithm.
- There are no listeners: `Commit` carries prev, next, changes, tags and normalized keys.
- Commands are a typed `Command` enum, extended through a build-time `Plugin` trait.
- Errors are `Result`s. All offsets are UTF-16 (`Utf16Offset`).
- `EditorCore::apply(Input) -> Output { commit, diff, effects }` is sans-IO and contains
  no Loro. Remote changes arrive as `Input::ApplyRemote(Vec<NodeChange>)`.

---

## 0. Conventions

- Edition 2024. The workspace toolchain is 1.94.0 (`rust-toolchain.toml`), which covers
  const references to statics (`REQUIRED_STATE`, 1.83). A supertrait bound that names the
  trait being defined on an associated type (`trait ElementNode: NodeType<Parent:
  ElementNode>`) is **not** supported: it fails with E0391 (cycle computing implied
  predicates), so inheritance lives on each kind trait (§3.2). Every trait and lifetime
  shape in §3.2, §4.2, §5.2, §6 and §14.2 was compiled with rustc 1.94.0 in the probe crate
  `target/lexical-upstream-port/probe` (`cargo test` and `cargo check --target
  wasm32-unknown-unknown`).
- Thread safety (R2-41). `Editor`, `EditorState`, `EditorCore`, `Commit`, `Diff`,
  `Registry`, `Selection`, `Command`, `Input` and `Output` are `Send + Sync`. Every erased
  trait has `Send + Sync + 'static` supertraits (`AnyNodeData`, `AnyStateValue` (+ `Debug`),
  `AnyStateKey`, `AnyCommandKey` (+ `Debug`), `Plugin`, `TableSelectionHooks`). `lib.rs`
  holds a compile-time assertion
  (`const _: () = { const fn assert<T: Send + Sync>() {} assert::<Editor>(); … };`) for each
  of those types. Nothing uses `Rc`, `RefCell` or `Cell`.
- Platform safety (wasm32 and native mobile, audit R2-4). The crate builds for
  `wasm32-unknown-unknown` with no JS host (no `wasm-bindgen`, no `js-sys`, no `getrandom`),
  and for the iOS and Android native targets used by `document_session_ffi`. It never reads a
  clock (`HistoryTime` is passed in), never uses randomness (no `RandomState`: every hash map
  uses `FxHasher`; seeds come through ExtensionState), never spawns threads, never touches
  `std::fs`, `std::env` or `std::net`, and never panics on input (CS-57). `SharedKeyCounter`
  uses `AtomicU64`, which every target in the matrix supports. CI runs `cargo check -p
  lexical_model --target wasm32-unknown-unknown` and `--target aarch64-apple-ios`.
- Observability. The crate is sans-IO and emits no spans and no logs, and it depends on no
  telemetry crate. Callers (S7 `edit.apply`, S3 `lexical.<route>`) record what they need from
  `Commit` (dirty-set sizes, `Changes::mutations.len()`, `Diff::ops.len()`, and
  `WorkCounters` under `bench-counters`) as span fields, per `.agents/rules/observability.md`.
- Behaviour traceability (audit R2-2 G-1). Every Rust item that implements an S2 §3 behaviour
  carries a doc line `/// s2: NRM-03, NRM-04`, and `lexical-coverage` fails on a MODEL or
  BRIDGE id with no `s2:` owner. Each section below starts with an "S2:" line that lists the
  ids it owns. `SEL-nn` always means S2 §3A (core selection); the `@lexical/selection` items
  of S2 §3D are `LSEL-nn` (audit R2-2 G-2, renamed in S2) and belong to S3.
- `#![deny(missing_docs)]` (CS-54). Public errors use `thiserror` (CS-56). No `unwrap`,
  `expect`, `panic!`, `unreachable!` or unchecked indexing on any path an input can reach
  (CS-57). Every upstream `invariant(false, …)` becomes an `Err(Error::…)` (§16).
- Every closed string set is an enum with strum derives whose `serialize_all` matches
  serde (CS-11, CS-59). Every id is a newtype (CS-10). Absence is `Option` (CS-12).
- Generic parameters get descriptive names (`Node`, `Value`, `Parent`), never single
  letters.
- Library crate rules: wasm32-safe and mobile-safe. No tokio, reqwest, axum, sqlx, aws or
  rdkafka. Excluded from hakari. Dependencies come only from `[workspace.dependencies]`.
- Upstream `$verb()` (active-editor global) maps three ways: to a method on
  `Transaction` for writes, to a method on `StateRef` (or the `Read` trait) for reads, or
  to a free function taking one of those.
- Tests live in sibling `test.rs` files (CS-49).

Checks for this crate (audit R2-4 M5; also the `AGENTS.md` "Checks" block of
`crates/client/lexical/lexical_model`): `cargo test -p lexical_model`; `cargo test -p
lexical_model --features bench-counters,model-segmentation`; `cargo check -p lexical_model
--target wasm32-unknown-unknown`; `cargo clippy -p lexical_model --all-targets`; `cargo x deps
--check`; `cargo shear`; `just check`. The crate sits under `crates/client/*`, whose hakari
`traversal-exclude-globs` entry is a prefix match, so it needs no per-crate hakari entry.

### Dependencies

Versions are pinned here (audit R2-4 M1, checked against crates.io and the workspace
`Cargo.lock` on 2026-11-07). Crates not yet in `[workspace.dependencies]` are added there with
`default-features = false` and the listed features. `rpds` and `im` are not used.

| Crate | Version | Use | Notes |
| --- | --- | --- | --- |
| `imbl` | 7.0.2 (new; MPL-2.0) | `imbl::HashMap<NodeKey, Arc<NodeSlot>, BuildHasherDefault<FxHasher>>` persistent node map | O(1) snapshot clone, O(log₃₂ n) writes. The hasher is fixed so nothing is per-process random; HAMT order is still never exposed (§5.2). No `serde`/`rayon` features |
| `rustc-hash` | 2.1 (new; lock has 2.1.2) | `FxHasher` for the node map and crate-private maps | deterministic hashing |
| `smallvec` | 1.15 (new; lock has 1.15.1) | detached selection slots (§7.6), `Output::commits` (§15) | feature `const_generics` |
| `indexmap` | 2 (workspace) | `IndexSet`/`IndexMap` for dirty sets, NodeSelection, state order | JS `Set`/`Map` iterate in insertion order; transforms depend on it |
| `serde` | 1 (workspace, `derive`) | node payloads | |
| `serde_json` | 1 (workspace) + crate feature `preserve_order` | JSON import/export | key order is part of the format (§13). Enabling `preserve_order` here unifies it for every binary that also links `serde_json` elsewhere (lexical-service, sync-service): harmless, but object key order in those binaries' other JSON becomes insertion order. WP-00 checks that no server snapshot test depends on sorted keys |
| `thiserror` | 2 (workspace) | `Error`, `BuildError` | |
| `bitflags` | 2.11 (new; lock has 2.11.1) | `TextFormat`, `TextDetail`, `AbsentKeys` | |
| `strum` | 0.27 (workspace, `derive`) | enum string forms | |
| `nom` | 8 (workspace) | CSS declaration parser (`style::parse_css_declarations`) | CS-58 |
| `unicode-segmentation` | 1.13 (workspace has `1.9.0` as the floor) | `ModifyTarget::ModelSegmentation` | optional, feature `model-segmentation`, off by default (Q10) |
| dev: `proptest` | 1.11 (workspace) | property tests | |
| dev: `insta` | 1.48 (new to the workspace table; already in the lock) | snapshot tests of `export_node` output | |

Features: `model-segmentation` (above), `foreign-nodes` (dev-only runtime node types for the
Tier B shim, §4.4; never enabled by a shipping crate) and `bench-counters`. `bench-counters` adds
`Commit::work: WorkCounters { nodes_visited, nodes_cloned, diff_ops, bytes_allocated }`,
filled by the pipeline, so perf gates can assert "zero growth with document size" on
deterministic counts instead of µs timings (audit D-F6). Off in production builds.

No `regress` in this crate: there are no regexes in the core. `getTextDirection` uses
explicit code-point range tables (§2.6).

---

## 1. Module layout

```
lexical_model/src/
├── lib.rs                 re-exports below; #![deny(missing_docs)]
├── key.rs                 NodeKey, KeyParts, Id<Node>, KeySource, SharedKeyCounter, KeyAllocator (crate-private)
├── offset.rs              Utf16Offset, ChildIndex, TextBuffer, text_from_utf16
├── format.rs              TextFormat, TextFormatType, ElementFormat, TextDirection,
│                          TextMode, TextDetail, TextDetailType, CopyDestination
├── style.rs               parse_css_declarations (getStyleObjectFromCSS)
├── node/
│   ├── mod.rs             NodeSlot (record), NodeKind, BaseData, NodeRef, Links
│   ├── element.rs         ElementData, ElementNode, ElementBase, ElementView
│   ├── text.rs            TextData, TextNode, TextBase, TextView, SpliceText
│   ├── decorator.rs       DecoratorNode, DecoratorBase, DecoratorView
│   ├── line_break.rs      LineBreakNode, LineBreakBase, LineBreak
│   ├── node_type.rs       NodeType, kind markers, KindOf (sealed), ParentOf, NodeView,
│   │                      common_node_hooks! (crate-private),
│   │                      element_node_base! / text_node_base! / decorator_node_base! macros
│   ├── foreign.rs         ForeignNodeType, ForeignHooks, ForeignData, PendingUpdate,
│   │                      ForeignListener, ForeignTransform, ForeignStateConfig (feature `foreign-nodes`)
│   └── builtin.rs         Root, Paragraph, Text, Tab, Artificial
├── registry.rs            Registry, RegisteredNode, NodeTypeIndex, NodeVTable (private),
│                          trait projections (node_trait), TypeFlags, TypeTableRow
├── editor.rs              Editor, EditorBuilder, EditorMode
├── state.rs               EditorState, StateRef, Read
├── read/
│   ├── traverse.rs        Children, Ancestors, Descendants, Siblings iterators
│   └── text_content.rs    text content (cached)
├── node_state.rs          StateKey<Value>, StateValue, RequiredState, NodeState
├── transaction/
│   ├── mod.rs             Transaction, UpdateOptions, FlushMode, NestedUpdateFn
│   ├── create.rs          create, create_with, create_text, copy_node, import_node
│   ├── tree.rs            append, splice, insert_after/before, remove, replace, clear, split_node
│   ├── element_mut.rs     ElementMut
│   ├── text_mut.rs        TextMut (split_text, merge_with_sibling, splice_text, …)
│   ├── node_mut.rs        NodeMut<Node>
│   └── dirty.rs           DirtySet (crate-private)
├── pipeline/
│   ├── transforms.rs      TransformFn, fixpoint loop
│   ├── normalize.rs       normalize_text_node, normalize_range_selection
│   ├── gc.rs              detached-node GC
│   └── model_caches.rs    element text_format/text_style, text-size caches
├── selection/
│   ├── mod.rs             Selection, RangeSelection, NodeSelection, TableSelection,
│   │                      TableSelectionHooks, Point, PointType, PointRole, ViewSelection
│   ├── slot.rs            SelectionSlot, DetachedSelectionId, detached slot table
│   ├── insert.rs          insert_text, insert_nodes, insert_paragraph, insert_line_break
│   ├── delete.rs          remove_text, delete_character/word/line, ModifyTarget
│   ├── format.rs          format_text
│   ├── modify.rs          modify (Alter, Granularity), decorator/block movement
│   └── adjust.rs          selection fix-ups used by tree ops (crate-private)
├── caret/
│   ├── mod.rs             caret value types, CaretRange, CommonAncestor
│   ├── cursor.rs          StepwiseCursor, NodeCaretCursor, SiblingCursor
│   └── utils.rs           caret_from_point, remove_text_from_caret_range,
│                          split_at_point_caret_next, …
├── commit.rs              Commit, Changes, DirtyIntent, Mutation
├── diff/
│   ├── mod.rs             Diff, DiffOp, DiffOptions
│   └── encode.rs          DiffBuffer, Opcode (flat layout for wasm)
├── history.rs             History, HistoryConfig, HistoryTime, HistoryAction, MergeTracker
├── json.rs                SerializedEditorState, SerializedNode, js_number,
│                          to_js_json_string, JsonImport, StateImportFilter
├── command.rs             Command, CommandKind, CommandKey, KeyEvent, ClipboardPayload,
│                          Plugin, CommandRegistration, Handled, CommandPriority, Placement,
│                          ListenerTable, PriorityLevels
├── event.rs               EventKey, PluginEvent (§14.5)
├── extension.rs           ExtensionState, ExtensionStore (crate-private store)
├── file.rs                SerializedDocument (`@lexical/file`)
├── tags.rs                UpdateTag, TagSet
├── core.rs                EditorCore, Input, Output, Effect, Composition, ViewHost,
│                          ViewEngine, ViewOs, …
└── error.rs               Error, InternalError, BuildError, PointRole
```

Files stay under ~1000 lines (CS-24). `selection/insert.rs` (upstream `insertText` alone is
400 lines) is split further if it grows past that.

---

## 2. Core value types

### 2.1 Keys

```rust
/// Editor-scoped handle to a node. `Copy`; never borrows the state.
///
/// `index` comes from a per-editor monotonic counter (upstream `generateRandomKey`,
/// `LexicalUtils.ts:123`) and is never reused within a generation. `generation` is the key
/// generation: `Editor::reset_key_counter` (upstream `resetRandomKey`) bumps it and
/// restarts `index` at 1, so a key minted before the reset can never alias one minted
/// after it, although both print the same string.
///
/// `Ord` is `(generation, index)`: key creation order, which is upstream's `Map` insertion
/// order for the node map (§5.2 `nodes_of_type`).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct NodeKey { generation: u32, index: u32 }

impl NodeKey {
    /// The root node's key, upstream `'root'`. Never allocated, valid in every generation.
    pub const ROOT: NodeKey;
    /// The counter value (upstream's numeric key string). 0 for the root.
    pub fn index(self) -> u32;
    /// The key generation.
    pub fn generation(self) -> u32;
    /// Rebuilds a key from parts, for the wasm/FFI boundary. Index 0 is always ROOT,
    /// whatever the generation. Arguments are in struct and `Ord` order (R2-55).
    pub fn from_parts(parts: KeyParts) -> NodeKey;
    pub fn parts(self) -> KeyParts;
}

/// The two halves of a `NodeKey`, named so the two `u32`s cannot be swapped silently at the
/// FFI boundary (R2-55).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct KeyParts { pub generation: u32, pub index: u32 }

/// `"root"` for ROOT, otherwise the decimal index (`"1"`, `"2"`, …): upstream's string form,
/// used by the JS shim and in error messages.
impl fmt::Display for NodeKey;

/// Typed key: proof that, when it was produced, the key named a node whose registered
/// ancestry includes `Node`. Same size as `NodeKey`.
pub struct Id<Node: NodeType> { key: NodeKey, node_type: PhantomData<fn() -> Node> }

impl<Node: NodeType> Id<Node> {
    pub fn key(self) -> NodeKey;
    /// Upcast one level along the declared parent chain (a no-op on the key), whatever the
    /// kind: `ParentOf<Node>` is the kind trait's `Parent` (§3.2). For a farther ancestor use
    /// `view.cast::<Ancestor>(id)` (checked against the registered ancestry, so it also works
    /// for replacements).
    pub fn upcast(self) -> Id<ParentOf<Node>>;
}
impl<Node: NodeType> Clone for Id<Node>;   // and Copy, PartialEq, Eq, Hash, Debug, Display
impl<Node: NodeType> From<Id<Node>> for NodeKey;
```

```rust
/// Where an editor's keys come from (`EditorBuilder::key_source`).
#[derive(Clone, Debug, Default)]
pub enum KeySource {
    /// A counter owned by this editor (D-5). Default.
    #[default]
    PerEditor,
    /// A counter shared by several editors, reproducing upstream's process-global
    /// `keyCounter` for fixtures that create several editors (the Tier B shim, S4 strict
    /// replay). It is a value passed in, not a global.
    Shared(SharedKeyCounter),
}
/// `Arc<AtomicU64>` packing (generation, index). `Clone` shares it.
#[derive(Clone, Debug, Default)]
pub struct SharedKeyCounter { /* Arc<AtomicU64> */ }
impl SharedKeyCounter {
    pub fn new() -> SharedKeyCounter;
    /// `resetRandomKey()` for every editor sharing the counter.
    pub fn reset(&self);
}
```

Every function that takes a node takes `impl Into<NodeKey>`, so callers pass a `NodeKey` or
an `Id<_>` directly. Each such generic method is a one-line `#[inline]` shim over a
non-generic `fn x_key(&self, key: NodeKey)` body, so the ~90 `Read` methods are not
monomorphized per `Id<T>` (compile time across ~60 node types). Only `StateRef::cast` and
`Transaction::create*` produce `Id<_>`.

`Id<Node>` stays valid after its node is removed. A lookup then returns `None` or
`Error::NodeNotFound`, the same way a key does. This matches upstream's
`getLatest()` failure (`LexicalNode.ts:1080`).

### 2.2 Offsets

```rust
/// A position or length in UTF-16 code units. Text offsets, text lengths, slice indices,
/// caret offsets and serialized selections all use this unit (SCOPE D1).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Utf16Offset(pub u32);

impl Utf16Offset {
    pub const ZERO: Utf16Offset;
    pub fn get(self) -> u32;
    pub fn checked_add(self, other: Utf16Offset) -> Option<Utf16Offset>;
    pub fn saturating_sub(self, other: Utf16Offset) -> Utf16Offset;
}
impl Add for Utf16Offset;   // Output = Utf16Offset; overflow is impossible below u32::MAX code units per node
impl Sub for Utf16Offset;   // saturating; upstream uses Math.max(0, …) at every call site that can underflow

/// A child position inside an element: an element point's offset, a splice start, an
/// index within a parent.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ChildIndex(pub u32);

/// Text storage: a UTF-8 `String` that caches its UTF-16 length and whether it is ASCII.
/// When it is ASCII, a UTF-16 offset equals a byte offset, so conversion is O(1). Otherwise
/// conversion scans the string, which is fine because text nodes are short.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct TextBuffer { text: String, utf16_len: Utf16Offset, is_ascii: bool }

impl TextBuffer {
    pub fn new(text: impl Into<String>) -> TextBuffer;
    pub fn as_str(&self) -> &str;
    pub fn utf16_len(&self) -> Utf16Offset;
    /// Converts to a byte offset. Fails with `Error::Utf16OffsetOutOfRange` past the end and
    /// `Error::Utf16OffsetSplitsSurrogatePair` inside an astral character (§19, D-6).
    pub fn byte_offset(&self, offset: Utf16Offset) -> Result<usize, Error>;
    /// `text.slice(start, end)`: both bounds clamp to `[0, len]`; start ≥ end returns `""`.
    pub fn slice(&self, range: Range<Utf16Offset>) -> Result<&str, Error>;
    /// The UTF-16 code unit at `offset`, for the surrogate and emoji checks in deleteCharacter.
    pub fn code_unit_at(&self, offset: Utf16Offset) -> Option<u16>;
}
```

### 2.3 Text formats, modes, details

S2: FMT-01..FMT-05 (`TextFormat` bits, `TextFormat::toggled` mutual exclusions FMT-03/04,
`TextFormatType` strings FMT-05), TX-01, TX-02 (`TextMode`, `TextDetail`).

```rust
bitflags::bitflags! {
    /// TextNode/RangeSelection `format` (`LexicalConstants.ts`). Bit values are upstream's and
    /// serialize as the raw integer.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    pub struct TextFormat: u32 {
        const BOLD = 1; const ITALIC = 1 << 1; const STRIKETHROUGH = 1 << 2;
        const UNDERLINE = 1 << 3; const CODE = 1 << 4; const SUBSCRIPT = 1 << 5;
        const SUPERSCRIPT = 1 << 6; const HIGHLIGHT = 1 << 7; const LOWERCASE = 1 << 8;
        const UPPERCASE = 1 << 9; const CAPITALIZE = 1 << 10;
    }
}
impl TextFormat {
    /// `IS_ALL_FORMATTING`.
    pub const ALL: TextFormat;
    /// `toggleTextFormatType(format, type, alignWithFormat)` (`LexicalUtils.ts:283`), including
    /// the mutual exclusions (subscript/superscript, lowercase/uppercase/capitalize).
    pub fn toggled(self, format_type: TextFormatType, align_with: Option<TextFormat>) -> TextFormat;
    pub fn has(self, format_type: TextFormatType) -> bool;
}

/// `TextFormatType`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, strum::EnumString,
         strum::Display, strum::EnumIter, strum::IntoStaticStr)]
#[serde(rename_all = "lowercase")] #[strum(serialize_all = "lowercase")]
pub enum TextFormatType { Bold, Underline, Strikethrough, Italic, Highlight, Code, Subscript,
                          Superscript, Lowercase, Uppercase, Capitalize }
impl TextFormatType {
    /// `TEXT_TYPE_TO_FORMAT[type]`.
    pub fn flag(self) -> TextFormat;
}

/// `TextModeType`; JSON `"normal" | "token" | "segmented"`, stored as 0/1/2.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default, Serialize, Deserialize, strum::EnumString, strum::Display)]
#[serde(rename_all = "lowercase")] #[strum(serialize_all = "lowercase")]
pub enum TextMode { #[default] Normal, Token, Segmented }

bitflags::bitflags! {
    /// TextNode `detail` (`IS_DIRECTIONLESS`, `IS_UNMERGEABLE`).
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    pub struct TextDetail: u32 { const DIRECTIONLESS = 1; const UNMERGEABLE = 1 << 1; }
}

/// `TextDetailType`. Upstream's type says `'unmergable'` while `DETAIL_TYPE_TO_DETAIL` is keyed
/// `unmergeable` (`LexicalConstants.ts`), so `setDetail('unmergable')` stores `undefined`
/// upstream: it **clears** the detail and the `detail` key disappears from JSON. Rust's
/// `FromStr` accepts only `"directionless"` and `"unmergeable"`. The JS shim maps
/// `'unmergable'` to `set_detail(TextDetail::empty())` plus the absent-`detail` mark (§13.3),
/// reproducing the clearing (D-14 withdrawn).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, strum::EnumString, strum::Display)]
pub enum TextDetailType {
    #[strum(serialize = "directionless")] Directionless,
    #[strum(serialize = "unmergeable")] Unmergeable,
}
```

### 2.4 Element formats and direction

S2: EL-02 (`ElementFormat::bits`).

```rust
/// `ElementFormatType`. Stored as upstream's number (`IS_ALIGN_*`). JSON uses the string:
/// `"" | "left" | "start" | "center" | "right" | "end" | "justify"`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default, Serialize, Deserialize, strum::EnumString, strum::Display)]
#[serde(rename_all = "lowercase")] #[strum(serialize_all = "lowercase")]
pub enum ElementFormat {
    #[default] #[serde(rename = "")] #[strum(serialize = "")] Unset,
    Left, Start, Center, Right, End, Justify,
}
impl ElementFormat {
    /// The upstream number: Unset 0, Left 1, Center 2, Right 3, Justify 4, Start 5, End 6.
    pub fn bits(self) -> u32;
    /// `ElementNode.hasFormat(type)` is `(format & flag) !== 0` upstream. The values are not
    /// bit flags, so `Right.has_format(Center)` is true (3 & 2). Ported as-is (D-15).
    pub fn has_format(self, other: ElementFormat) -> bool;
}

/// Element `direction`: JSON `"ltr" | "rtl" | null`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, strum::EnumString, strum::Display)]
#[serde(rename_all = "lowercase")] #[strum(serialize_all = "lowercase")]
pub enum TextDirection { Ltr, Rtl }

/// `getTextDirection(text)` (`LexicalUtils.ts:232`), using the RTL_REGEX/LTR_REGEX code-point
/// ranges from `LexicalConstants.ts` as explicit UTF-16 range tables.
pub fn text_direction(text: &str) -> Option<TextDirection>;

/// `excludeFromCopy` / `extractWithChild` destination.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CopyDestination { Clone, Html }
```

### 2.5 Edit directions

```rust
/// Backward/forward for delete and modify. Upstream passes `isBackward: boolean`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EditDirection { Backward, Forward }
```

### 2.6 Style strings

```rust
/// `getStyleObjectFromCSS(css)` (`utils/setDOMStyle.ts:18`): parses `prop: value; …`,
/// honouring quotes, escapes, comments and parentheses. Insertion-ordered. Written with nom.
/// Used by `@lexical/selection`'s `$patchStyleText` port in lexical_rich_nodes.
pub fn parse_css_declarations(css: &str) -> IndexMap<String, String>;
```

---

## 3. The node model

### 3.1 Record layout

S2: EL-01, TX-01, ID-01..ID-03 (record, clone on first write, dirty marking), NS-19 (state is
framework-owned, never a user field).

The record type is `NodeSlot` (R2-56), so `Node` always means a node *type* (`<Node:
NodeType>`).

```rust
/// One node in a state. Stored as `Arc<NodeSlot>` in the persistent map. Not constructed directly.
#[derive(Clone)]
pub(crate) struct NodeSlot {
    pub(crate) key: NodeKey,
    pub(crate) type_index: NodeTypeIndex,        // index into Registry
    pub(crate) links: Links,                     // __parent/__prev/__next
    pub(crate) base: BaseData,                   // the kind's framework fields
    pub(crate) state: Option<Arc<NodeState>>,    // __state (copied on write)
    pub(crate) data: Arc<dyn AnyNodeData>,       // the user struct, cloned lazily (see below)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(crate) struct Links { parent: Option<NodeKey>, prev: Option<NodeKey>, next: Option<NodeKey> }

/// The four base kinds. `$isElementNode` / `$isTextNode` / `$isDecoratorNode` /
/// `$isLineBreakNode` become `kind() == …`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, strum::Display)]
pub enum NodeKind { Element, Text, Decorator, LineBreak }

/// The framework-owned fields of each kind. The user struct never holds these.
#[derive(Clone, PartialEq, Debug)]
pub enum BaseData { Element(ElementData), Text(TextData), Decorator, LineBreak }

/// ElementNode's fields (`LexicalElementNode.ts:85–118`). The child links are read-only to
/// users; they change only through tree operations.
#[derive(Clone, PartialEq, Debug, Default)]
pub struct ElementData {
    first: Option<NodeKey>,            // __first
    last: Option<NodeKey>,             // __last
    size: u32,                         // __size
    pub format: ElementFormat,         // __format
    pub style: Arc<str>,               // __style (never in JSON; copied by insertNewAfter)
    pub indent: u32,                   // __indent
    pub direction: Option<TextDirection>, // __dir
    pub text_format: TextFormat,       // __textFormat
    pub text_style: Arc<str>,          // __textStyle
    absent: AbsentKeys,                // base keys that were absent on import (§13.3, D-22)
}
impl ElementData {
    pub fn first_child(&self) -> Option<NodeKey>;
    pub fn last_child(&self) -> Option<NodeKey>;
    pub fn children_size(&self) -> u32;
    pub fn is_empty(&self) -> bool;
}

/// TextNode's fields (`LexicalTextNode.ts:312–355`).
#[derive(Clone, PartialEq, Debug, Default)]
pub struct TextData {
    pub text: TextBuffer,              // __text
    pub format: TextFormat,            // __format
    pub style: Arc<str>,               // __style
    pub mode: TextMode,                // __mode
    pub detail: TextDetail,            // __detail
    absent: AbsentKeys,                // base keys that were absent on import (§13.3, D-22)
}

bitflags::bitflags! {
    /// Base keys whose upstream field holds `undefined` because `updateFromJSON` read an absent
    /// key (`setIndent(undefined)`, `setDetail(undefined)`, …). `JSON.stringify` omits them, so
    /// export omits them too. The matching setter clears the bit. Reads see the Rust default
    /// (0, None, "", Normal). Crate-private.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    pub(crate) struct AbsentKeys: u8 {
        const INDENT = 1; const DIRECTION = 1 << 1;                       // element
        const FORMAT = 1 << 2; const DETAIL = 1 << 3; const MODE = 1 << 4; // text
        const STYLE = 1 << 5; const TEXT = 1 << 6;                         // text
    }
}
impl TextData {
    pub fn new(text: impl Into<String>) -> TextData;
    pub fn is_token(&self) -> bool;          // mode == Token
    pub fn is_segmented(&self) -> bool;      // mode == Segmented
    pub fn is_directionless(&self) -> bool;
    pub fn is_unmergeable(&self) -> bool;
    pub fn has_format(&self, format_type: TextFormatType) -> bool;
    /// `getFormatFlags(type, alignWithFormat)`.
    pub fn format_flags(&self, format_type: TextFormatType, align_with: Option<TextFormat>) -> TextFormat;
}
```

`Arc<NodeSlot>` plus `Arc::make_mut` implements `getWritable()`. The first write in a
transaction clones the record, because the committed snapshot still shares the `Arc`. Later
writes find a unique `Arc` and do not clone. That is upstream's `_cloneNotNeeded` set,
enforced by the type system. A `NodeKey` with a different `generation`, or one absent from
the map, is "not found".

`AnyNodeData` is crate-private and object-safe, declared `trait AnyNodeData: Any + Send +
Sync + fmt::Debug` (R2-41). It provides `clone_arc`, `dyn_eq`, `as_any`/`as_any_mut`,
`to_json_object` and `type_index`. It is implemented for every `Node: NodeType` (and for
`ForeignData`, §4.4).

Clone cost on first write (F-45). Cloning a record copies `Links`, `BaseData` (with
`Arc<str>` styles, so O(1) apart from the `TextBuffer`) and bumps the `data` and `state`
`Arc`s. The user struct is cloned (`Arc::make_mut` on `data`) only when it is written
through `get_mut::<Node>`. Base-field writes (`set_text_content`, link changes) never clone
it. `TextBuffer` stays an owned `String`: typing writes it anyway, so sharing it would buy
nothing.

`after_clone` (§3.2) runs when a record is actually cloned for writing (the `Arc` was
shared: upstream `$cloneWithProperties` from `getWritable`), in `copy_node`, and in
`NodeRef::to_owned` (`$cloneWithPropertiesEphemeral`). It does not run when a write finds
the `Arc` unique, which is upstream's `_cloneNotNeeded` case. It returns `Option<Self>`, so
the default (`None`) keeps the shared `data` `Arc` and costs nothing.

### 3.2 `NodeType` and the kind traits

S2: CFG-01..CFG-11 (per-level `$config`, transform collection along the declared chain CFG-08,
abstract classes get no type CFG-05, dev warnings CFG-11 are structural), ID-04..ID-12
(identity, clone, replacement hooks), EL-04..EL-17 and TX-03..TX-14 (the hook defaults),
NODE-01..NODE-20 (built-in overrides, §3.3).

Upstream subclasses `ElementNode`/`TextNode`/`DecoratorNode` and overrides methods. In
Rust a node type is a struct that implements `NodeType` plus exactly one kind trait.
Inheritance is the associated type `Parent` **on the kind trait** (R2-38): `ElementNode::Parent:
ElementNode`, `TextNode::Parent: TextNode`, and so on. Every overridable method's default
delegates to `Self::Parent`, which is how a JS subclass inherits overrides from its
superclass. `NodeType` itself has no `Parent`: a bound such as `trait ElementNode:
NodeType<Parent: ElementNode>` is a cycle (E0391, §0), and the `where Self::Parent:
ElementNode` form is not implied, so every generic user would have to restate it (E0277).
Keeping `Parent` on `NodeType` bounded only by `NodeType` compiles, but then the delegating
defaults of the kind traits cannot call the parent's kind-trait methods. Code that is generic over `Node: NodeType` reaches the parent
type through the sealed `KindOf` bridge as `ParentOf<Node>`. The chain ends at a base marker
that implements every method with upstream's base-class behaviour:

| Upstream base class | Rust terminal parent | Registered? |
| --- | --- | --- |
| `ElementNode` | `ElementBase` (unit struct marker) | no |
| `TextNode` | `TextBase` (unit struct marker); `Text` has `Parent = TextBase` and is registered as `"text"` | no |
| `DecoratorNode` | `DecoratorBase` (unit struct marker) | no |
| `LineBreakNode` | `LineBreakBase` (unit struct marker); `LineBreak` has `Parent = LineBreakBase` | no |

Every chain ends at a marker (`IS_MARKER = true`), so no registered type is its own parent,
provided defaults never self-recurse, and the `get::<Ancestor>` projection stops at the first
marker. A marker's `Parent` is itself; only markers do that.

Rule for hook bodies (F-13). Upstream base bodies call overridable methods on `this` and so
dispatch to the most-derived class (`ElementNode.select` → `this.canBeEmpty()`, `splice` →
`this.canBeEmpty()`, `exportJSON` → `this.getIndent()`). In Rust, inside any hook or
`default_*` body, call other hooks only through the view or the transaction
(`node.can_be_empty()`, `tx.indent(key)`, `tx.splice(key, …)`), never through `self.` or
`as_parent()`. `self.as_parent().x(…)` (for `&self` predicates) and
`<Self::Parent as ElementNode>::x(tx, this.upcast(), …)` (for mutators) are allowed only as the
delegation that implements `super.x(…)` for the same method. The ast-grep rule
`rules/ast-grep/lexical-hook-self-call.yml` flags `self.<hook>(` and `as_parent().<other hook>(`
inside `impl {Node,Element,Text,Decorator,LineBreak}Node for`. One whitelisted exception is the
`$removeNode` empty-parent cascade (§7.4, R2-27).

```rust
/// Implemented by every registered node type. The struct holds only the node's own fields
/// (upstream `__foo` fields declared by the subclass). Base-kind fields, links and NodeState
/// belong to the framework. A type implements `NodeType` and the one kind trait its `Kind`
/// names; `Kind: KindOf<Self>` makes the compiler check that pairing.
pub trait NodeType:
    Clone + PartialEq + fmt::Debug + Send + Sync + Serialize + DeserializeOwned + 'static
{
    /// `static getType()`. Unique per registry; it is the JSON `"type"`.
    const TYPE: &'static str;
    /// True only for the unregistered base markers (`ElementBase`, `TextBase`,
    /// `DecoratorBase`, `LineBreakBase`). Chain walks stop here.
    const IS_MARKER: bool = false;
    /// Which base kind: one of `ElementKind`, `TextKind`, `DecoratorKind`, `LineBreakKind`.
    /// `ElementKind: KindOf<Self>` holds iff `Self: ElementNode`, and so on.
    type Kind: NodeKindMarker + KindOf<Self>;

    /// `$config().stateConfigs` declared at **this** level. Per level, never delegated: the
    /// registry walks the kind trait's `Parent` and concatenates, nearest first (upstream
    /// inherits statics through the class chain). Flat keys serialize beside `type`/`version`
    /// instead of under `"$"`.
    const REQUIRED_STATE: &'static [RequiredState] = &[];

    /// Upstream's `'__language' in node` duck-typing (`LexicalSelection.ts:1368-1376`, R2-20):
    /// true for CodeNode and every subclass. Per level; the registry ORs it along the chain,
    /// like `REQUIRED_STATE`, and `Read::has_language_field(key)` reads the result.
    const HAS_LANGUAGE_FIELD: bool = false;

    /// The type-table flags (§4.1 `TypeFlags`: `is_inline`, `can_insert_text_before`/`after`,
    /// `is_keyboard_selectable`, `is_isolated`, `is_shadow_root`) depend on more than the type
    /// (instance fields, NodeState, neighbours) (R2.1, S12 §0.2 and Q3). Per level, ORed along
    /// the chain like `HAS_LANGUAGE_FIELD`. Such a type's row carries no flags, and the type
    /// must put the state its answers depend on in its props, so the view's `NodeView` can
    /// answer from the mirror.
    const FLAGS_PER_INSTANCE: bool = false;

    /// Class name used in error messages, matching upstream's `klass.name`. Defaults to the
    /// last path segment of `std::any::type_name::<Self>()`. Built-ins override it to
    /// upstream's names (`"RootNode"`, `"ParagraphNode"`, `"TextNode"`, …).
    fn class_name() -> &'static str { /* last segment of type_name */ }

    /// `static transform()` / `$config().$transform` declared at **this** level. Per level,
    /// never delegated: the registry walks the chain and collects one entry per level,
    /// nearest first (`getTransformSetFromKlass`, `LexicalEditor.ts:714`). There is no
    /// fn-pointer dedupe: Rust does not inherit statics, which is the only reason upstream
    /// dedupes.
    fn static_transform() -> Option<TransformFn<Self>> { None }

    /// `$createXNode()` with the constructor's defaults (R2-43, R2-05). `None` (the default)
    /// means the constructor needs arguments. Stable Rust cannot detect `Self: Default`, so a
    /// type opts in with `fn default_node() -> Option<Self> { Some(Self::default()) }` (the
    /// one-line `impl_default_node!()` macro writes it). Every built-in returns `Some`.
    /// `Transaction::create_resolved` returns `Error::NoDefault` on `None`.
    fn default_node() -> Option<Self> { None }

    /// A representative instance from which `build()` computes the type's §4.1 `TypeFlags`
    /// row (R2.1): the flag hooks run on it alone in a scratch state. Defaults to
    /// `default_node()`; a type whose constructor needs arguments returns any valid instance.
    /// Not consulted when `FLAGS_PER_INSTANCE` is set anywhere on the chain. A type with
    /// neither a probe nor `FLAGS_PER_INSTANCE` fails `build()` with
    /// `BuildError::NoFlagProbe`, so the table is never silently wrong. Debug builds check at
    /// every commit (§8.5) that each created or updated node's flags equal its row.
    fn flag_probe() -> Option<Self> { Self::default_node() }

    /// `static importJSON(json)` as a whole (CR-11, CR-12). Returns the key of the node it
    /// created, which may be of **another** type (Macro's `DatabaseQueryNode.importJSON`
    /// returns an `UnknownMentionNode`). The caller (`Transaction::import_node`) appends the
    /// JSON `children` iff the returned node is an element, through the virtual `append`.
    /// Default, which is upstream's `$createXNode().updateFromJSON(json)` (R2-05):
    /// ```ignore
    /// let key = match Self::default_node() {
    ///     // `$createXNode()` with constructor defaults: a replacement's `with` sees the
    ///     // default original, as `$applyNodeReplacement` does.
    ///     Some(node) => tx.create(node)?.key(),
    ///     // The constructor takes arguments (`$createMentionNode(json.id)`): build them
    ///     // from the JSON, which is what such an upstream `importJSON` does.
    ///     None => tx.create(Self::import_json(json)?)?.key(),
    /// };
    /// tx.update_from_json(key, json)?;  // virtual: the *replacement's* update_from_json
    /// Ok(key)
    /// ```
    /// Override to return another type, or to skip base fields or filter `$` keys, with
    /// `Transaction::update_from_json_with(key, json, JsonImport { .. })` (§13.3). Not
    /// delegated: like upstream's static, each registered type has its own (the default).
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> Result<NodeKey, Error> { /* default above */ }

    /// The serde helper: builds the struct from the node's JSON object. Used by `import`'s
    /// `None` branch and by `update_from_json`'s default. Default: `serde_json::from_value` of
    /// the object (unknown keys, including framework keys, are ignored).
    fn import_json(json: &SerializedNode) -> Result<Self, Error> { /* serde */ }

    /// `updateFromJSON(json)` for the struct's own fields, run after NodeState and the base
    /// fields (§13.3). Default: replaces `*self` with `import_json(json)?`.
    fn update_from_json(&mut self, json: &SerializedNode) -> Result<(), Error> { /* … */ }

    /// Side effects of `static clone(node)` beyond copying fields: constructor
    /// normalization, `afterCloneFrom` overrides that do more than copy (CR-16; Macro's
    /// CustomCodeNode normalizes `language` in its constructor, so the first writable clone
    /// rewrites `"js"` to `"javascript"`). Runs at the clone points listed in §3.1. Returns
    /// the replacement struct, or `None` to keep it unchanged. Not delegated (a subtype that
    /// wants its parent's normalization calls it on `as_parent()` itself). Default `None`.
    fn after_clone(&self) -> Option<Self> { None }
}
```

The hooks every kind shares are upstream `LexicalNode` methods that some subclass overrides
(ListItemNode, RootNode, CodeNode, Macro nodes). They are declared **once**, in the
crate-private macro `common_node_hooks!`, and that macro is expanded inside each of the four
kind traits, because each kind trait owns its own `Parent` (macros in trait-item position are
stable; the probe crate does this). Each default delegates to `Self::Parent`; the markers
implement the base body.

```rust
macro_rules! common_node_hooks {
    ($View:ident) => {
        /// Serialized `version`. Delegates; markers return 1.
        fn json_version(&self) -> u32 { self.as_parent().json_version() }
        /// Post-processing hook for `exportJSON` (S3's `export_json_fixup`, CR-5). The
        /// framework has already written the kind's base keys (through the virtual getters,
        /// §13.2), `type`, `version`, NodeState and this struct's serde fields, in upstream
        /// order. Overriding is how Paragraph appends its `textFormat`/`textStyle` fallback.
        fn adjust_export_json(&self, node: NodeView<'_>, json: &mut SerializedNode) -> Result<(), Error> {
            self.as_parent().adjust_export_json(node, json)
        }
        /// `isParentRequired()`. Base false.
        fn is_parent_required(&self, node: $View<'_>) -> bool { self.as_parent().is_parent_required(node) }
        /// `resetOnCopyNodeFrom(original)` (`LexicalNode.ts:623`), run by `copy_node` after
        /// cloning, unless `skip_reset`. The framework has already reset NodeState keys marked
        /// `reset_on_copy` (the base body). ListItemNode overrides it to clear `checked` when
        /// the **original**'s parent-aware `getChecked()` is true, so the hook gets `tx` and
        /// the original's key.
        fn reset_on_copy(tx: &mut Transaction<'_>, this: Id<Self>, original: NodeKey) -> Result<(), Error> {
            <Self::Parent>::reset_on_copy(tx, this.upcast(), original)
        }
        /// `remove(preserveEmptyParent)` (`LexicalNode.ts:1297`, `$removeNode` at :282).
        fn remove(tx: &mut Transaction<'_>, this: Id<Self>, preserve_empty_parent: bool) -> Result<(), Error> {
            <Self::Parent>::remove(tx, this.upcast(), preserve_empty_parent)
        }
        /// `replace(replaceWith, includeChildren)` (`LexicalNode.ts:1308`). Returns the
        /// replacement key.
        fn replace(tx: &mut Transaction<'_>, this: Id<Self>, replacement: NodeKey, include_children: bool)
            -> Result<NodeKey, Error> {
            <Self::Parent>::replace(tx, this.upcast(), replacement, include_children)
        }
        /// `insertAfter(node, restoreSelection = true)` (`LexicalNode.ts:1424`).
        fn insert_after(tx: &mut Transaction<'_>, this: Id<Self>, node: NodeKey, restore_selection: bool)
            -> Result<NodeKey, Error> {
            <Self::Parent>::insert_after(tx, this.upcast(), node, restore_selection)
        }
        /// `insertBefore(node, restoreSelection = true)` (`LexicalNode.ts:1505`).
        fn insert_before(tx: &mut Transaction<'_>, this: Id<Self>, node: NodeKey, restore_selection: bool)
            -> Result<NodeKey, Error> {
            <Self::Parent>::insert_before(tx, this.upcast(), node, restore_selection)
        }
        /// `createParentElementNode()` (S3 calls it `create_parent_element_node`; this is
        /// the one name). Base: creates `Paragraph` (with replacement).
        fn create_parent_element(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<NodeKey, Error> {
            <Self::Parent>::create_parent_element(tx, this.upcast())
        }
    };
}
```

The trait listings below mark the kind-specific predicate and mutator defaults as
declarations only, for brevity; every one has a provided body that delegates to `Parent`,
exactly as `is_inline` shows. The four base markers override every delegating method with
the base-class body (they are the only types whose `Parent` is `Self`), and a unit test calls
each method on each marker. Users override only what upstream overrides. `TYPE` of a marker
is `""`; registering one is `BuildError::BaseMarkerRegistered`.

Overridable upstream methods that are **not** hooks, with the reason (audit D-C3):
`isSimpleText`, `splitText`, `setTextContent` (Tab's override is `coerce_text_content`),
`mergeWithSibling`, `select`, `selectStart`, `selectEnd`, `selectNext`, `selectPrevious`,
`insertBefore` (a hook only through the common `insert_before`, already listed),
`getTopLevelElement`, `afterCloneFrom` (field copy is `Clone`; the rest is `after_clone`).
No upstream package outside `packages/lexical/src` and no Macro node overrides them
(grep over `packages/*/src` and `packages/lexical-core/nodes`, 2026-11-07). A JS subclass
that overrides one in the shim (`ForeignNode`, §4.4) gets the base behaviour; S4 lists that in
its hosting tests. `canSelectBefore` is a TableNode method with no core caller; table code
reaches it through `Read::get_dyn` (§4.2, F-41).

Boilerplate (F-40): inside a kind-trait impl, `element_node_base!()` / `decorator_node_base!()`
/ `text_node_base!()` / `line_break_node_base!()` emit `type Parent = <marker>` (or `Text` for
`text_node_base!`), `as_parent` and `as_parent_mut` for the common case of a direct subclass of
a base class. `impl_default_node!()` inside `impl NodeType` emits `default_node`. The traits
stay the contract; the macros are sugar.

Kind markers and registration dispatch:

```rust
pub struct ElementKind; pub struct TextKind; pub struct DecoratorKind; pub struct LineBreakKind;

/// Sealed. Gives the kind as a value.
pub trait NodeKindMarker: sealed::Sealed + 'static { const KIND: NodeKind; }

/// Sealed. `ElementKind: KindOf<Node>` holds iff `Node: ElementNode`, and so on. This lets
/// `EditorBuilder::node::<Node>()` build the right vtable without four registration methods,
/// and lets code generic over `Node: NodeType` name the parent type.
pub trait KindOf<Node: NodeType>: sealed::Sealed {
    /// The kind trait's `Parent` of `Node`.
    type Parent: NodeType;
    /* crate-private: fn vtable() -> NodeVTable */
}
impl<Node: ElementNode> KindOf<Node> for ElementKind { type Parent = <Node as ElementNode>::Parent; }
impl<Node: TextNode> KindOf<Node> for TextKind { type Parent = <Node as TextNode>::Parent; }
impl<Node: DecoratorNode> KindOf<Node> for DecoratorKind { type Parent = <Node as DecoratorNode>::Parent; }
impl<Node: LineBreakNode> KindOf<Node> for LineBreakKind { type Parent = <Node as LineBreakNode>::Parent; }

/// The declared parent of any node type, whatever its kind.
pub type ParentOf<Node> = <<Node as NodeType>::Kind as KindOf<Node>>::Parent;
```

Read-only views handed to predicates. Their accessors take `self` by value and return
`'state` borrows (R2-39), so a value read through a temporary view outlives the view:

```rust
/// What a predicate may read: its own key plus the whole (pending or committed) state.
#[derive(Clone, Copy)]
pub struct NodeView<'state> { pub key: NodeKey, pub state: StateRef<'state> }
/// `NodeView` whose node is known to be an element (`element()` cannot fail).
#[derive(Clone, Copy)]
pub struct ElementView<'state> { pub key: NodeKey, pub state: StateRef<'state> }
impl<'state> ElementView<'state> {
    pub fn data(self) -> &'state ElementData;
    /// Virtual calls on this node, dispatched to the most-derived type (F-13). One per
    /// ElementNode predicate: `can_be_empty`, `is_inline`, `can_insert_text_before`,
    /// `can_insert_text_after`, `is_shadow_root`, `can_indent`, `can_merge_with(other)`,
    /// `can_merge_when_empty`, `can_replace_with(other)`, `can_insert_after(other)`,
    /// `exclude_from_copy(dest)`, `extract_with_child(..)`, `indent`.
    pub fn can_be_empty(self) -> bool;
    pub fn indent(self) -> u32;
    // … the rest as listed above, each `self.state.<pred>(self.key, …)`.
}
/// The same for text nodes.
#[derive(Clone, Copy)]
pub struct TextView<'state> { pub key: NodeKey, pub state: StateRef<'state> }
impl<'state> TextView<'state> {
    pub fn data(self) -> &'state TextData;
    /// Virtual: `can_insert_text_before/after`, `can_have_format`, `is_text_entity`.
    pub fn can_have_format(self) -> bool;
    // … as above.
}
pub type DecoratorView<'state> = NodeView<'state>;
pub type LineBreakView<'state> = NodeView<'state>;
```

#### `ElementNode`

Every method has upstream's `ElementNode` default, reached by delegating to `Parent`.
`ElementBase` implements each one directly with the body cited.

```rust
pub trait ElementNode: NodeType<Kind = ElementKind> {
    /// The upstream superclass: `ElementBase` for direct subclasses of ElementNode, or another
    /// registered element type (for example `MarkNode` for Macro's `CommentNode`).
    type Parent: ElementNode;
    /// Borrow of the parent part of this node. For marker parents, `&ElementBase` (a
    /// promoted constant).
    fn as_parent(&self) -> &Self::Parent;
    /// Mutable borrow of the parent part, or `None` when the parent is a marker. This is what
    /// lets `get_mut::<Ancestor>` work on a subtype.
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent>;

    common_node_hooks!(ElementView);

    // ---- predicates (pure)
    /// `isInline()` (base false, `LexicalElementNode.ts:728`).
    fn is_inline(&self, node: ElementView<'_>) -> bool { self.as_parent().is_inline(node) }
    /// `canBeEmpty()` (base true).
    fn can_be_empty(&self, node: ElementView<'_>) -> bool;
    /// `canInsertTextBefore()` (base true).
    fn can_insert_text_before(&self, node: ElementView<'_>) -> bool;
    /// `canInsertTextAfter()` (base true).
    fn can_insert_text_after(&self, node: ElementView<'_>) -> bool;
    /// `isShadowRoot()` (base false).
    fn is_shadow_root(&self, node: ElementView<'_>) -> bool;
    /// `canIndent()` (base true).
    fn can_indent(&self, node: ElementView<'_>) -> bool;
    /// `canMergeWith(other)` (base false).
    fn can_merge_with(&self, node: ElementView<'_>, other: NodeKey) -> bool;
    /// `canMergeWhenEmpty()` (base false).
    fn can_merge_when_empty(&self, node: ElementView<'_>) -> bool;
    /// `canReplaceWith(replacement)` (base true).
    fn can_replace_with(&self, node: ElementView<'_>, replacement: NodeKey) -> bool;
    /// `canInsertAfter(other)` (base true).
    fn can_insert_after(&self, node: ElementView<'_>, other: NodeKey) -> bool;
    /// `excludeFromCopy(destination)` (base false). Upstream calls it only on elements
    /// (`LexicalEditor.ts:767`, `clipboard.ts:492`), so it is an ElementNode hook only.
    fn exclude_from_copy(&self, node: ElementView<'_>, destination: Option<CopyDestination>) -> bool;
    /// `extractWithChild(child, selection, destination)` (base false).
    fn extract_with_child(&self, node: ElementView<'_>, child: NodeKey,
                          selection: Option<&Selection>, destination: CopyDestination) -> bool;
    /// `getIndent()`. The base returns `ElementData::indent`. ListItemNode overrides it to
    /// count list nesting.
    fn indent(&self, node: ElementView<'_>) -> u32;

    // ---- mutating hooks (associated fns; `tx` holds the data)
    /// `splice(start, deleteCount, nodesToInsert)` (`LexicalElementNode.ts:459`). The base is
    /// `Transaction::default_splice`. Root and ListNode override it.
    fn splice(tx: &mut Transaction<'_>, this: Id<Self>, start: ChildIndex, delete_count: u32,
              nodes: &[NodeKey]) -> Result<(), Error>;
    /// `append(...nodes)`. The base calls the virtual `tx.splice(this, size, 0, nodes)`, as
    /// upstream's `this.splice` does. ListItemNode overrides it.
    fn append(tx: &mut Transaction<'_>, this: Id<Self>, nodes: &[NodeKey]) -> Result<(), Error>;
    /// `setIndent(level)`. The base writes `ElementData::indent`. ListItemNode overrides it.
    fn set_indent(tx: &mut Transaction<'_>, this: Id<Self>, indent: u32) -> Result<(), Error>;
    /// `insertNewAfter(selection, restoreSelection)` (`LexicalElementNode.ts:680`). The base
    /// returns `Ok(None)`. `selection` names the selection upstream passes: usually
    /// `Active`, but `$splitNodeAtPoint` passes a detached element-point selection with
    /// format 0 and style "" (`LexicalSelection.ts:3389`), so Paragraph/Heading read
    /// `tx.range_at(selection)`, never the active one. `insert_after(.., restore_selection)`
    /// inside the hook still adjusts only the active selection (§7.6).
    fn insert_new_after(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot,
                        restore_selection: bool) -> Result<Option<NodeKey>, Error>;
    /// `collapseAtStart(selection)` (`:700`, called from `$collapseAtStart(this, …)`,
    /// `LexicalSelection.ts:2041`). The base returns `Ok(false)`.
    fn collapse_at_start(tx: &mut Transaction<'_>, this: Id<Self>, selection: SelectionSlot)
        -> Result<bool, Error>;
}
```

#### `TextNode`

```rust
pub trait TextNode: NodeType<Kind = TextKind> {
    /// `TextBase` for `Text`; `Text` (or another registered text type) for every subclass.
    type Parent: TextNode;
    fn as_parent(&self) -> &Self::Parent;
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent>;

    common_node_hooks!(TextView);

    /// `canInsertTextBefore()` (Text: true; Tab: false; Hashtag overrides).
    fn can_insert_text_before(&self, node: TextView<'_>) -> bool;
    /// `canInsertTextAfter()` (Text: true; Tab: false).
    fn can_insert_text_after(&self, node: TextView<'_>) -> bool;
    /// `canHaveFormat()` (Text: true; CodeHighlightNode: false).
    fn can_have_format(&self, node: TextView<'_>) -> bool;
    /// `isTextEntity()` (Text: false; Hashtag: true).
    fn is_text_entity(&self, node: TextView<'_>) -> bool;
    /// The base `TextData` for a freshly created node. Text: empty. Tab: `"\t"` with
    /// UNMERGEABLE (`LexicalTabNode.ts` constructor).
    fn initial_text_data(&self) -> TextData;

    // Setter overrides. `setTextContent`/`spliceText`/`setDetail`/`setMode`/`setFormat` are
    // methods any subclass may override; these are the override points. The default
    // delegates to Parent; `Text` accepts everything.
    /// `setTextContent(text)`: returns the text to store. Tab returns `"\t"` (upstream's
    /// devInvariant becomes `Error::TabSetTextContent` only when the request is neither
    /// `"\t"` nor `""`).
    fn coerce_text_content<'text>(&self, node: TextView<'_>, requested: &'text str) -> Result<Cow<'text, str>, Error>;
    /// `spliceText(offset, delCount, newText)`. Tab allows only the no-op shapes, otherwise
    /// `Error::TabSpliceText`.
    fn check_splice_text(&self, node: TextView<'_>, range: Range<Utf16Offset>, insert: &str) -> Result<SpliceText, Error>;
    /// `setDetail(detail)`: `Ok(None)` keeps the current value. Tab: `Err(TabSetDetail)`
    /// unless the request is UNMERGEABLE, then `Ok(None)`.
    fn coerce_detail(&self, node: TextView<'_>, requested: TextDetail) -> Result<Option<TextDetail>, Error>;
    /// `setMode(mode)`. Tab: `Err(TabSetMode)` unless Normal, then `Ok(None)`.
    fn coerce_mode(&self, node: TextView<'_>, requested: TextMode) -> Result<Option<TextMode>, Error>;
    /// `setFormat(format)`. CodeHighlightNode returns `Ok(None)` (format is ignored).
    fn coerce_format(&self, node: TextView<'_>, requested: TextFormat) -> Result<Option<TextFormat>, Error>;

    /// `selectionTransform(prevSelection, nextSelection)` (base no-op). Runs during flush
    /// (§8.1) for the anchor/focus text nodes of the active range selection. The previous
    /// selection is `tx.previous_selection()` and the next one `tx.selection()`; taking either
    /// as a parameter would alias `&mut tx` (R2-49).
    fn selection_transform(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<(), Error>;
}

/// Outcome of `check_splice_text`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SpliceText { Apply, Skip }
```

#### `DecoratorNode` and `LineBreakNode`

```rust
pub trait DecoratorNode: NodeType<Kind = DecoratorKind> {
    /// `DecoratorBase`, or another registered decorator type.
    type Parent: DecoratorNode;
    fn as_parent(&self) -> &Self::Parent;
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent>;

    common_node_hooks!(DecoratorView);

    /// `isInline()` (base true).
    fn is_inline(&self, node: DecoratorView<'_>) -> bool;
    /// `isIsolated()` (base false).
    fn is_isolated(&self, node: DecoratorView<'_>) -> bool;
    /// `isKeyboardSelectable()` (base true).
    fn is_keyboard_selectable(&self, node: DecoratorView<'_>) -> bool;
    /// `getTextContent()` (LexicalNode base `''`). Macro's mention nodes override it.
    fn text_content(&self, node: DecoratorView<'_>) -> Cow<'_, str>;
    // decorate(): view-side. The view renders from the Diff's decorator props (§11).
    // excludeFromCopy is not a decorator hook: upstream never calls it on decorators.
}

/// The LineBreak kind. Only the common hooks; `LineBreak` is the only implementor shipped. A
/// JS subclass of LineBreakNode would implement this.
pub trait LineBreakNode: NodeType<Kind = LineBreakKind> {
    type Parent: LineBreakNode;
    fn as_parent(&self) -> &Self::Parent;
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent>;

    common_node_hooks!(LineBreakView);
}
```

A three-level chain, as S3 writes it (compiled in the probe):

```rust
impl NodeType for Comment { const TYPE: &'static str = "comment"; type Kind = ElementKind; /* … */ }
impl ElementNode for Comment {
    type Parent = Mark;                       // Mark: ElementNode with Parent = ElementBase
    fn as_parent(&self) -> &Mark { &self.mark }
    fn as_parent_mut(&mut self) -> Option<&mut Mark> { Some(&mut self.mark) }
    // Overrides one hook; every other one inherits Mark's, then ElementBase's.
    fn remove(tx: &mut Transaction<'_>, this: Id<Self>, preserve: bool) -> Result<(), Error> {
        /* Comment-specific work */
        <Mark as ElementNode>::remove(tx, this.upcast(), preserve)   // super.remove()
    }
}
```

### 3.3 Built-in node types

All are registered by `EditorBuilder::new()`, in upstream's order: Root, Text, LineBreak,
Tab, Paragraph, Artificial (`LexicalEditor.ts:791`).

Every registered node struct is a braced struct, even when it has no fields
(`pub struct Paragraph {}`). Serde then writes it as a JSON object and reads it from one,
ignoring unknown keys. A unit struct would serialize as `null`. Construct the built-ins
with `Paragraph::default()` and so on. Every built-in returns `Some(Self::default())` from
`NodeType::default_node`. The base markers are unit structs and are never serialized.

S2: NODE-01..NODE-20 (NODE-02 `<br>` import, NODE-13 decorator GC and the DOM rows are view or
S3 `lexical_html`; NODE-09 is `InsertNonBlockIntoRoot`, §7.4; NODE-12 block decorators at root
are allowed by Root's `splice`; NODE-14/15 registration order below).

```rust
/// `RootNode`, type "root", class "RootNode". Key is always `NodeKey::ROOT`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct Root {}
/// ElementNode overrides: `collapse_at_start` → Ok(true); `splice` → each inserted node
/// must be Element or Decorator, else Error::RootSpliceNonBlock, then default_splice;
/// the common hooks `remove`, `replace`, `insert_before`, `insert_after` →
/// Error::RemoveRoot / ReplaceRoot / InsertBeforeRoot / InsertAfterRoot. NodeType
/// override: `import` updates the existing root in place (`RootNode.importJSON`) and
/// returns `NodeKey::ROOT`.
/// `getTopLevelElementOrThrow` on root → Error::RootNotTopLevel (in Read).

/// `ParagraphNode`, type "paragraph". `insert_new_after` (`LexicalParagraphNode.ts:130`: new
/// paragraph with `tx.range_at(selection)`'s format/style as text_format/text_style, plus
/// this paragraph's direction, format and style, then `insert_after(.., restore_selection)`);
/// `collapse_at_start` (empty, or whitespace-only first text child: select the next sibling
/// and remove, else the previous one, else false); `adjust_export_json` (the
/// textFormat/textStyle fallback, #7971).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct Paragraph {}

/// `TextNode`, type "text", class "TextNode". `Parent = TextBase`; every TextNode
/// subclass has `Text` in its chain.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct Text {}

/// `TabNode`, type "tab", Parent = Text. `initial_text_data` = "\t" + UNMERGEABLE.
/// The coerce_* overrides and can_insert_text_before/after = false, as upstream.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct Tab {}

/// `LineBreakNode`, type "linebreak", `Parent = LineBreakBase`. Text content "\n"; always inline.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct LineBreak {}

/// `ArtificialNode__DO_NOT_USE`, type "artificial". Registered for parity (HTML import
/// uses it). A plain element with no overrides.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct Artificial {}

/// Base markers (`IS_MARKER = true`, `Parent = Self`). Not registered; `TYPE` is "" and
/// registering one fails with BuildError::BaseMarkerRegistered.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct ElementBase;
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct TextBase;
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct DecoratorBase;
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct LineBreakBase;
```

### 3.4 Method inventory: every upstream node method → Rust

S2: EL-01..EL-21, TX-01..TX-15, NODE-01..NODE-20, ID-01..ID-12.

"Hook" means an overridable trait method (§3.2). "Read" means a method on
`StateRef`/`Read` (§5). "Tx" means a `Transaction` method (§7). `E`/`T` mean the `ElementMut`
and `TextMut` handles (§7.5). "View" means the method stays on the JS/native view side
(DOM, React).

#### `LexicalNode` (`LexicalNode.ts`)

| # | Upstream | Rust | Notes |
| --- | --- | --- | --- |
| 1 | `static getType()` | `NodeType::TYPE` | |
| 2 | `static clone(data)` | `Clone` on the struct | the framework clones links, base and state |
| 3 | `$config()` | `NodeType::REQUIRED_STATE`, `HAS_LANGUAGE_FIELD`, `static_transform`, the kind trait's `Parent` | |
| 4 | `config(type, config)` | n/a | JS sugar for writing `$config` |
| 5 | `afterCloneFrom(prev)` | `Clone` + Hook `NodeType::after_clone` | field copying is `Clone`; link copying is internal; extra side effects go in `after_clone` (CR-16) |
| 6 | `resetOnCopyNodeFrom(original)` | common Hook `reset_on_copy(tx, this, original)` | |
| 7 | `static importDOM` | View (and future lexical_html import, D4) | |
| 8 | `constructor(key?)` | struct literal + `Tx::create` | keys are never passed in |
| 9 | `getType()` | Read `type_name(key)` | |
| 10 | `isInline()` | Read `is_inline(key)` → kind dispatch (Element/Decorator hooks; Text and LineBreak always true) | base LexicalNode throws; unreachable in Rust |
| 11 | `isAttached()` | Read `is_attached(key)` | |
| 12 | `isSelected(selection?)` | Read `is_selected(key, selection: Option<&Selection>)` (None → the active one) | |
| 13 | `getKey()` | the key itself | |
| 14 | `getIndexWithinParent()` | Read `index_within_parent(key) -> Option<ChildIndex>` | -1 → None |
| 15 | `getParent()` | Read `parent(key)` | |
| 16 | `getParentOrThrow()` | Read `parent_or_err(key)` | Error::MissingParent |
| 17 | `getTopLevelElement()` | Read `top_level_element(key) -> Result<Option<NodeKey>>` | Err(RootChildNotBlock) when the child of a root or shadow root on the path is not an element (a decorator is allowed only when it is `key` itself); inline elements directly under root return Ok (`LexicalNode.ts:797-801`, R2-30) |
| 18 | `getTopLevelElementOrThrow()` | Read `top_level_element_or_err(key)` | Error::MissingTopLevelElement / RootNotTopLevel |
| 19 | `getParents()` | Read `ancestors(key)` iterator | |
| 20 | `getParentKeys()` | Read `ancestors(key)` (yields keys) | |
| 21 | `getPreviousSibling()` | Read `prev_sibling(key)` | |
| 22 | `getPreviousSiblings()` | Read `prev_siblings(key)` iterator (document order) | |
| 23 | `getNextSibling()` | Read `next_sibling(key)` | |
| 24 | `getNextSiblings()` | Read `next_siblings(key)` iterator | |
| 25 | `getCommonAncestor(node)` | Read `common_ancestor_element(a, b)` | the element-lifted form; `$getCommonAncestor` is `common_ancestor` |
| 26 | `is(node)` | `==` on keys | |
| 27 | `isBefore(node)` | Read `is_before(a, b)` | |
| 28 | `isParentOf(node)` | Read `is_parent_of(a, b)` | |
| 29 | `getNodesBetween(node)` | Read `nodes_between(a, b) -> Result<Vec<NodeKey>>` | |
| 30 | `isDirty()` | Tx `is_dirty_leaf(key)` | |
| 31 | `getLatest()` | n/a | keys always resolve against the current state |
| 32 | `getWritable()` | Tx `get_mut::<Node>` / `mark_dirty` | |
| 33 | `getTextContent()` | Read `text_content(key)` | |
| 34 | `getTextContentSize()` | Read `text_content_size(key) -> Utf16Offset` | |
| 35 | `createDOM` | View | |
| 36 | `updateDOM` | View | |
| 37 | `getDOMSlot` | View | |
| 38 | `exportDOM` | View, or lexical_html export | |
| 39 | `exportJSON()` | Read `export_json(key)` (one node, `children: []`; R2.1), Hook `adjust_export_json`; `exportNodeToJSON` (recursive) is `export_node(key)` | |
| 40 | `static importJSON(json)` | Hook `NodeType::import` (may return another type) + `import_json` (struct) + Tx `import_node` | |
| 41 | `updateFromJSON(json)` | Tx `update_from_json(key, json)` / `update_from_json_with` + Hook `NodeType::update_from_json` | virtual |
| 42 | `static transform()` | Hook `NodeType::static_transform` | |
| 43 | `remove(preserveEmptyParent?)` | Tx `remove(key, preserve_empty_parent)` (virtual) | |
| 44 | `replace(node, includeChildren?)` | Tx `replace(old, new, include_children) -> Result<NodeKey>` (virtual) | |
| 45 | `insertAfter(node, restoreSelection?)` | Tx `insert_after(anchor, node, restore_selection)` (virtual) | |
| 46 | `insertBefore(node, restoreSelection?)` | Tx `insert_before(…)` (virtual) | |
| 47 | `isParentRequired()` | Hook + Read `is_parent_required(key)` | |
| 48 | `createParentElementNode()` | Hook + Tx `create_parent_element(key)` | |
| 49 | `selectStart()` | Tx `select_start(key)` | kind dispatch, as Element/Text override upstream |
| 50 | `selectEnd()` | Tx `select_end(key)` | |
| 51 | `selectPrevious(anchor?, focus?)` | Tx `select_previous(key, Option<Utf16Offset>, Option<Utf16Offset>)` | |
| 52 | `selectNext(anchor?, focus?)` | Tx `select_next(…)` | |
| 53 | `markDirty()` | Tx `mark_dirty(key)` | |
| 54 | `reconcileObservedMutation` | View | |
| 55 | `$isLexicalNode(x)` | n/a | there are no foreign objects in Rust |
| 56 | module fn `$removeNode` | Tx `default_remove` | |
| 57 | module fn `insertRangeAfter(node, first, last?)` | Tx `insert_range_after(node, first, last: Option<NodeKey>)` | |
| 58 | `$isEphemeral` / `$markEphemeral` | n/a | a detached clone is a plain value in Rust (`NodeRecord`, §5) |

#### `ElementNode` (`nodes/LexicalElementNode.ts`)

| # | Upstream | Rust |
| --- | --- | --- |
| 1 | `getFormat()` | `ElementData::format.bits()` |
| 2 | `getFormatType()` | `ElementData::format` |
| 3 | `getStyle()` | `ElementData::style` |
| 4 | `getIndent()` | Read `indent(key)` (virtual, Hook `indent`) |
| 5 | `getChildren()` | Read `children(key)` iterator |
| 6 | `getChildrenKeys()` | Read `children(key)` |
| 7 | `getChildrenSize()` | Read `children_size(key)` |
| 8 | `isEmpty()` | Read `is_empty(key)` |
| 9 | `isDirty()` | Tx `is_dirty_element(key)` |
| 10 | `isLastChild()` | Read `is_last_child(key)` |
| 11 | `getAllTextNodes()` | Read `all_text_nodes(key)` iterator (upstream order: pre-order, text only) |
| 12 | `getFirstDescendant()` | Read `first_descendant(key)` |
| 13 | `getLastDescendant()` | Read `last_descendant(key)` |
| 14 | `getDescendantByIndex(i)` | Read `descendant_by_index(key, ChildIndex)` |
| 15 | `getFirstChild()` / `…OrThrow` | Read `first_child(key)` / `first_child_or_err` (Error::MissingFirstChild) |
| 16 | `getLastChild()` / `…OrThrow` | Read `last_child(key)` / `last_child_or_err` (Error::MissingLastChild) |
| 17 | `getChildAtIndex(i)` | Read `child_at_index(key, ChildIndex)` (walks from the nearer end, as upstream) |
| 18 | `getTextContent()` | Read `text_content(key)` (DOUBLE_LINE_BREAK between non-inline element children) |
| 19 | `getTextContentSize()` | Read `text_content_size(key)` (walks the subtree, as upstream; leaves are O(1)) |
| 20 | `getDirection()` | `ElementData::direction` |
| 21 | `getTextFormat()` | `ElementData::text_format` |
| 22 | `hasFormat(type)` | `ElementFormat::has_format` |
| 23 | `hasTextFormat(type)` | `ElementData::text_format.has(type)` |
| 24 | `getFormatFlags(type, align)` | `ElementData::text_format.toggled(type, align)` |
| 25 | `getTextStyle()` | `ElementData::text_style` |
| 26 | `select(anchor?, focus?)` | E `select(Option<ChildIndex>, Option<ChildIndex>)` |
| 27 | `selectStart()` / `selectEnd()` | Tx `select_start` / `select_end` |
| 28 | `clear()` | Tx `clear(key)` (removes each child via virtual `remove`) |
| 29 | `append(...nodes)` | Tx `append(parent, &[NodeKey])` (virtual, Hook `append`) |
| 30 | `setDirection(dir)` | E `set_direction(Option<TextDirection>)` |
| 31 | `setFormat(type)` | E `set_format(ElementFormat)` |
| 32 | `setStyle(style)` | E `set_style(&str)` |
| 33 | `setTextFormat(n)` | E `set_text_format(TextFormat)` |
| 34 | `setTextStyle(s)` | E `set_text_style(&str)` |
| 35 | `setIndent(n)` | Tx `set_indent(key, u32)` (virtual, Hook `set_indent`) |
| 36 | `splice(start, deleteCount, nodes)` | Tx `splice(parent, ChildIndex, u32, &[NodeKey])` (virtual, Hook `splice`) |
| 37 | `getDOMSlot` | View |
| 38 | `exportDOM` | View / lexical_html |
| 39 | `exportJSON()` | framework (§13.2, virtual getters), Hook `adjust_export_json` |
| 40 | `updateFromJSON(json)` | framework: NodeState, then `set_format`, virtual `set_indent`, `set_direction`, `set_text_format`, `set_text_style`, then Hook (§13.3) |
| 41 | `insertNewAfter(selection, restore)` | Hook `insert_new_after` + Tx `insert_new_after(key, slot, restore)` |
| 42 | `canIndent()` | Hook + Read `can_indent(key)` |
| 43 | `collapseAtStart(selection)` | Hook + Tx `collapse_at_start(key, slot)` |
| 44 | `excludeFromCopy(dest?)` | Hook + Read `exclude_from_copy(key, dest)` |
| 45 | `canReplaceWith(node)` | Hook + Read `can_replace_with(key, other)` |
| 46 | `canInsertAfter(node)` | Hook + Read `can_insert_after(key, other)` |
| 47 | `canBeEmpty()` | Hook + Read `can_be_empty(key)` |
| 48 | `canInsertTextBefore()` | Hook + Read `can_insert_text_before(key)` (any kind) |
| 49 | `canInsertTextAfter()` | Hook + Read `can_insert_text_after(key)` |
| 50 | `isInline()` | Hook + Read `is_inline(key)` |
| 51 | `isShadowRoot()` | Hook + Read `is_shadow_root(key)` |
| 52 | `canMergeWith(node)` | Hook + Read `can_merge_with(key, other)` |
| 53 | `extractWithChild(child, sel, dest)` | Hook + Read `extract_with_child(key, child, sel, dest)` |
| 54 | `canMergeWhenEmpty()` | Hook + Read `can_merge_when_empty(key)` |
| 55 | `reconcileObservedMutation` | View |
| 56 | `$isElementNode(x)` | Read `kind(key) == Some(NodeKind::Element)` / `is_element(key)` |

#### `TextNode` (`nodes/LexicalTextNode.ts`)

| # | Upstream | Rust |
| --- | --- | --- |
| 1 | `getFormat()` | `TextData::format` |
| 2 | `getDetail()` | `TextData::detail` |
| 3 | `getMode()` | `TextData::mode` |
| 4 | `getStyle()` | `TextData::style` |
| 5 | `isToken()` | `TextData::is_token` |
| 6 | `isComposing()` | Read `is_composing(key)` (key == composition key) |
| 7 | `isSegmented()` | `TextData::is_segmented` |
| 8 | `isDirectionless()` | `TextData::is_directionless` |
| 9 | `isUnmergeable()` | `TextData::is_unmergeable` |
| 10 | `hasFormat(type)` | `TextData::has_format` |
| 11 | `isSimpleText()` | Read `is_simple_text(key)`: `TYPE == "text" && mode == Normal && !absent(mode)` (an absent `mode` is `undefined` upstream, so `__mode === 0` is false: R2-06) |
| 12 | `getTextContent()` | Read `text_content(key)` / `TextData::text` |
| 13 | `getFormatFlags(type, align)` | `TextData::format_flags` |
| 14 | `canHaveFormat()` | Hook + Read `can_have_format(key)` |
| 15 | `isInline()` | always true |
| 16 | `createDOM` / `updateDOM` / `static importDOM` / `exportDOM` | View / lexical_html |
| 17 | `static importJSON` | Hook `NodeType::import` (default) |
| 18 | `updateFromJSON` | framework: NodeState first, then text, format, detail, mode, style, in upstream order (each through its coerce hook) |
| 19 | `exportJSON` | framework (§13.2) |
| 20 | `selectionTransform(prev, next)` | Hook `selection_transform` |
| 21 | `setFormat(format)` | T `set_format(TextFormat)` / `set_format_type(TextFormatType)` (Hook `coerce_format`) |
| 22 | `setDetail(detail)` | T `set_detail(TextDetail)` (Hook `coerce_detail`) |
| 23 | `setStyle(style)` | T `set_style(&str)` |
| 24 | `toggleFormat(type)` | T `toggle_format(TextFormatType)` |
| 25 | `toggleDirectionless()` | T `toggle_directionless()` |
| 26 | `toggleUnmergeable()` | T `toggle_unmergeable()` |
| 27 | `setMode(mode)` | T `set_mode(TextMode)` (no-op, and no dirty, when equal; Hook `coerce_mode`) |
| 28 | `setTextContent(text)` | T `set_text_content(&str)` (no-op when equal; Hook `coerce_text_content`) |
| 29 | `select(anchor?, focus?)` | T `select(Option<Utf16Offset>, Option<Utf16Offset>)` |
| 30 | `selectStart()` / `selectEnd()` | Tx `select_start` / `select_end` |
| 31 | `spliceText(offset, delCount, newText, moveSelection?)` | T `splice_text(Range<Utf16Offset>, &str, move_selection: bool)` (Hook `check_splice_text`; D-7 for negative offsets) |
| 32 | `canInsertTextBefore()` / `After()` | Hook + Read `can_insert_text_before/after(key)` |
| 33 | `splitText(...offsets)` | T `split_text(&[Utf16Offset]) -> Result<Vec<NodeKey>>` |
| 34 | `mergeWithSibling(target)` | T `merge_with_sibling(target: NodeKey) -> Result<NodeKey>` |
| 35 | `isTextEntity()` | Hook + Read `is_text_entity(key)` |
| 36 | `$createTextNode(text)` | Tx `create_text(&str) -> Result<Id<Text>>` (with replacement) |
| 37 | `$isTextNode(x)` | Read `is_text(key)` |

#### `DecoratorNode`, `RootNode`, `ParagraphNode`, `LineBreakNode`, `TabNode`, `ArtificialNode`

| Class | Method | Rust |
| --- | --- | --- |
| DecoratorNode | `decorate(editor, config)` | View (rendered from Diff props) |
| DecoratorNode | `isIsolated()` | Hook + Read `is_isolated(key)` |
| DecoratorNode | `isInline()` | Hook + Read `is_inline(key)` |
| DecoratorNode | `isKeyboardSelectable()` | Hook + Read `is_keyboard_selectable(key)` |
| DecoratorNode | `getTextContent()` (inherited) | Hook `DecoratorNode::text_content` |
| DecoratorNode | `$isDecoratorNode` | Read `is_decorator(key)` |
| RootNode | `getType` / `clone` / constructor | `Root` |
| RootNode | `getTopLevelElementOrThrow()` | Error::RootNotTopLevel |
| RootNode | `getTextContent()` (`__cachedText`) | Read `text_content(ROOT)`, memoized per committed snapshot (§5.4) |
| RootNode | `remove` / `replace` / `insertBefore` / `insertAfter` | errors (§3.3) |
| RootNode | `updateDOM` | View |
| RootNode | `splice` | Hook override (block-only check) |
| RootNode | `static importJSON` | the framework updates the existing root in place |
| RootNode | `collapseAtStart()` | Hook → Ok(true) |
| RootNode | `$createRootNode` (internal) / `$isRootNode` | n/a (root always exists) / `key == NodeKey::ROOT` |
| ParagraphNode | `getType` / `clone` | `Paragraph` |
| ParagraphNode | `createDOM` / `updateDOM` / `importDOM` / `exportDOM` | View / lexical_html |
| ParagraphNode | `static importJSON` / `exportJSON` | framework + `adjust_export_json` |
| ParagraphNode | `insertNewAfter` / `collapseAtStart` | Hooks (§3.3) |
| ParagraphNode | `$createParagraphNode()` | `tx.create(Paragraph::default())` |
| ParagraphNode | `$isParagraphNode(x)` | `view.is::<Paragraph>(key)` (ancestry, as `instanceof`) |
| LineBreakNode | `getType` / `clone` / constructor | `LineBreak` |
| LineBreakNode | `getTextContent()` | "\n" |
| LineBreakNode | `createDOM` / `updateDOM` / `importDOM` | View |
| LineBreakNode | `isInline()` | true |
| LineBreakNode | `static importJSON` | framework |
| LineBreakNode | `$createLineBreakNode` / `$isLineBreakNode` | `tx.create(LineBreak::default())` / `view.is_line_break(key)` |
| TabNode | `getType` / `clone` / constructor | `Tab` + `initial_text_data` |
| TabNode | `importDOM` (null) / `createDOM` | View |
| TabNode | `static importJSON` | framework (`updateFromJSON` routes `setDetail`/`setMode` through the Tab coercions, so `detail: 2, mode: "normal"` imports) |
| TabNode | `setTextContent` / `spliceText` / `setDetail` / `setMode` | Hooks `coerce_text_content` / `check_splice_text` / `coerce_detail` / `coerce_mode` |
| TabNode | `canInsertTextBefore` / `After` | Hooks → false |
| TabNode | `$createTabNode` / `$isTabNode` | `tx.create(Tab::default())` / `view.is::<Tab>(key)` |
| ArtificialNode__DO_NOT_USE | all | `Artificial` |

Counts: LexicalNode 58, ElementNode 56, TextNode 37, the other six classes 34. **185 method
and helper rows in total.** Each one maps to a Rust item or is marked view-side or n/a.
Selection members are inventoried in §9.5 (Point 5, BaseSelection 11, RangeSelection 27,
NodeSelection 16) and caret members in §10.3.

### 3.5 Registration vtable (crate-private)

`EditorBuilder::node::<Node>()` monomorphizes a `NodeVTable` through `<Node::Kind as
KindOf<Node>>::vtable()`: plain `fn` pointers, one per predicate and hook in §3.2 (common and
kind-specific), plus `import`, `import_json`, `update_from_json`, `export`, `after_clone` and
`default_node` (for `create_resolved`; `None` gives `Error::NoDefault`, R2-43). Each pointer
downcasts `&dyn AnyNodeData` to `Node` and calls the trait method. Hooks that take `this:
Id<Node>` get `Id::new_unchecked(key)`, after the dispatcher has checked `type_index`. The
chain-derived data is computed by generic walks over the kind trait's `Parent` that stop at
the first marker (`IS_MARKER`): the concatenated `REQUIRED_STATE`, the OR of
`HAS_LANGUAGE_FIELD`, the ancestry `TypeId`s, the per-level `static_transform` list, and two
projections (R2-51):

```rust
// One instance per (registered type); recursion ends at the marker at run time, and
// monomorphization ends because a marker's Parent is itself.
project:     for<'a> fn(&'a dyn Any, TypeId) -> Option<&'a dyn Any>,          // get::<Ancestor>
project_mut: for<'a> fn(&'a mut dyn Any, TypeId) -> Option<&'a mut dyn Any>,  // get_mut::<Ancestor>
```

`project` downcasts to `Node`, returns it if `TypeId::of::<Node>()` is the target, and
otherwise recurses into `as_parent()`; `project_mut` does the same through `as_parent_mut()`
and returns `None` (→ `Error::NoMutableUpcast`) at a marker. There are no boxed closures and
no `dyn` hook traits in the vtable; the only boxed closures in the registry are the
`node_trait` projections (§4.2). The stack holds no capturing state, so nothing needs `Rc`.
Virtual dispatch from `Transaction::splice(key, …)` reads `nodes[key].type_index →
registry.vtables[i].splice`. A foreign type (§4.4, feature `foreign-nodes`) gets a vtable of
fixed `fn` pointers that read its `Arc<dyn ForeignHooks>` from the `RegisteredNode`.

---

## 4. Registry, builder, editor

### 4.1 Registry

S2: CFG-01..CFG-11, ID-12 (type strings unique per editor), NODE-14/NODE-15 (always-registered
types), LST-04 (`registerMutationListener`'s class resolution, via `resolve_replacements`).

```rust
/// Dense index of a registered type (registration order, starting at 0 for Root).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct NodeTypeIndex(u16);

/// Immutable after `build()`. Shared as `Arc<Registry>` by every EditorState of the editor.
/// Replaces `editor._nodes: RegisteredNodes` and `getStaticNodeConfig`.
pub struct Registry { /* types: Vec<RegisteredNode>, by_name: HashMap<&'static str, NodeTypeIndex>,
                         vtables, transforms: Vec<Vec<ErasedTransform>>, plugins, state_layout */ }

impl Registry {
    /// `getRegisteredNode(editor, type)`.
    pub fn get(&self, type_name: &str) -> Option<&RegisteredNode>;
    /// `getRegisteredNodeOrThrow`: Error::UnregisteredNodeType.
    pub fn get_or_err(&self, type_name: &str) -> Result<&RegisteredNode, Error>;
    /// `editor.hasNode(Klass)`.
    pub fn has<Node: NodeType>(&self) -> bool;
    /// `editor.hasNodes([...])` is `has` called per type.
    pub fn index_of<Node: NodeType>(&self) -> Option<NodeTypeIndex>;
    pub fn node(&self, index: NodeTypeIndex) -> &RegisteredNode;
    /// All registered types in registration order. The view uses it to map `type_index` in
    /// the Diff to names.
    pub fn types(&self) -> impl ExactSizeIterator<Item = &RegisteredNode>;
    /// The view's type table (R2.1, S12 §0.2): one row per `type_index`, computed once at
    /// `build()` from each type's `flag_probe`. The session exports it once per editor
    /// (S7 `typeTable()`); the view runs EVT-14/15 (§15.4) from it and the mirror.
    pub fn type_table(&self) -> &[TypeTableRow];
    /// `resolveRegisteredNodeAfterReplacements`: follows `replaced_by` transitively.
    pub fn resolve_replacements(&self, index: NodeTypeIndex) -> NodeTypeIndex;
}

/// Several registries are normal: an editor is built per configuration. lexical-service's
/// export routes (no replacements) and its composers (with replacements) are two builders,
/// so two `Registry` values (S3 CR-17); `EditorState` carries its own registry, and
/// `set_editor_state` rejects a state from another one (`Error::ForeignEditorState`).

/// Public facts about one registered type. Replaces upstream's `RegisteredNode`
/// `{klass, transforms, replace, replaceWithKlass, exportDOM, sharedNodeState}`.
pub struct RegisteredNode {
    pub index: NodeTypeIndex,
    pub type_name: &'static str,
    pub class_name: &'static str,
    pub kind: NodeKind,
    /// `TypeId`s of Self, Parent, Parent's parent, … (excluding markers). Backs `is::<T>`,
    /// i.e. `instanceof`.
    pub ancestry: Vec<TypeId>,
    /// `replaceWithKlass`: when set, `create::<Self>` builds this type instead. One level;
    /// `Registry::resolve_replacements` follows it transitively.
    pub replaced_by: Option<NodeTypeIndex>,
    /// The flat and nested NodeState keys this type declares (`sharedNodeState`).
    pub state_layout: StateLayout,
    /// `HAS_LANGUAGE_FIELD` ORed along the chain (R2-20).
    pub has_language_field: bool,
    /// The type-table flags (R2.1); `None` when `FLAGS_PER_INSTANCE` is set on the chain.
    pub flags: Option<TypeFlags>,
    /// Feature `foreign-nodes` only: the runtime hooks of a type registered with
    /// `EditorBuilder::foreign_node` (§4.4). `None` for every Rust type.
    #[cfg(feature = "foreign-nodes")]
    pub foreign: Option<Arc<dyn ForeignHooks>>,
}

/// The per-type answers of the predicates the view evaluates without a crossing (§15.4
/// EVT-14/15, S12 §1.6). A field that does not apply to the kind is `false`
/// (`is_keyboard_selectable`/`is_isolated` are decorator hooks; `is_shadow_root` is an element
/// hook; text is always inline).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct TypeFlags {
    pub is_inline: bool,
    pub can_insert_text_before: bool,
    pub can_insert_text_after: bool,
    pub is_keyboard_selectable: bool,
    pub is_isolated: bool,
    pub is_shadow_root: bool,
}

/// One row of `Registry::type_table`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TypeTableRow {
    pub index: NodeTypeIndex,
    pub type_name: &'static str,
    pub kind: NodeKind,
    /// `None`: per-instance (`FLAGS_PER_INSTANCE`); the view asks the type's `NodeView`.
    pub flags: Option<TypeFlags>,
}
```

### 4.2 Builder

```rust
/// How closely the editor emulates an attached DOM editor. Upstream branches on
/// `editor._headless || rootElement === null` (`LexicalUpdates.ts:524, 999`). There is no
/// default: every builder names its mode (Q9), and nothing switches it later.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EditorMode {
    /// lexical-service, ai-editing-worker, servers. There is no reconciler, so element
    /// `textFormat`/`textStyle` are never synced from the first text child (D-3), and each
    /// update starts from the committed selection (`LexicalUpdates.ts:1001`).
    Headless,
    /// A view applies Diffs. The commit runs the model caches the reconciler used to write
    /// (§8.6). Each fresh update takes its selection from the view (§15, F-17).
    ViewAttached,
}

pub struct EditorBuilder { /* … */ }

impl EditorBuilder {
    /// Registers Root, Text, LineBreak, Tab, Paragraph and Artificial (`createEditor`).
    pub fn new(mode: EditorMode) -> EditorBuilder;
    /// `nodes: [Klass]`. Order is kept; it sets each type's index and the order of static
    /// transforms.
    pub fn node<Node: NodeType>(self) -> EditorBuilder;
    /// `nodes: [{replace: Original, with, withKlass: Replacement}]`. `Replacement`'s parent
    /// chain (`ParentOf`, walked to the marker) must reach `Original` (checked at build:
    /// BuildError::ReplacementNotSubtype).
    /// `with` converts the freshly constructed original (`$applyNodeReplacement`). It is a
    /// plain fn pointer.
    pub fn replace<Original: NodeType, Replacement: NodeType>(self, with: fn(Original) -> Replacement)
        -> EditorBuilder;
    /// `editor.registerNodeTransform(Klass, fn)`. Runs for nodes whose exact type is `Node`,
    /// or is `Node`'s **direct** replacement (`replaceWithKlass`, one level, not transitive:
    /// `LexicalEditor.ts:1358-1365`). Order: static transforms first, then these in call order.
    pub fn transform<Node: NodeType>(self, transform: TransformFn<Node>) -> EditorBuilder;
    /// One transform for many registered types (CR-14, nodeId). Resolved at `build()`, so it
    /// also covers types registered after this call. For each covered type it sits in
    /// builder call order relative to that type's `.transform::<T>` calls.
    pub fn transform_each(self, transform: AnyTransformFn, scope: TransformScope) -> EditorBuilder;
    /// Registers a plugin. Its `commands()` (each with its own priority and placement) are
    /// built into per-command listener lists at `build()` (§14.2). Registration order
    /// within a priority level is the order of `plugin()` calls, and it is also the order in
    /// which `Plugin::after_commit` runs (§14.2).
    pub fn plugin(self, plugin: impl Plugin) -> EditorBuilder;
    /// Typed, transaction-staged state for transforms and plugins (§14.3).
    pub fn extension_state<State: ExtensionState>(self, initial: State) -> EditorBuilder;
    /// TableSelection behaviour (§9.1, CR-7). Without it, any `Selection::Table` operation is
    /// `Error::UnsupportedSelection`.
    pub fn table_selection_hooks(self, hooks: &'static dyn TableSelectionHooks) -> EditorBuilder;
    /// Package-level virtual methods (F-41): lets `Read::get_dyn::<dyn Trait>(key)` reach the
    /// most-derived implementor. `Node` may be an unregistered abstract ancestor
    /// (`MediaNode`). Storage (R2-42): `get_dyn::<Trait>` does not know `Node`, so the typed
    /// projection is erased into a closure over `&dyn Any`, built here as
    /// `move |any| any.downcast_ref::<Node>().map(project)`. It is stored as
    /// `Box<dyn Any + Send + Sync>` holding a
    /// `Box<dyn for<'a> Fn(&'a dyn Any) -> Option<&'a Trait> + Send + Sync>`, keyed by
    /// `(TypeId::of::<Node>(), TypeId::of::<Trait>())`; `get_dyn` downcasts the outer box to
    /// that concrete box type, which it can name from `Trait` alone. Lookup walks the stored
    /// type's ancestry (own type first, `RegisteredNode::ancestry`); at the first ancestor
    /// with an entry it projects the data to that ancestor with the vtable's `project` (§3.5)
    /// and applies the closure. So a `CustomCodeNode` reaches a projection registered for
    /// `CodeNode`. No `unsafe`. The closure captures only the `fn` pointer; it is
    /// configuration, not a stored callback.
    pub fn node_trait<Node: NodeType, Trait: ?Sized + 'static>(self, project: fn(&Node) -> &Trait) -> EditorBuilder;
    /// Where keys come from (§2.1). Default `KeySource::PerEditor`.
    pub fn key_source(self, source: KeySource) -> EditorBuilder;
    /// The engine and OS the editor serves (§15 `ViewHost`; R2.1, S12 §0.2). Default
    /// `ViewHost::HEADLESS` (upstream's `CAN_USE_DOM === false`: every `IS_*` false). Plugins
    /// read it with `Transaction::view_host()` (Macro's `native-ios-backspace` and
    /// `word-navigation`, upstream's `IS_IOS`/`IS_ANDROID`/`IS_APPLE` branches in rich-text);
    /// EditorCore reads the engine for composition characters. Fixed for the editor's life.
    pub fn view_host(self, host: ViewHost) -> EditorBuilder;
    /// Opt-in (D-23, off unless called): JSON whose `type` is not registered imports as an
    /// opaque framework record that exports its JSON verbatim (children re-exported), instead
    /// of `Error::UnknownSerializedType`. Ruling (R1 consistency pass): **on** for every
    /// collaborative document session (S7 `EditorSurface` and its comment-fork editor), so a
    /// Loro peer keeps node types written by newer clients; **off** for headless/server
    /// editors (lexical-service, the S3 `export_registry()`/`headless_editor()` builders),
    /// which throw on unknown types as upstream does. The switch follows the role, not
    /// `EditorMode`: a headless editor inside a `document_session` (ai-editing-worker) is a
    /// collaborative session and turns it on.
    pub fn opaque_unknown_types(self, enabled: bool) -> EditorBuilder;
    /// `CreateEditorArgs.editorState`: initial state, parsed at build (no transforms run,
    /// matching upstream, which installs it as pending with FULL_RECONCILE). `build()` then
    /// runs the `Plugin::after_commit` rounds (§14.2) against a synthetic commit whose `prev`
    /// is the empty state and whose mutations mark every node Created (upstream's
    /// `registerMutationListener` default `skipInitialization: false`). Their commits are
    /// applied, and kept for `Editor::take_initial_commits` (R2.1, S11 §5.1): a Loro session
    /// must project the ids the initial round stamped. A failure is `BuildError::InitialState`.
    pub fn initial_state(self, json: SerializedEditorState) -> EditorBuilder;
    /// Feature `foreign-nodes` (dev-only; §4.4): registers a node type defined at run time.
    #[cfg(feature = "foreign-nodes")]
    pub fn foreign_node(self, node_type: ForeignNodeType) -> EditorBuilder;
    pub fn build(self) -> Result<Editor, BuildError>;
}

/// A type-erased transform (`transform_each`). `key` is the dirty node.
pub type AnyTransformFn = fn(&mut Transaction<'_>, NodeKey) -> Result<(), Error>;

/// Which registered types a `transform_each` covers.
#[derive(Clone, Copy, Debug)]
pub enum TransformScope {
    /// Every registered type.
    All,
    /// Every registered type except Root (nodeId's JS plugin never stamps the root;
    /// audit B-F2b-13).
    AllExceptRoot,
    /// The named types (`"paragraph"`, …), and the direct replacement of each. An unknown
    /// name is `BuildError::TransformForUnregisteredType`.
    Types(&'static [&'static str]),
}

/// `build()` failures. All configuration errors are reported here, not at first use.
#[derive(Debug, thiserror::Error)]
pub enum BuildError {
    #[error("node type {type_name} is registered twice ({first} and {second})")]
    DuplicateNodeType { type_name: &'static str, first: &'static str, second: &'static str },
    #[error("{replacement} doesn't extend the {original}")]   // LexicalEditor.ts:832
    ReplacementNotSubtype { replacement: &'static str, original: &'static str },
    #[error("transform registered for unregistered node type {type_name}")]
    TransformForUnregisteredType { type_name: &'static str },
    #[error("base marker {class_name} cannot be registered")]
    BaseMarkerRegistered { class_name: &'static str },
    #[error("$setState: State key collision {key:?} detected in {class_name} node with type {type_name}. Only one StateConfig with a given key should be used on a node.")]
    StateKeyCollision { key: &'static str, class_name: &'static str, type_name: &'static str },
    #[error("extension state {type_name} registered twice")]
    DuplicateExtensionState { type_name: &'static str },
    /// Feature `foreign-nodes`: `ForeignNodeType::extends` is unknown or of another kind.
    #[cfg(feature = "foreign-nodes")]
    #[error("foreign node type {type_name} extends unknown or mismatched type {extends}")]
    UnknownForeignParent { type_name: Arc<str>, extends: &'static str },
    /// A type has neither a `flag_probe` nor `FLAGS_PER_INSTANCE` (R2.1, §3.2).
    #[error("node type {type_name} has no flag probe; implement NodeType::flag_probe or set FLAGS_PER_INSTANCE")]
    NoFlagProbe { type_name: &'static str },
    #[error(transparent)]
    InitialState(Box<Error>),
}
```

### 4.3 Editor

```rust
/// Owns the committed state, the registry, the key allocator, the composition key and the
/// committed extension state. There are no listeners and no DOM.
pub struct Editor { /* registry: Arc<Registry>, state: EditorState, keys: KeyAllocator,
                       composition_key: Option<NodeKey>, extensions: ExtensionStore, mode,
                       carried_tags: TagSet */ }

impl Editor {
    /// `EditorBuilder::new(mode)`.
    pub fn builder(mode: EditorMode) -> EditorBuilder;
    /// `getEditorState()`. Clone it for an O(1) snapshot.
    pub fn state(&self) -> &EditorState;
    pub fn registry(&self) -> &Arc<Registry>;
    pub fn mode(&self) -> EditorMode;
    /// Opens a transaction on a pending copy (O(1)). Upstream `$beginUpdate`. Its tag set
    /// starts from the carried tags (§8.8, F-5), then `options.tags`.
    pub fn transaction(&mut self) -> Transaction<'_>;
    pub fn transaction_with(&mut self, options: UpdateOptions) -> Transaction<'_>;
    /// `editor.update(fn, options)`, then synchronous commit (as `discrete: true`), then the
    /// `Plugin::after_commit` rounds (§14.2), whose commits land in `Commit::following`. On
    /// `Err` from `body`, flush or commit, the transaction drops and the state is unchanged.
    /// A failing follow-up round does not fail `update` (upstream routes it to `_onError`):
    /// it is rolled back and reported in `Commit::follow_up_error`.
    pub fn update<Value>(&mut self, body: impl FnOnce(&mut Transaction<'_>) -> Result<Value, Error>)
        -> Result<(Value, Commit), Error>;
    pub fn update_with<Value>(&mut self, options: UpdateOptions,
        body: impl FnOnce(&mut Transaction<'_>) -> Result<Value, Error>) -> Result<(Value, Commit), Error>;
    /// `update` with the caller's error type (F-38), for application code with its own
    /// error enum. Separate from `update` because a generic `Failure` would leave every
    /// `?`-only closure without an inferable error type.
    pub fn try_update<Value, Failure: From<Error>>(&mut self, options: UpdateOptions,
        body: impl FnOnce(&mut Transaction<'_>) -> Result<Value, Failure>) -> Result<(Value, Commit), Failure>;
    /// `editor.read(fn)` is `editor.state().view()`.
    /// `setEditorState(state, {tag})` (`LexicalEditor.ts:1537`): Error::SetEmptyEditorState if
    /// `state.is_empty_state()`. Commits with full_reconcile = true, dirty_elements = {root:
    /// AncestorOfDirty}, and the composition key cleared. It runs no transforms (upstream
    /// runs none). The state must come from this editor's registry
    /// (Error::ForeignEditorState). The key allocator is raised to `state.max_key()` so keys
    /// minted later cannot collide with the state's (F-47). Mutations come from the
    /// full-reconcile compare (§8.7). Runs the `after_commit` rounds. Inside a transaction
    /// use `Transaction::set_editor_state`.
    pub fn set_editor_state(&mut self, state: EditorState, tags: TagSet) -> Result<Commit, Error>;
    /// Runs the `Plugin::after_commit` rounds for a commit made through `editor.transaction()`
    /// + `tx.commit()` directly (`update`, `dispatch`, `set_editor_state` and EditorCore call
    /// it themselves). Fills `commit.following` and `commit.follow_up_error`.
    pub fn run_after_commit(&mut self, commit: &mut Commit);
    /// The follow-up commits `build()` made for `EditorBuilder::initial_state` (§14.2 rounds
    /// over the synthetic all-Created commit), oldest first; empty afterwards and when there
    /// was no initial state or nothing changed (R2.1, S11 §5.1). `EditorCore::new` drains it
    /// into `take_initial_output`.
    pub fn take_initial_commits(&mut self) -> Vec<Commit>;
    /// The listener table (R2.1, §14.2): per command kind, whether any Rust listener exists and
    /// at which priorities.
    pub fn listener_table(&self) -> &ListenerTable;
    /// `EditorBuilder::view_host`.
    pub fn view_host(&self) -> ViewHost;
    /// `parseEditorState(json | string)` (`LexicalUpdates.ts:422`): builds a state from JSON.
    /// Allocates keys, runs no transforms and no normalization, and leaves the selection
    /// None. Upstream catches errors with `_onError` and returns a half-built state; Rust
    /// returns Err (D-12).
    pub fn parse_editor_state(&mut self, json: &SerializedEditorState) -> Result<EditorState, Error>;
    pub fn parse_editor_state_str(&mut self, json: &str) -> Result<EditorState, Error>;
    /// `editor.dispatchCommand(cmd, payload)` outside an update: one transaction, flushed
    /// after every priority level that ran without a `Yes` (§14.2, F-4), then committed, then
    /// the `after_commit` rounds. A command no listener handles opens no transaction and
    /// returns a no-op commit (R2-17).
    pub fn dispatch(&mut self, command: &Command) -> Result<(Handled, Commit), Error>;
    /// `editor.isComposing()`.
    pub fn is_composing(&self) -> bool;
    pub fn composition_key(&self) -> Option<NodeKey>;
    /// `editor.toJSON()` → `{editorState: …}`.
    pub fn to_json(&self) -> SerializedEditor;
    /// Committed extension state (Error::UnknownExtensionState if not registered).
    pub fn extension<State: ExtensionState>(&self) -> Result<&State, Error>;
    /// The same, `None` when not registered (upstream's optional peer dependency).
    pub fn try_extension<State: ExtensionState>(&self) -> Option<&State>;
    /// `resetRandomKey()`: restarts key indices at 1 and bumps the generation (§2.1).
    /// `Err(Error::KeyResetWithNodes)` unless the committed state holds only the root, so
    /// one state never mixes generations (F-47). With `KeySource::Shared`, use
    /// `SharedKeyCounter::reset` instead.
    pub fn reset_key_counter(&mut self) -> Result<(), Error>;
}

/// `SerializedEditor`.
#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedEditor { pub editor_state: SerializedEditorState }
```

`LexicalEditor` member mapping (the class is a type-only export, so this table is
additional to §17):

| Upstream member | Rust |
| --- | --- |
| `isComposing()` | `Editor::is_composing` |
| `registerUpdateListener` | n/a: consume `Commit` |
| `registerEditableListener`, `setEditable`, `isEditable` | view-side; EditorCore takes `editable` in `CoreConfig` (§15) |
| `registerDecoratorListener`, `getDecorators` | `Effect::DecoratorsChanged`; decorator data via Diff |
| `registerTextContentListener` | `Commit::text_content_changed()` (on demand) / `Effect::TextContentChanged` |
| `registerRootListener`, `setRootElement`, `getRootElement`, `getElementByKey`, `focus`, `blur` | view-side |
| `registerCommand(cmd, fn, priority)` | `EditorBuilder::plugin` + `Plugin::commands` (per-command priority) + `Plugin::handle` |
| `registerMutationListener(Klass, fn, {skipInitialization})` | `Commit::mutations_of::<Node>()`. A listener that writes (`editor.update` inside it, Macro nodeId/peerId) is `Plugin::after_commit` (§14.2). Initialization (`'registerMutationListener'` tag) → `StateRef::nodes_of_type::<Node>()` (key creation order), or the synthetic all-Created commit of `EditorBuilder::initial_state` |
| `getRegisteredNode(Klass)` | `Registry::index_of::<Node>()` / `get` |
| `resolveRegisteredNodeAfterReplacements` | `RegisteredNode::replaced_by` (followed transitively) |
| `registerNodeTransform(Klass, fn)` | `EditorBuilder::transform` + `Transaction::mark_type_dirty` (D-9) |
| `hasNode(s)` | `Registry::has` |
| `dispatchCommand` | `Editor::dispatch` / `Transaction::dispatch` |
| `getKey()` | n/a (editor identity is the owning value) |
| `getEditorState` / `setEditorState` / `parseEditorState` | `state` / `set_editor_state` / `parse_editor_state` |
| `read(fn)` / `update(fn, opts)` | `state().view()` / `update_with`; `update` inside an update → `Transaction::queue_update` (§7.1) |
| `toJSON()` | `to_json` |
| `static version` | `lexical_model::LEXICAL_VERSION: &str = "0.45.0"` (the semantics version ported) |
| `_nodes`, `_dirtyLeaves`, `_dirtyElements`, `_cloneNotNeeded`, `_compositionKey`, `_updateTags`, `_pendingEditorState`, `_editorState`, `_updates` | internal: `Registry`, `Transaction` dirty sets, `Arc` uniqueness, `composition_key`, `TagSet` (+ `carried_tags`), `Transaction.pending`, `Editor.state`, the transaction's nested-update queue |

### 4.4 Runtime-defined node types (feature `foreign-nodes`, dev-only)

S4's Tier B shim runs upstream JS test suites whose node classes are written in JS
(`ForeignNode`, SCOPE D2, D-17). Those types have no Rust struct, so they cannot implement
`NodeType` (which needs a `const TYPE`). The feature `foreign-nodes` adds the one runtime
registration hook the conformance bridge needs (audit R2-4 B2). It is a dev-only feature:
only the dev-only `lexical_conformance_wasm` cdylib (S4 §2.8, `publish = false`) enables it,
no shipping crate may (a `cargo x deps` check denies it in `document_session_wasm`,
`document_session_ffi` and every service), and the decision "no stored callbacks" holds for
every shipped build. The hooks it stores are the one exception, and they exist only in that
build.

```rust
#[cfg(feature = "foreign-nodes")]
pub struct ForeignNodeType {
    /// `static getType()` of the JS class. Leaked to `&'static str` once at registration.
    pub type_name: Arc<str>,
    /// `klass.name`.
    pub class_name: Arc<str>,
    pub kind: NodeKind,
    /// The registered type it extends (`"paragraph"`, `"text"`, another foreign type), or
    /// `None` for a direct subclass of a base class. Its hooks are the fallback for every
    /// hook the JS class does not override, so `super.x()` reaches Rust behaviour.
    pub extends: Option<&'static str>,
    /// Flat and nested NodeState keys the class declares (`$config().stateConfigs`).
    pub required_state: Vec<RequiredState>,
    pub hooks: Arc<dyn ForeignHooks>,
}

/// One method per §3.2 hook. Every method is provided and returns `Override::Inherit`, which
/// makes the framework run the `extends` type's hook instead. The wasm bridge implements it
/// by calling the JS class's method when the JS class defines one.
#[cfg(feature = "foreign-nodes")]
pub trait ForeignHooks: Send + Sync + 'static {
    fn is_inline(&self, node: NodeView<'_>, data: &ForeignData) -> Override<bool> { Override::Inherit }
    fn can_be_empty(&self, node: NodeView<'_>, data: &ForeignData) -> Override<bool> { Override::Inherit }
    // … one per predicate in §3.2 …
    fn remove(&self, tx: &mut Transaction<'_>, key: NodeKey, preserve_empty_parent: bool)
        -> Override<Result<(), Error>> { Override::Inherit }
    // … one per mutator in §3.2, with `key: NodeKey` in place of `this: Id<Self>` …
}

#[cfg(feature = "foreign-nodes")]
pub enum Override<Value> { Inherit, Value(Value) }

/// The user-struct part of a foreign node: its own JSON fields, in insertion order.
/// `Read::foreign_data(key)` returns it; `get::<Node>` never matches a foreign node.
#[cfg(feature = "foreign-nodes")]
#[derive(Clone, PartialEq, Debug)]
pub struct ForeignData { pub fields: SerializedNode }
```

The registry builds a vtable of fixed `fn` pointers for a foreign type that read the
`Arc<dyn ForeignHooks>` from its `RegisteredNode::foreign` (§3.5). Build checks are the same
as for Rust types (`DuplicateNodeType`, `StateKeyCollision`), plus
`BuildError::UnknownForeignParent` when `extends` names no registered type or one of another
kind. JS callbacks are not `Send`. The conformance crate wraps
them in a newtype with `unsafe impl Send + Sync`, which is sound only on single-threaded
`wasm32-unknown-unknown`; it asserts `#[cfg(not(target_feature = "atomics"))]`, and that
`unsafe` lives in the dev-only crate, never in `lexical_model`.

The same feature carries the other run-time hooks the conformance host needs (R2.1, S4 §2.4
items 5-7, §2.8; S12 §2.4 R5-R7). Upstream tests register listeners, transforms and state
configs after `createEditor`, and drive one update across several JS calls; none of this
exists in a shipped build.

```rust
/// A transaction detached from its `&mut Editor` borrow, so `EditorHandle::begin_update` …
/// `commit` (S4 §2.8) can span several wasm calls without a self-referential handle. It holds
/// the pending state, dirty sets, tags, staged extension state, staged events, detached
/// selection slots and the nested-update queue. Dropping it rolls the update back, as
/// dropping the `Transaction` does. `Send + Sync` (it holds no editor reference).
#[cfg(feature = "foreign-nodes")]
pub struct PendingUpdate { /* the Transaction's owned fields + the CommitId it was opened at */ }

#[cfg(feature = "foreign-nodes")]
impl Transaction<'_> {
    /// Detaches the open update. No flush, no commit.
    pub fn suspend(self) -> PendingUpdate;
}

#[cfg(feature = "foreign-nodes")]
impl Editor {
    /// Re-attaches a suspended update. `Error::StaleSuspendedUpdate` when the editor
    /// committed (or set its state) after the update was opened; the update is dropped.
    pub fn resume(&mut self, update: PendingUpdate) -> Result<Transaction<'_>, Error>;
    /// `editor.registerCommand(cmd, fn, priority)` after build: inserted into that command's
    /// listener list at `registration.priority` and `placement`, after every listener already
    /// at that level (Before placements in front, as §14.2). Refreshes `listener_table()`.
    pub fn register_foreign_listener(&mut self, registration: CommandRegistration,
                                     listener: Arc<dyn ForeignListener>) -> ForeignListenerId;
    /// The unregister function upstream returns. Unknown ids are ignored.
    pub fn unregister_foreign_listener(&mut self, id: ForeignListenerId);
    /// `editor.registerNodeTransform(Klass, fn)` after build, for a registered type name
    /// (Rust or foreign). Runs after the type's build-time transforms, in registration order,
    /// under the §8.2 rules. The caller marks the type dirty with `Transaction::mark_type_dirty`
    /// in its next update, as upstream's `markNodesWithTypesAsDirty` does.
    pub fn register_foreign_transform(&mut self, type_name: &str, transform: Arc<dyn ForeignTransform>)
        -> Result<ForeignListenerId, Error>;
    pub fn unregister_foreign_transform(&mut self, id: ForeignListenerId);
}

#[cfg(feature = "foreign-nodes")]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ForeignListenerId(u32);

/// A JS command listener. Called inside the dispatching transaction; the host's JS may call
/// back into the transaction through the conformance crate's TLS frame (S4 §2.4 item 5).
#[cfg(feature = "foreign-nodes")]
pub trait ForeignListener: Send + Sync + 'static {
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error>;
}
/// A JS node transform.
#[cfg(feature = "foreign-nodes")]
pub trait ForeignTransform: Send + Sync + 'static {
    fn transform(&self, tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error>;
}

/// A JS `createState(key, {parse, unparse, isEqual})` config (S4 §2.4 item 7). Its values live
/// as JSON in the node's `NodeState::unknown` map (§6), so import, export and copy reuse the
/// unknown-passthrough path; the codec supplies what that path cannot: equality and the
/// default test that omits a value on export.
#[cfg(feature = "foreign-nodes")]
pub struct ForeignStateConfig { pub key: Arc<str>, pub flat: bool, pub codec: Arc<dyn ForeignStateCodec> }
#[cfg(feature = "foreign-nodes")]
pub trait ForeignStateCodec: Send + Sync + 'static {
    /// `isEqual(parse(a), parse(b))` (default upstream: `===` after parse).
    fn is_equal(&self, a: &serde_json::Value, b: &serde_json::Value) -> bool;
    /// `isEqual(parse(value), defaultValue)`: omitted from export (§13.2).
    fn is_default(&self, value: &serde_json::Value) -> bool;
}
#[cfg(feature = "foreign-nodes")]
impl EditorBuilder {
    /// Registers a JS state config; `ForeignNodeType::required_state` names it by key.
    pub fn foreign_state(self, config: ForeignStateConfig) -> EditorBuilder;
}
#[cfg(feature = "foreign-nodes")]
impl Transaction<'_> {
    /// `$setState(node, jsState, value)` with the value already unparsed by JS.
    /// `Error::UnknownForeignState` when `key` was not registered.
    pub fn set_foreign_state(&mut self, node: impl Into<NodeKey>, key: &str, value: serde_json::Value)
        -> Result<(), Error>;
}
// `Read::foreign_state(node, key) -> Option<&serde_json::Value>` (§5.2) reads it back.
```

The probe crate (R2 resolutions) compiles `PendingUpdate` suspend/resume with the stale
check, runtime listeners dispatched from a transaction, and the type-table probe.

---

## 5. EditorState and the read API

### 5.1 EditorState

```rust
pub(crate) type NodeMap = imbl::HashMap<NodeKey, Arc<NodeSlot>, BuildHasherDefault<FxHasher>>;

/// An immutable snapshot. `Clone` is O(1) (persistent map plus Arcs). Upstream
/// `EditorState { _nodeMap, _selection, _readOnly }`; `_readOnly` becomes the type itself
/// (a committed state cannot be written; only a Transaction can).
#[derive(Clone)]
pub struct EditorState {
    registry: Arc<Registry>,
    nodes: NodeMap,
    selection: Option<Selection>,
    root_text: Arc<OnceLock<Arc<str>>>,   // memoized root text content, per snapshot
    max_key: NodeKey,                     // largest key in `nodes` (F-47)
}

impl EditorState {
    /// The read view (§5.2).
    pub fn view(&self) -> StateRef<'_>;
    /// `_selection` (the committed selection).
    pub fn selection(&self) -> Option<&Selection>;
    /// `isEmpty()`: only the root node exists and selection is None. Named `is_empty_state`
    /// so it does not shadow `Read::is_empty(key)` (R2-40).
    pub fn is_empty_state(&self) -> bool;
    /// `clone(selection?)`: the same nodes with another selection.
    pub fn with_selection(&self, selection: Option<Selection>) -> EditorState;
    /// `toJSON()`.
    pub fn to_json(&self) -> Result<SerializedEditorState, Error>;
    /// Root text content (`RootNode.getTextContent`): computed once per snapshot, then cached.
    /// Named so it does not shadow `Read::text_content(key)` (R2-40).
    pub fn root_text_content(&self) -> Arc<str>;
    /// Two values of the same snapshot (pointer-equal map). Not the analogue of upstream's
    /// `prevEditorState === editorState`: upstream clones a state on every
    /// `setEditorState`, while Rust installs the same map, so identity-based skips (history,
    /// R2-23) use `CommitId` instead.
    pub fn same_snapshot(&self, other: &EditorState) -> bool;
    pub fn node_count(&self) -> usize;
    /// The largest key the state holds (root if none).
    pub fn max_key(&self) -> NodeKey;
}
```

`root_text` is shared only between values that hold the same node map. `Editor::transaction`
gives `pending` a fresh `OnceLock`; `with_selection` shares it (nodes unchanged). The memo is
consulted only for committed states and states never written (F-22).

`$isEditorState(x)` has no Rust counterpart (n/a). `EditorStateReadOptions.editor` is n/a
because the registry is inside the state.

### 5.2 `StateRef` and `Read`

S2: EL-03..EL-21 read rows, TX-01..TX-15 read rows, SEL-01..SEL-10 (point and selection
reads), JSON-01..JSON-09 (`export_node`).

```rust
/// A borrowed read view over a committed or pending state. `Copy`. Carries everything a
/// predicate needs: nodes, registry, selection, composition key, previous (committed)
/// selection.
#[derive(Clone, Copy)]
pub struct StateRef<'state> { /* nodes, registry, selection, composition_key, previous_selection, dirty: Option<&DirtySet> */ }

/// Reads shared by EditorState, Transaction and StateRef. Each provided method forwards to
/// `self.view()`.
///
/// Borrows (R2-39). `self.view()` is a temporary, so a default body `self.view().get(key)`
/// can return a borrow only if `StateRef`'s own method returns a `'state` borrow rather than
/// one tied to the temporary. So `StateRef<'state>` has **inherent** by-value methods with the
/// same names and signatures, with `&self` replaced by `self` and every `'_` in the result by
/// `'state` (`pub fn get<Node: NodeType>(self, key: impl Into<NodeKey>) -> Option<&'state
/// Node>`, `pub fn children(self, key) -> Children<'state>`, `pub fn text_content(self, key) ->
/// Cow<'state, str>`, `pub fn selection(self) -> Option<&'state Selection>`, …), and each
/// `Read` default calls the inherent one. Inherent methods win method resolution, so
/// `state_ref.get(k)` on a `StateRef` value calls the by-value form. This compiles (probe).
pub trait Read {
    fn view(&self) -> StateRef<'_>;

    // ---- records and typing
    /// `$getNodeByKey(key)`.
    fn node(&self, key: impl Into<NodeKey>) -> Option<NodeRef<'_>>;
    /// `$getNodeByKeyOrThrow`: Error::NodeNotFound.
    fn node_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeRef<'_>, Error>;
    fn contains(&self, key: impl Into<NodeKey>) -> bool;
    fn kind(&self, key: impl Into<NodeKey>) -> Option<NodeKind>;
    fn is_element(&self, key: impl Into<NodeKey>) -> bool;
    fn is_text(&self, key: impl Into<NodeKey>) -> bool;
    fn is_decorator(&self, key: impl Into<NodeKey>) -> bool;
    fn is_line_break(&self, key: impl Into<NodeKey>) -> bool;
    fn type_name(&self, key: impl Into<NodeKey>) -> Result<&'static str, Error>;
    /// `instanceof Node`: the node's registered ancestry contains `Node`.
    fn is<Node: NodeType>(&self, key: impl Into<NodeKey>) -> bool;
    /// Typed key if `is::<Node>`.
    fn cast<Node: NodeType>(&self, key: impl Into<NodeKey>) -> Option<Id<Node>>;
    /// The user struct, upcast along `as_parent` when `Node` is an ancestor of the stored type.
    fn get<Node: NodeType>(&self, key: impl Into<NodeKey>) -> Option<&Node>;
    fn get_or_err<Node: NodeType>(&self, key: impl Into<NodeKey>) -> Result<&Node, Error>;
    fn element_data(&self, key: impl Into<NodeKey>) -> Result<&ElementData, Error>;   // Error::NotAnElement
    fn text_data(&self, key: impl Into<NodeKey>) -> Result<&TextData, Error>;         // Error::NotAText
    // (Transaction's inherent `element`/`text` return the mutable handles of §7.5.)
    fn root(&self) -> NodeKey;                                                    // $getRoot()

    // ---- tree
    fn parent(&self, key: impl Into<NodeKey>) -> Option<NodeKey>;
    fn parent_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error>;
    fn prev_sibling(&self, key: impl Into<NodeKey>) -> Option<NodeKey>;
    fn next_sibling(&self, key: impl Into<NodeKey>) -> Option<NodeKey>;
    fn first_child(&self, key: impl Into<NodeKey>) -> Option<NodeKey>;
    fn last_child(&self, key: impl Into<NodeKey>) -> Option<NodeKey>;
    fn first_child_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error>;
    fn last_child_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error>;
    fn children_size(&self, key: impl Into<NodeKey>) -> u32;          // 0 for non-elements
    fn is_empty(&self, key: impl Into<NodeKey>) -> bool;
    fn child_at_index(&self, key: impl Into<NodeKey>, index: ChildIndex) -> Option<NodeKey>;
    fn index_within_parent(&self, key: impl Into<NodeKey>) -> Option<ChildIndex>;
    fn is_last_child(&self, key: impl Into<NodeKey>) -> Result<bool, Error>;
    fn children(&self, key: impl Into<NodeKey>) -> Children<'_>;
    fn next_siblings(&self, key: impl Into<NodeKey>) -> Siblings<'_>;
    fn prev_siblings(&self, key: impl Into<NodeKey>) -> Siblings<'_>;  // document order, as getPreviousSiblings
    fn ancestors(&self, key: impl Into<NodeKey>) -> Ancestors<'_>;     // getParents order (nearest first)
    /// Pre-order descendants, excluding `key`, each with depth relative to `key`.
    fn descendants(&self, key: impl Into<NodeKey>) -> Descendants<'_>;
    fn all_text_nodes(&self, key: impl Into<NodeKey>) -> AllTextNodes<'_>;
    fn first_descendant(&self, key: impl Into<NodeKey>) -> Option<NodeKey>;
    fn last_descendant(&self, key: impl Into<NodeKey>) -> Option<NodeKey>;
    fn descendant_by_index(&self, key: impl Into<NodeKey>, index: ChildIndex) -> Option<NodeKey>;
    fn is_attached(&self, key: impl Into<NodeKey>) -> bool;
    fn is_before(&self, a: impl Into<NodeKey>, b: impl Into<NodeKey>) -> Result<bool, Error>;
    fn is_parent_of(&self, a: impl Into<NodeKey>, b: impl Into<NodeKey>) -> bool;
    /// `$hasAncestor(child, target)`.
    fn has_ancestor(&self, child: impl Into<NodeKey>, ancestor: impl Into<NodeKey>) -> bool;
    /// `$getCommonAncestor(a, b)` (caret module): the full result enum.
    fn common_ancestor(&self, a: impl Into<NodeKey>, b: impl Into<NodeKey>) -> Option<CommonAncestor>;
    /// `node.getCommonAncestor(other)`: lift both to elements first.
    fn common_ancestor_element(&self, a: impl Into<NodeKey>, b: impl Into<NodeKey>) -> Option<NodeKey>;
    fn nodes_between(&self, a: impl Into<NodeKey>, b: impl Into<NodeKey>) -> Result<Vec<NodeKey>, Error>;
    fn top_level_element(&self, key: impl Into<NodeKey>) -> Result<Option<NodeKey>, Error>;
    fn top_level_element_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error>;
    /// `$getNearestRootOrShadowRoot(node)`.
    fn nearest_root_or_shadow_root(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error>;
    /// `$findMatchingParent(start, predicate)`. Start inclusive; the predicate is a plain
    /// borrowed closure, called synchronously and not stored.
    fn find_matching_parent(&self, start: impl Into<NodeKey>,
                            predicate: impl FnMut(StateRef<'_>, NodeKey) -> bool) -> Option<NodeKey>;
    /// `$nodesOfType(Klass)`: attached nodes of exactly `Node`'s type (`__type ===`), in key
    /// order (`NodeKey: Ord`), which is upstream's `Map` insertion order. HAMT iteration
    /// order is never exposed: every "map order" walk in the crate sorts by key (F-21).
    fn nodes_of_type<Node: NodeType>(&self) -> Vec<Id<Node>>;
    /// A package-level trait object for the node's most-derived registered projection
    /// (`EditorBuilder::node_trait`), e.g. `get_dyn::<dyn MarkLike>(key)`.
    fn get_dyn<Trait: ?Sized + 'static>(&self, key: impl Into<NodeKey>) -> Option<&Trait>;
    /// `'__language' in node` (R2-20): the node's type or an ancestor type sets
    /// `NodeType::HAS_LANGUAGE_FIELD` (CodeNode and its subclasses).
    fn has_language_field(&self, key: impl Into<NodeKey>) -> bool;
    /// Feature `foreign-nodes`: the fields of a runtime-defined node (§4.4).
    #[cfg(feature = "foreign-nodes")]
    fn foreign_data(&self, key: impl Into<NodeKey>) -> Option<&ForeignData>;
    /// Feature `foreign-nodes`: a JS state value (§4.4 `ForeignStateConfig`), unparsed.
    #[cfg(feature = "foreign-nodes")]
    fn foreign_state(&self, key: impl Into<NodeKey>, state_key: &str) -> Option<&serde_json::Value>;
    /// `$nodesOfType` by registry index (R2.1): attached nodes whose exact type is `index`, in
    /// key order. The untyped form behind the session's `nodesOfType(type)` bulk query
    /// (S12 §1.14), the view's mutation filters and package code that holds only a type name
    /// (`registry.get(name)?.index`).
    fn nodes_of_type_index(&self, index: NodeTypeIndex) -> Vec<NodeKey>;
    /// `$createChildrenArray(element, nodeMap)`.
    fn children_keys(&self, key: impl Into<NodeKey>) -> Result<Vec<NodeKey>, Error>;
    /// `$getAdjacentNode(focus, isBackward)`.
    fn adjacent_node(&self, focus: &Point, direction: EditDirection) -> Result<Option<NodeKey>, Error>;

    // ---- predicates (virtual dispatch to hooks)
    fn is_inline(&self, key: impl Into<NodeKey>) -> bool;
    fn can_be_empty(&self, key: impl Into<NodeKey>) -> bool;
    fn can_insert_text_before(&self, key: impl Into<NodeKey>) -> bool;
    fn can_insert_text_after(&self, key: impl Into<NodeKey>) -> bool;
    fn is_shadow_root(&self, key: impl Into<NodeKey>) -> bool;
    /// `$isRootOrShadowRoot`.
    fn is_root_or_shadow_root(&self, key: impl Into<NodeKey>) -> bool;
    fn can_indent(&self, key: impl Into<NodeKey>) -> bool;
    fn can_merge_with(&self, key: impl Into<NodeKey>, other: impl Into<NodeKey>) -> bool;
    fn can_merge_when_empty(&self, key: impl Into<NodeKey>) -> bool;
    fn can_replace_with(&self, key: impl Into<NodeKey>, other: impl Into<NodeKey>) -> bool;
    fn can_insert_after(&self, key: impl Into<NodeKey>, other: impl Into<NodeKey>) -> bool;
    fn exclude_from_copy(&self, key: impl Into<NodeKey>, destination: Option<CopyDestination>) -> bool;
    fn extract_with_child(&self, key: impl Into<NodeKey>, child: impl Into<NodeKey>,
                          selection: Option<&Selection>, destination: CopyDestination) -> bool;
    fn is_parent_required(&self, key: impl Into<NodeKey>) -> bool;
    fn indent(&self, key: impl Into<NodeKey>) -> u32;
    fn can_have_format(&self, key: impl Into<NodeKey>) -> bool;
    fn is_text_entity(&self, key: impl Into<NodeKey>) -> bool;
    fn is_simple_text(&self, key: impl Into<NodeKey>) -> bool;
    fn is_isolated(&self, key: impl Into<NodeKey>) -> bool;
    fn is_keyboard_selectable(&self, key: impl Into<NodeKey>) -> bool;
    fn is_composing(&self, key: impl Into<NodeKey>) -> bool;
    /// `$isLeafNode`: Text, LineBreak or Decorator.
    fn is_leaf(&self, key: impl Into<NodeKey>) -> bool;
    /// `$isInlineElementOrDecoratorNode`.
    fn is_inline_element_or_decorator(&self, key: impl Into<NodeKey>) -> bool;
    /// `$isTokenOrTab` / `$isTokenOrSegmented`.
    fn is_token_or_tab(&self, key: impl Into<NodeKey>) -> bool;
    fn is_token_or_segmented(&self, key: impl Into<NodeKey>) -> bool;
    /// `$isBlockElementNode`: element and not inline.
    fn is_block_element(&self, key: impl Into<NodeKey>) -> bool;
    /// `INTERNAL_$isBlock` (`LexicalUtils.ts:2006`).
    fn is_block(&self, key: impl Into<NodeKey>) -> bool;
    fn is_selected(&self, key: impl Into<NodeKey>, selection: Option<&Selection>) -> bool;

    // ---- text
    fn text_content(&self, key: impl Into<NodeKey>) -> Cow<'_, str>;
    fn text_content_size(&self, key: impl Into<NodeKey>) -> Utf16Offset;

    // ---- selection
    /// `$getSelection()`.
    fn selection(&self) -> Option<&Selection>;
    /// `$getPreviousSelection()`: the committed state's selection.
    fn previous_selection(&self) -> Option<&Selection>;
    /// `$getTextContent()`: text of the active selection, "" when there is none.
    fn selection_text_content(&self) -> Result<String, Error>;
    /// `$getCharacterOffsets(selection)`.
    fn character_offsets(&self, selection: &Selection) -> Result<(Utf16Offset, Utf16Offset), Error>;

    // ---- NodeState (§6)
    fn get_state<Value: StateValue>(&self, key: impl Into<NodeKey>, state_key: &'static StateKey<Value>) -> Value;
    fn state_change<Value: StateValue>(&self, previous: StateRef<'_>, key: impl Into<NodeKey>,
                                       state_key: &'static StateKey<Value>) -> Option<(Value, Value)>;

    // ---- JSON
    /// `exportNodeToJSON(node)`: `exportJSON()` of `key` with its children exported
    /// recursively.
    fn export_node(&self, key: impl Into<NodeKey>) -> Result<SerializedNode, Error>;
    /// `node.exportJSON()` alone (R2.1): the §13.2 keys and order, with `children: []` on
    /// elements, as upstream's `ElementNode.exportJSON` returns before `exportNodeToJSON`
    /// fills it. O(1) in the subtree size. The Loro projection's per-node fields (S11 §3.5)
    /// and the session's `nodesOfType` props (S12 §1.14) use it.
    fn export_json(&self, key: impl Into<NodeKey>) -> Result<SerializedNode, Error>;
}
impl Read for EditorState {}  impl Read for Transaction<'_> {}  impl Read for StateRef<'_> {}
```

`NodeRef<'state>` is a borrowed record view: `key()`, `kind()`, `type_index()`,
`type_name()`, `parent()`, `prev()`, `next()`, `base() -> &BaseData`, `node_state() ->
Option<&NodeState>`, `data_any() -> &dyn Any`. `NodeRecord` is an owned clone
(`NodeRef::to_owned()`). It is detached from every state and replaces
`$cloneWithPropertiesEphemeral`, used for serializing partial slices.

### 5.3 Iterators

`Children`, `Siblings`, `Ancestors`, `Descendants`, `AllTextNodes` implement
`Iterator<Item = NodeKey>` (`Descendants` yields `(NodeKey, u32 depth)`) and borrow the
view. To mutate while walking, collect first, or use the caret cursors (§10.4). The caret
cursors are one step eager, exactly like upstream's `makeStepwiseIterator` (R2-22): each
`next(view)` returns the item computed earlier and then computes its successor from that
`view`, before the caller's loop body runs (§10.4).

### 5.4 Text content and caching

- `text_content(key)` is upstream's recursive algorithm: elements join children and
  append `"\n\n"` after a non-inline element child that is not the last child; text nodes
  give their text, line breaks `"\n"`, decorators the `text_content` hook.
- `EditorState::root_text_content()` is memoized per snapshot in a `OnceLock`. Upstream
  caches `__cachedText` only when a DOM reconciles. Rust caches it for every committed
  state, which fixes the headless double walk (`SCOPE` §3.3, bug 1).
- There is no element size cache (F-8). `text_content_size` on an element walks its subtree,
  as upstream's `ElementNode.getTextContentSize` does; a text node's size is its
  `TextBuffer::utf16_len` (O(1), the analogue of `CACHED_TEXT_SIZE_KEY` on leaves). Nothing
  on the typing path asks for an element's size.
- The selection's `getNodes` cache (`_cachedNodes`) becomes a per-transaction memo keyed by
  a write counter. It is invisible in the API.

---

## 6. NodeState

S2: NS-01..NS-19 (NS-06 collision, NS-08 export, NS-12 lazy creation on import, NS-15/NS-16
equivalence, NS-19 framework-owned).

Upstream `createState` / `$getState` / `$setState` (`LexicalNodeState.ts`). In Rust, state
on your own node types should be typed struct fields. `StateKey` exists for state attached
to other people's nodes: Macro's `id`, `peerId`, `local`, `taskListView`, and the
web-only `pinnedPropertyIds`/`documentMetadata`.

```rust
/// Values storable under a StateKey. `to_json` is `unparse`.
pub trait StateValue: Clone + fmt::Debug + Send + Sync + 'static {
    fn to_json(&self) -> serde_json::Value;
    /// Upstream's default `isEqual`, which is `Object.is` (`LexicalNodeState.ts:254-268`).
    /// Primitives compare by value (f64 by `Object.is`: NaN equals NaN, +0 ≠ -0). Object
    /// and array values are stored behind `Arc` and compare by **identity**
    /// (`Arc::ptr_eq`): copy-on-write clones share identity as JS objects do, while two
    /// separate parses of `[]` differ. Upstream therefore exports `"sharedPeerIds": []`
    /// after a parse, does not merge two text nodes whose equal arrays were parsed
    /// separately (NRM-05), and does not short-circuit `update_state` for them; so does
    /// Rust (F-19).
    fn js_equal(&self, other: &Self) -> bool;
}
// Provided: bool, String, Option<String>, i64, u32, f64 (via js_number, §13.5) by value;
// Arc<[String]> by identity; Arc<serde_json::Value> by value when both are primitives
// (null/bool/number/string), else by identity. No impl for plain Vec<_> or
// serde_json::Value, which would compare deeply.

/// `StateConfig<K, V>`. Must be a `static`: identity is the address, matching upstream's
/// identity-keyed `knownState` and its collision check.
pub struct StateKey<Value: StateValue> {
    name: &'static str,
    parse: fn(Option<&serde_json::Value>) -> Value,   // parse(undefined) = default
    is_equal: Option<fn(&Value, &Value) -> bool>,      // `isEqual` override
    reset_on_copy: bool,
    default_value: OnceLock<Value>,                    // computed once, as upstream
}
impl<Value: StateValue> StateKey<Value> {
    /// `createState(key, {parse})`.
    pub const fn new(name: &'static str, parse: fn(Option<&serde_json::Value>) -> Value) -> StateKey<Value>;
    /// `{isEqual}`.
    pub const fn with_is_equal(self, is_equal: fn(&Value, &Value) -> bool) -> StateKey<Value>;
    /// `{resetOnCopyNode: true}`.
    pub const fn reset_on_copy(self) -> StateKey<Value>;
    // Implementation note (R2-50): write the const builders in assign-and-return form,
    // `pub const fn with_is_equal(mut self, f: …) -> Self { self.is_equal = Some(f); self }`.
    // The struct-update form `StateKey { is_equal: Some(f), ..self }` fails with E0493
    // (destructor of `self` at compile time). The assign form compiles (probe).
    pub fn name(&self) -> &'static str;
    /// `defaultValue` = parse(None), computed once and cached, so identity comparisons
    /// against the default behave as upstream's.
    pub fn default_value(&self) -> &Value;
    /// `isEqual`: the override if set, else `StateValue::js_equal`.
    pub fn is_equal(&self, left: &Value, right: &Value) -> bool;
}

/// One entry of `$config().stateConfigs`: `stateConfig` or `{stateConfig, flat: true}`.
#[derive(Clone, Copy)]
pub struct RequiredState { /* key: &'static dyn AnyStateKey, flat: bool */ }
impl RequiredState {
    pub const fn nested<Value: StateValue>(key: &'static StateKey<Value>) -> RequiredState;
    pub const fn flat<Value: StateValue>(key: &'static StateKey<Value>) -> RequiredState;
}

/// `NodeState` (`LexicalNodeState.ts:504`). Ordered as upstream's Map/Record are.
/// `PartialEq` is per-key `is_equal`, not deep equality. A node's `state` is `None` exactly
/// when upstream's `__state` is `null` (no `$setState` and no `$` on import yet); the
/// normalization predicate (§8.3) depends on that.
#[derive(Clone, Debug, Default)]
pub struct NodeState {
    known: Vec<(StateKeyRef, Arc<dyn AnyStateValue>)>,     // insertion order
    /// Passthrough, insertion order. Each value is behind its own `Arc` so that identity
    /// survives copy-on-write clones and `equivalent` can compare it as upstream's `!==`
    /// does (R2-04).
    unknown: Option<IndexMap<String, Arc<serde_json::Value>>>,
}
impl NodeState {
    /// `getInternalState()` for debugging and the shim: unknown JSON plus known entries.
    pub fn unknown(&self) -> Option<&IndexMap<String, Arc<serde_json::Value>>>;
    pub fn known_names(&self) -> impl Iterator<Item = &'static str> + '_;
    /// `nodeStatesAreEquivalent(a, b)`; gates text-node merging.
    pub fn equivalent(left: Option<&NodeState>, right: Option<&NodeState>) -> bool;
}
```

Operations:

| Upstream | Rust |
| --- | --- |
| `createState(key, cfg)` | `static X: StateKey<V> = StateKey::new("key", parse_fn);` |
| `$getState(node, cfg, 'latest' \| 'direct')` | `Read::get_state(key, &X)` (always "latest"; "direct" is `previous.get_state(...)` on an older view) |
| `$getStateChange(node, prev, cfg)` | `Read::state_change(previous_view, key, &X)` |
| `$setState(node, cfg, value)` | `Transaction::set_state(key, &X, value) -> Result<(), Error>` |
| `$setState(node, cfg, prev => next)` | `Transaction::update_state(key, &X, impl FnOnce(&V) -> V)`: a no-op, with no dirty mark, when `X.is_equal(prev, next)` (`LexicalNodeState.ts:394, 405`) |
| `$getWritableNodeState(node)` | internal (`set_state` path) |
| `createSharedNodeState(nodeConfig)` | `Registry` `StateLayout` (built at registration) |
| `NodeStateJSON` / `NODE_STATE_KEY` | `"$"`, `json::NODE_STATE_KEY` |
| `StateValueOrUpdater` / `ValueOrUpdater` | the `set_state` / `update_state` pair |
| `StateConfigKey` / `StateConfigValue` / `AnyStateConfig` | `StateKey::name` / the `Value` parameter / `&'static dyn AnyStateKey` (crate-private) |

Semantics, ported exactly:
- Collision: a `StateKey` whose `name` equals that of a different `StateKey` already used
  on the node, or declared in its type's layout. Both `get` and `set` return
  `Error::StateKeyCollision { key, class_name, type_name, node_key }`. Upstream checks this
  in DEV only, against a per-**type** map that grows as keys are used
  (`LexicalNodeState.ts:416-440`); Rust always checks, per node plus the declared layout
  (D-11). Rust therefore misses one case upstream DEV catches: two different keys with the
  same name each used on a *different* node of the same type.
- Export (`toJSON`, `:647`): start from `unknown`. For each known entry: if
  `is_equal(value, default_value)`, delete the name; else set `name → to_json()`. Then move
  the type's flat keys out to the top level. Emit `"$"` only when non-empty.
- `NodeState::equivalent` (`nodeStatesAreEquivalent`, `LexicalNodeState.ts:952-1006`,
  R2-04): two `None`s, or the same `Arc`, are equivalent. Known entries, over the union of
  both sides' keys: a missing side compares against `default_value`; equal if identical
  (`Arc::ptr_eq` of the stored values, upstream's `otherValue !== value` short-circuit,
  `:971`) or `is_equal`. Unknown entries (`hasUnequalRecordEntry`, `:1004-1006`), over the
  union of keys: equal when both are the same JSON primitive (null, bool, number by
  `Object.is`, string), or the same `Arc`; otherwise unequal, so two separately parsed
  `documentMetadata` objects are not equivalent and their text nodes do not merge. A key on
  only one side compares against `undefined`, which nothing equals.
- Import (`$updateStateFromJSON`, `:832`): if the node has no state (`None`) and the JSON
  has neither `"$"` nor any of the type's flat keys, leave the state `None` (NS-12; the
  normalization predicate of §8.3 depends on it). Otherwise merge `json["$"]` with the type's
  flat keys found at the top level (flat wins over nested), reset known entries to defaults,
  parse registered names into known, and keep the rest in `unknown`, verbatim, in order, each
  value in a fresh `Arc`.
- Reads parse unknown entries without caching. Upstream caches on read, which can move a
  key to the end of `"$"` on the next export (D-10).
- Write-clone (`getWritable`, `:685`): registered names in `unknown` are parsed into known.
- `copy_node` resets keys declared `reset_on_copy` to their defaults.

---

## 7. Transaction

### 7.1 Lifecycle

S2: UPD-01..UPD-17 (UPD-02 begin, UPD-03 order, UPD-04 validation, UPD-05 error path
(D-13), UPD-09 commit, UPD-10 reconcile retry is view, UPD-17 GC), TAG-01..TAG-13 (TAG-13 tags
accumulate across batched updates: `flush` keeps them, §8.8), TF-08 (cascade guard, §14.2).

```rust
/// One update. Holds a pending copy of the state (O(1) to create), the dirty sets, tags,
/// pending selection, pending composition key and pending extension state. Dropping it
/// without `commit` discards everything, including allocated keys' nodes. The key counter
/// does not rewind (D-5).
pub struct Transaction<'editor> { /* editor: &'editor mut Editor, pending: EditorState, dirty: DirtySet,
    normalized: IndexSet<NodeKey>, tags: TagSet, options: UpdateOptions, composition_key,
    extensions: ExtensionStore, transform_iterations: u8, dirty_since_flush: bool,
    full_reconcile: bool, nested: VecDeque<(NestedUpdateFn, UpdateOptions)>,
    detached: SmallVec<[Option<Selection>; 2]>, default_prevented: bool,
    sealed: bool /* set by set_editor_state, R2-02 */, events: Vec<PluginEvent> */ }

/// `EditorUpdateOptions` minus what has no Rust meaning (§19 D-2).
#[derive(Clone, PartialEq, Debug, Default)]
pub struct UpdateOptions {
    /// `skipTransforms: true`: flush normalizes dirty simple text nodes only.
    pub skip_transforms: bool,
    /// `tag`: tags added at the start of the update.
    pub tags: TagSet,
}

/// What `flush` runs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FlushMode { Transforms, NormalizeOnly }

/// Upstream `editor.update(f, opts)` called while an update is running (F-3). A plain fn:
/// data travels through ExtensionState, as for transforms.
pub type NestedUpdateFn = fn(&mut Transaction<'_>) -> Result<(), Error>;

impl<'editor> Transaction<'editor> {
    /// The tail of upstream `$beginUpdate` (`LexicalUpdates.ts:1017–1069`), §8 steps 0–5:
    /// drain nested updates, selection transforms, transforms to a fixpoint (or
    /// normalize-only), drain nested updates again, GC, the composition flush flag, and
    /// selection validation. It iterates the **full** dirty sets accumulated since the
    /// transaction opened, as each batched `$beginUpdate` does over `editor._dirtyLeaves` /
    /// `_dirtyElements` (dirty sets reset only at commit). It is a no-op only when those sets
    /// are empty, the nested queue is empty and the selection is clean. The
    /// infinite-transform counter resets at the end of every flush (`:1089`). The JS shim
    /// calls it after each `editor.update` callback so that several updates batched into one
    /// commit behave as upstream's microtask batching; this is S4's per-update boundary
    /// (S4's `end_update` is this method). Rust callers normally let `commit` do it.
    pub fn flush(&mut self) -> Result<(), Error>;
    pub fn flush_with(&mut self, mode: FlushMode) -> Result<(), Error>;
    /// `editor.update(f, opts)` inside an update: queued, not run inline. It runs at the next
    /// drain point of the current flush (§8 step 0 or 3), merging `options.tags` and making
    /// `skip_transforms` apply to the whole remaining flush. Real call sites:
    /// `ClearEditorExtension.ts:50`, rich-text PASTE (`lexical-rich-text/src/index.ts:466`),
    /// `markNodesWithTypesAsDirty` (`LexicalUtils.ts:629`).
    pub fn queue_update(&mut self, update: NestedUpdateFn, options: UpdateOptions);
    /// `flush()` iff a write, dirty mark, selection change or queued update happened after
    /// the last flush (or there was no flush), then the commit phase
    /// (`$commitPendingUpdates` minus DOM): mutation computation (§8.7), model caches
    /// (§8.6), freeze, swap. Returns the Commit even when nothing changed
    /// (`Commit::is_noop`); a no-op commit leaves the editor's state pointer unchanged. It
    /// does not run `Plugin::after_commit`; `Editor::run_after_commit` does (§4.3).
    pub fn commit(self) -> Result<Commit, Error>;
    pub fn options(&self) -> &UpdateOptions;
}
```

### 7.2 Access and dirty marking

```rust
impl<'editor> Transaction<'editor> {
    /// A pending-state view (§5.2). Equivalent to `Read::view(self)`.
    pub fn view(&self) -> StateRef<'_>;
    /// `$getRoot()`.
    pub fn root(&self) -> NodeKey;
    /// `getWritable()` on the user struct: clones on first write, marks dirty, invalidates
    /// the selection's node cache. Works for ancestors of the stored type via
    /// `as_parent_mut` (Error::NoMutableUpcast if a marker blocks it). Error::NodeNotFound,
    /// Error::NodeTypeMismatch.
    pub fn get_mut<Node: NodeType>(&mut self, key: impl Into<NodeKey>) -> Result<NodeMut<'_, Node>, Error>;
    /// Property handle for an element (§7.5). Error::NotAnElement.
    pub fn element(&mut self, key: impl Into<NodeKey>) -> Result<ElementMut<'_, 'editor>, Error>;
    /// Property handle for a text node (§7.5). Error::NotAText.
    pub fn text(&mut self, key: impl Into<NodeKey>) -> Result<TextMut<'_, 'editor>, Error>;
    /// `markDirty()` = `getWritable()` with no change.
    pub fn mark_dirty(&mut self, key: impl Into<NodeKey>) -> Result<(), Error>;
    /// `markNodesWithTypesAsDirty`: what `registerNodeTransform` does on registration. Marks
    /// every attached node of type `Node` dirty so its transforms run in this update (D-9).
    pub fn mark_type_dirty<Node: NodeType>(&mut self) -> Result<(), Error>;
    /// `node.isDirty()` for leaves / elements (dirty in this transaction).
    pub fn is_dirty_leaf(&self, key: impl Into<NodeKey>) -> bool;
    pub fn is_dirty_element(&self, key: impl Into<NodeKey>) -> bool;
    /// `editor._cloneNotNeeded.has(key)` (S3 CR-19): the node was created in this
    /// transaction or its record was already cloned for writing, so a write will not clone
    /// again (its `Arc` is unique to the pending state). False for a missing key. Table code
    /// reads it to decide whether a cell map entry is live (S3 §1b.0).
    pub fn is_writable(&self, key: impl Into<NodeKey>) -> bool;
    /// The editor's `ViewHost` (§15, R2.1): the `IS_IOS`/`IS_ANDROID`/`IS_APPLE` checks of
    /// plugin code. `ViewHost::HEADLESS` for headless editors.
    pub fn view_host(&self) -> ViewHost;
    /// `$fullReconcile()`: the Diff of this commit is a full reconcile.
    pub fn request_full_reconcile(&mut self);
    /// `$addUpdateTag` / `$hasUpdateTag`.
    pub fn add_tag(&mut self, tag: UpdateTag);
    pub fn has_tag(&self, tag: &UpdateTag) -> bool;
    pub fn tags(&self) -> &TagSet;
    /// `$getCompositionKey` / `$setCompositionKey`: setting marks the old and new nodes dirty
    /// (`LexicalUtils.ts:512`).
    pub fn composition_key(&self) -> Option<NodeKey>;
    pub fn set_composition_key(&mut self, key: Option<NodeKey>) -> Result<(), Error>;
    /// Staged extension state (§14.3).
    pub fn extension<State: ExtensionState>(&self) -> Result<&State, Error>;
    pub fn try_extension<State: ExtensionState>(&self) -> Option<&State>;
    pub fn extension_mut<State: ExtensionState>(&mut self) -> Result<&mut State, Error>;
    /// `dispatchCommand` inside this update (nested dispatch: upstream's
    /// `activeEditor === editor` branch of `updateEditorSync`). Never flushes between
    /// priority levels.
    pub fn dispatch(&mut self, command: &Command) -> Result<Handled, Error>;
    /// `editor.getEditorState()` inside an update: the committed state (CR-8).
    pub fn committed_state(&self) -> &EditorState;
    /// `event.preventDefault()` from a Key/Paste handler (§14.1). Sets
    /// `Commit::default_prevented`; EditorCore turns it into `Effect::PreventDefault`.
    pub fn prevent_default(&mut self);
    /// One-shot write of the user struct: `get_mut` + `f`. A borrowed closure, called
    /// synchronously and not stored (like `find_matching_parent`).
    pub fn update_node<Node: NodeType>(&mut self, key: impl Into<NodeKey>,
                                       f: impl FnOnce(&mut Node)) -> Result<(), Error>;
    /// `setEditorState` called inside an update (`LexicalEditor.ts:1537-1580`, R2-02).
    /// `tags` are added first. The pending work is then committed as its own commit by the
    /// **commit phase only** (§8.7, §8.6, §8.8), with no flush: no nested drain, no
    /// transforms, no GC and no validation, as upstream's direct `$commitPendingUpdates`
    /// call does (`:1559-1565`). This happens even when nothing is dirty, and a
    /// selection-only early commit keeps its tags (§8.8). Then `state` (a fresh pending copy)
    /// is installed with full reconcile, dirty `{root: AncestorOfDirty}` and the composition
    /// key cleared. The transaction is then **sealed**: its final flush is a no-op for the
    /// installed state, because upstream's `$beginUpdate` tail runs against its local
    /// `pendingEditorState` captured before the body (`LexicalUpdates.ts:982, 1017-1043`),
    /// which is the stale, already-committed state, so none of its transforms, GC or
    /// validation reach the installed one. Root transforms therefore never run on a history
    /// entry (Macro registers three). Any write, dirty mark, `queue_update`, `set_selection`
    /// or `dispatch` after this call returns `Error::WriteAfterSetEditorState`, a deliberate
    /// divergence (D-24): upstream silently writes into the stale state, or throws in DEV.
    /// Reads still work and see the installed state. `commit()` then runs the commit phase
    /// for the installed state. The early commit is `Commit::preceding` (F-24). Fixture: a
    /// root transform that appends a paragraph, then undo; the transform does not run on the
    /// restored state. Error::SetEmptyEditorState, Error::ForeignEditorState.
    pub fn set_editor_state(&mut self, state: EditorState, tags: TagSet) -> Result<(), Error>;
}

/// `getWritable()` result for the user struct. DerefMut to `Node`.
pub struct NodeMut<'transaction, Node: NodeType> { /* &'transaction mut Node (inside a uniquely owned Arc<Node>) */ }
impl<Node: NodeType> Deref for NodeMut<'_, Node> { type Target = Node; }
impl<Node: NodeType> DerefMut for NodeMut<'_, Node> {}
```

Borrow pattern (F-42). `get_mut`, `element` and `text` hold `&mut Transaction`, so read
everything else into locals first, then take the handle:

```rust
let parent = tx.parent_or_err(key)?;              // reads first
let indent = tx.indent(parent);
tx.element(key)?.set_format(ElementFormat::Left)?; // then the handle, used and dropped
tx.set_indent(key, indent + 1)?;
```

Dirty-set semantics (`internalMarkNodeAsDirty`, `LexicalUtils.ts:394–510`):
- A leaf write inserts into `dirty_leaves: IndexSet<NodeKey>`.
- An element write inserts `key → Intentional` into `dirty_elements: IndexMap<NodeKey,
  DirtyIntent>`.
- Each ancestor of a written node is inserted as `AncestorOfDirty` if absent. The walk stops
  at the first ancestor that is already present. Ancestors are **not** cloned
  (`internalMarkParentElementsAsDirty`, `LexicalUtils.ts:398-415`), so their `Arc` stays
  shared and they are not reported as Updated (§11.1).
- `internalMarkSiblingsAsDirty` is used where upstream uses it (splitText).
- Creating a node marks it dirty and checks the infinite-transform guard
  (`$setNodeKey`, `LexicalUtils.ts:333`).
- Insertion order is part of the semantics, because transforms run in it.

### 7.3 Creation

```rust
impl<'editor> Transaction<'editor> {
    /// `$createXNode()`: allocates a key, inserts a detached node marked dirty, and applies a
    /// registered replacement (`$applyNodeReplacement`). When a replacement applies, the
    /// original's key is allocated and burned first, as upstream allocates two keys (keeps
    /// key numbering identical). Base data comes from `TextNode::initial_text_data` /
    /// `ElementData::default()`. Error::UnregisteredNodeOnCreate.
    pub fn create<Node: NodeType>(&mut self, node: Node) -> Result<Id<Node>, Error>;
    /// `new Klass()` with no replacement (upstream code that bypasses `$create*`).
    pub fn create_exact<Node: NodeType>(&mut self, node: Node) -> Result<Id<Node>, Error>;
    /// Create with explicit base data. Error::BaseKindMismatch if `base` is the wrong kind.
    pub fn create_with<Node: NodeType>(&mut self, node: Node, base: BaseData) -> Result<Id<Node>, Error>;
    /// `$createTextNode(text)`.
    pub fn create_text(&mut self, text: &str) -> Result<Id<Text>, Error>;
    /// `$copyNode(node, skipReset)` (`LexicalUtils.ts:1635`): new key, same type and data,
    /// no links, then `after_clone`. Unless `skip_reset`: resets `reset_on_copy` state and
    /// calls the virtual `reset_on_copy(copy, original)`.
    pub fn copy_node(&mut self, key: impl Into<NodeKey>, skip_reset: bool) -> Result<NodeKey, Error>;
    /// `$parseSerializedNode(json)`: looks up `type`, calls that type's `NodeType::import`
    /// (which may return another type), then imports and appends each `children` entry
    /// through the virtual `append` iff the returned node is an element
    /// (`LexicalUpdates.ts:405-417`). A root JSON updates the existing root in place
    /// (`Root::import`). Error::UnknownSerializedType (unless `opaque_unknown_types`).
    pub fn import_node(&mut self, json: &SerializedNode) -> Result<NodeKey, Error>;
    /// `node.updateFromJSON(json)`, virtual on the node's type: NodeState, then the base
    /// fields through their virtual setters, then the struct's hook (§13.3). Equals
    /// `update_from_json_with(key, json, JsonImport::FULL)`.
    pub fn update_from_json(&mut self, key: impl Into<NodeKey>, json: &SerializedNode) -> Result<(), Error>;
    /// The parts of `updateFromJSON` a custom `import` keeps (CR-12; Macro's `importJSON`s
    /// that skip `updateFromJSON` and copy only `$.id`, S3's single `ImportPolicy` lowers
    /// onto this).
    pub fn update_from_json_with(&mut self, key: impl Into<NodeKey>, json: &SerializedNode,
                                 import: JsonImport) -> Result<(), Error>;
    /// Writes the base fields raw: no virtual setters, no coerce hooks, no selection side
    /// effects, no `set_indent` restructuring. Used by `NodeChange::Update` (§15), where the
    /// remote peer already ran the hooks (F-11).
    pub fn apply_remote_fields(&mut self, key: impl Into<NodeKey>, json: &SerializedNode) -> Result<(), Error>;
    /// `$create(Klass)` (`LexicalUtils.ts:2439-2446`): `default_node()` of the
    /// **transitively** resolved replacement of `Node`, one key, no `with` (F-32).
    /// Error::NoDefault when the resolved type's `default_node()` is `None` (R2-43).
    pub fn create_resolved<Node: NodeType>(&mut self) -> Result<NodeKey, Error>;
    /// `$generateNodesFromRawText(text)`: text / LineBreak / Tab nodes, detached.
    pub fn nodes_from_raw_text(&mut self, text: &str) -> Result<Vec<NodeKey>, Error>;
}

/// `tokenizeRawText(text, visitor)`: split on `\r?\n|\t`, skipping empty parts.
pub fn tokenize_raw_text(text: &str) -> impl Iterator<Item = RawTextToken<'_>>;
/// `RawTextVisitor` callbacks become variants.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RawTextToken<'text> { LineBreak, Tab, Text(&'text str) }
```

### 7.4 Tree operations (structure lives on `Transaction`)

All of these are virtual where upstream's are methods subclasses override: the call
dispatches on the node's type to the hook (§3.2). The `default_*` methods are the base-class
bodies, which hook overrides call when upstream calls `super.x()`. Selection adjustment
follows upstream exactly (`$updateElementSelectionOnCreateDeleteNode`,
`moveSelectionPointToSibling`, `$maybeMoveChildrenSelectionToParent`,
`adjustPointOffsetForMergedSibling`; `selection/adjust.rs`). These adjustments touch only
the **active** selection (`SelectionSlot::Active`), never a detached slot, as upstream adjusts
only `$getSelection()` (§7.6).

```rust
impl<'editor> Transaction<'editor> {
    /// `append(...nodes)`. Error::AppendSelf, Error::InsertNonBlockIntoRoot (via Root splice).
    pub fn append(&mut self, parent: impl Into<NodeKey>, nodes: &[NodeKey]) -> Result<(), Error>;
    /// `splice(start, deleteCount, nodesToInsert)`. Error::SpliceOutOfRange.
    pub fn splice(&mut self, parent: impl Into<NodeKey>, start: ChildIndex, delete_count: u32,
                  nodes: &[NodeKey]) -> Result<(), Error>;
    /// `ElementNode.splice` body (`LexicalElementNode.ts:459-600`). The cleanup that removes
    /// an element emptied by the splice (`newSize === 0 && !this.canBeEmpty() &&
    /// !$isRootOrShadowRoot(this)` → `this.remove()`) sits **inside** the active
    /// RangeSelection branch (`:560-595`): with a null or Node active selection the empty
    /// element stays (F-27; fixture per selection kind).
    pub fn default_splice(&mut self, parent: NodeKey, start: ChildIndex, delete_count: u32,
                          nodes: &[NodeKey]) -> Result<(), Error>;
    pub fn default_append(&mut self, parent: NodeKey, nodes: &[NodeKey]) -> Result<(), Error>;
    /// `insertAfter` / `insertBefore`. Return the inserted key. Error::InsertNonBlockIntoRoot
    /// ("Only element or decorator nodes can be inserted in to the root node").
    pub fn insert_after(&mut self, anchor: impl Into<NodeKey>, node: impl Into<NodeKey>,
                        restore_selection: bool) -> Result<NodeKey, Error>;
    pub fn insert_before(&mut self, anchor: impl Into<NodeKey>, node: impl Into<NodeKey>,
                         restore_selection: bool) -> Result<NodeKey, Error>;
    pub fn default_insert_after(&mut self, anchor: NodeKey, node: NodeKey, restore_selection: bool) -> Result<NodeKey, Error>;
    pub fn default_insert_before(&mut self, anchor: NodeKey, node: NodeKey, restore_selection: bool) -> Result<NodeKey, Error>;
    /// `remove(preserveEmptyParent)`. A no-op on a detached node, as upstream.
    pub fn remove(&mut self, key: impl Into<NodeKey>, preserve_empty_parent: bool) -> Result<(), Error>;
    /// `$removeNode(node, restoreSelection, preserveEmptyParent)` (`LexicalNode.ts:282-341`).
    /// `$maybeMoveChildrenSelectionToParent` runs whatever `restore_selection` is (`:287`).
    /// The empty-parent cascade (`:326-341`) calls `default_remove(parent,
    /// restore_selection, false)` **directly**, not the virtual `remove`, and passes
    /// `preserve_empty_parent = false`, as upstream's `$removeNode(parent, restoreSelection)`
    /// does; this is the one whitelisted exception to the F-13 rule in the ast-grep rule
    /// (R2-27). An emptied root gets `select_end` instead.
    pub fn default_remove(&mut self, key: NodeKey, restore_selection: bool, preserve_empty_parent: bool) -> Result<(), Error>;
    /// `removeFromParent(node)`: unlink only; no selection fix-up, no empty-parent cleanup.
    pub fn remove_from_parent(&mut self, key: impl Into<NodeKey>) -> Result<(), Error>;
    /// `replace(replaceWith, includeChildren)`. Error::IncludeChildrenRequiresElements.
    pub fn replace(&mut self, old: impl Into<NodeKey>, new: impl Into<NodeKey>,
                   include_children: bool) -> Result<NodeKey, Error>;
    pub fn default_replace(&mut self, old: NodeKey, new: NodeKey, include_children: bool) -> Result<NodeKey, Error>;
    /// `clear()`: virtual `remove` on each child.
    pub fn clear(&mut self, element: impl Into<NodeKey>) -> Result<(), Error>;
    /// `insertRangeAfter(node, first, last?)`. Error::InsertRangeAfterOrder.
    pub fn insert_range_after(&mut self, node: impl Into<NodeKey>, first: impl Into<NodeKey>,
                              last: Option<NodeKey>) -> Result<(), Error>;
    /// `$splitNode(node, offset)`. Error::SplitRoot, Error::RootChildrenMustBeElements.
    pub fn split_node(&mut self, element: impl Into<NodeKey>, offset: ChildIndex)
        -> Result<(Option<NodeKey>, NodeKey), Error>;
    /// Virtual `setIndent`.
    pub fn set_indent(&mut self, element: impl Into<NodeKey>, indent: u32) -> Result<(), Error>;
    /// Virtual `insertNewAfter(selection, restoreSelection)`.
    pub fn insert_new_after(&mut self, element: impl Into<NodeKey>, selection: SelectionSlot,
                            restore_selection: bool) -> Result<Option<NodeKey>, Error>;
    /// Virtual `collapseAtStart(selection)`.
    pub fn collapse_at_start(&mut self, element: impl Into<NodeKey>, selection: SelectionSlot) -> Result<bool, Error>;
    /// Virtual `resetOnCopyNodeFrom(original)` (called by `copy_node`).
    pub fn reset_on_copy(&mut self, copy: impl Into<NodeKey>, original: impl Into<NodeKey>) -> Result<(), Error>;
    /// Virtual `createParentElementNode()`.
    pub fn create_parent_element(&mut self, key: impl Into<NodeKey>) -> Result<NodeKey, Error>;
    /// `selectStart` / `selectEnd` / `selectPrevious` / `selectNext` (kind dispatch).
    /// Each sets the active selection, creating a RangeSelection if there is none
    /// (`$internalMakeRangeSelection`).
    pub fn select_start(&mut self, key: impl Into<NodeKey>) -> Result<(), Error>;
    pub fn select_end(&mut self, key: impl Into<NodeKey>) -> Result<(), Error>;
    pub fn select_previous(&mut self, key: impl Into<NodeKey>, anchor: Option<Utf16Offset>,
                           focus: Option<Utf16Offset>) -> Result<(), Error>;
    pub fn select_next(&mut self, key: impl Into<NodeKey>, anchor: Option<Utf16Offset>,
                       focus: Option<Utf16Offset>) -> Result<(), Error>;
}
```

`Transaction::merge` from the brief is `TextMut::merge_with_sibling` (upstream has no
element merge on the node; element merging is selection-driven, through `remove_text` and
`delete_character`).

### 7.5 Property handles

```rust
/// Element properties. Every setter is `getWritable()` + assignment (always marks dirty, as
/// upstream; there is no equality short-circuit for elements).
pub struct ElementMut<'transaction, 'editor> { /* tx: &'transaction mut Transaction<'editor>, key */ }
impl ElementMut<'_, '_> {
    pub fn key(&self) -> NodeKey;
    pub fn data(&self) -> &ElementData;
    pub fn set_format(&mut self, format: ElementFormat) -> Result<&mut Self, Error>;
    pub fn set_style(&mut self, style: &str) -> Result<&mut Self, Error>;
    pub fn set_direction(&mut self, direction: Option<TextDirection>) -> Result<&mut Self, Error>;
    pub fn set_text_format(&mut self, format: TextFormat) -> Result<&mut Self, Error>;
    pub fn set_text_style(&mut self, style: &str) -> Result<&mut Self, Error>;
    /// `select(anchorOffset?, focusOffset?)` (`LexicalElementNode.ts:367`), including the
    /// `!canBeEmpty()` redirection to first/last child.
    pub fn select(&mut self, anchor: Option<ChildIndex>, focus: Option<ChildIndex>) -> Result<(), Error>;
}

/// Text properties.
pub struct TextMut<'transaction, 'editor> { /* … */ }
impl TextMut<'_, '_> {
    pub fn key(&self) -> NodeKey;
    pub fn data(&self) -> &TextData;
    /// No-op (and no dirty) when unchanged; through `coerce_text_content`.
    pub fn set_text_content(&mut self, text: &str) -> Result<&mut Self, Error>;
    pub fn set_format(&mut self, format: TextFormat) -> Result<&mut Self, Error>;
    pub fn set_format_type(&mut self, format_type: TextFormatType) -> Result<&mut Self, Error>;
    pub fn toggle_format(&mut self, format_type: TextFormatType) -> Result<&mut Self, Error>;
    pub fn set_style(&mut self, style: &str) -> Result<&mut Self, Error>;
    pub fn set_detail(&mut self, detail: TextDetail) -> Result<&mut Self, Error>;
    pub fn toggle_directionless(&mut self) -> Result<&mut Self, Error>;
    pub fn toggle_unmergeable(&mut self) -> Result<&mut Self, Error>;
    /// No-op when unchanged.
    pub fn set_mode(&mut self, mode: TextMode) -> Result<&mut Self, Error>;
    /// `spliceText(offset, delCount, newText, moveSelection)`; `range` = offset..offset+delCount.
    pub fn splice_text(&mut self, range: Range<Utf16Offset>, insert: &str, move_selection: bool) -> Result<&mut Self, Error>;
    /// `select(anchorOffset?, focusOffset?)` (`LexicalTextNode.ts:846`); moves the
    /// composition key when the old selection held it.
    pub fn select(&mut self, anchor: Option<Utf16Offset>, focus: Option<Utf16Offset>) -> Result<(), Error>;
    /// `splitText(...offsets)` (`LexicalTextNode.ts:971-1134`): sorts, dedupes, splits.
    /// Parts after the first are `create::<Text>` (with replacement, so a replaced TextNode
    /// yields the replacement and a subclass such as Hashtag yields plain Text). They copy
    /// format, style, detail and NodeState, but **not** mode. A segmented self is replaced
    /// by a new plain node (`:1037-1066`). The active selection's points (only the active one,
    /// as upstream reads `$getSelection()`) and the composition key move as upstream.
    /// Returns `[]` for empty text, `[self]` for no split (F-34).
    pub fn split_text(&mut self, offsets: &[Utf16Offset]) -> Result<Vec<NodeKey>, Error>;
    /// `mergeWithSibling(target)`. Error::MergeWithNonSibling.
    pub fn merge_with_sibling(&mut self, target: impl Into<NodeKey>) -> Result<NodeKey, Error>;
}
```

### 7.6 Selection slots and setters on the transaction

S2: SEL-01 (`Point.set` side effects), SEL-02 (point kind check, all builds), SEL-35/SEL-36
(tree-op adjustments of the active selection only), SEL-55 (composition key).

Upstream algorithms often operate on one selection object while tree operations adjust
another: `$splitNodeAtPoint` builds a detached `new RangeSelection(…, 0, '')` and passes it
to `insertNewAfter` (`LexicalSelection.ts:3389-3428`), `RangeSelection.removeText` branches
on `$getSelection() === this` (`:1177-1182`), `NodeSelection.deleteNodes` on
`($getSelection() || $getPreviousSelection()) === this` (`:462`), and `Point.set` has side
effects for any selection (`:185-226`). Rust expresses this with selection slots. Upstream
identity becomes slot equality: `$getSelection() === this` is `slot == SelectionSlot::Active`.

```rust
/// Which selection an operation acts on. `Active` is `$getSelection()`. A `Detached`
/// selection is a value the transaction owns until `take_detached` or the end of the
/// transaction. Tree-op adjustments ($updateElementSelectionOnCreateDeleteNode,
/// moveSelectionPointToSibling, splitText, mergeWithSibling, …) touch only `Active`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum SelectionSlot { Active, Detached(DetachedSelectionId) }
/// Index into the transaction's small slot table (`SmallVec<[Option<Selection>; 2]>`).
/// Only internal algorithms and package ports create detached slots.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct DetachedSelectionId(u16);

impl<'editor> Transaction<'editor> {
    /// `$setSelection(selection)`: marks it dirty, clears caches.
    pub fn set_selection(&mut self, selection: Option<Selection>);
    /// Moves a value into a new detached slot.
    pub fn detach_selection(&mut self, selection: Selection) -> SelectionSlot;
    /// Takes a detached slot's value back out (the slot becomes empty). `Active` returns a
    /// clone of the active selection. Error::UnknownSelectionSlot, Error::NoSelection.
    pub fn take_detached(&mut self, slot: SelectionSlot) -> Result<Selection, Error>;
    /// The selection in `slot` (`None` = `$getSelection()` is null, for `Active`).
    pub fn selection_at(&self, slot: SelectionSlot) -> Result<Option<&Selection>, Error>;
    /// The selection in `slot` as a range, or Error::NoRangeSelection.
    pub fn range_at(&self, slot: SelectionSlot) -> Result<&RangeSelection, Error>;
    /// `range_at(Active)`.
    pub fn range_selection(&self) -> Result<&RangeSelection, Error>;
    /// Live point reads (F-20). Upstream locals such as `const anchor = selection.anchor`
    /// alias a live object; a Rust `Point` is a `Copy` snapshot. Porting rule: every
    /// upstream local that aliases `selection.anchor/focus` is re-read with these after any
    /// call that can move points (tree ops, `split_text`, `merge_with_sibling`,
    /// `set_point*`), and a local that is meant to stay a snapshot is named `*_snapshot`.
    pub fn anchor_at(&self, slot: SelectionSlot) -> Result<Point, Error>;
    pub fn focus_at(&self, slot: SelectionSlot) -> Result<Point, Error>;
    /// `anchor_at(Active)` / `focus_at(Active)`.
    pub fn anchor(&self) -> Result<Point, Error>;
    pub fn focus(&self) -> Result<Point, Error>;
    /// `point.set(key, offset, type)` on a slot's anchor or focus, with the side effects of
    /// `Point.set` (`LexicalSelection.ts:185-226`) for **any** slot: composition-key
    /// transfer, cache invalidation, dirty, and the kind check (Error::PointTypeMismatch,
    /// always on, D-11).
    pub fn set_point_at(&mut self, slot: SelectionSlot, role: PointRole, point: Point) -> Result<(), Error>;
    /// `set_point_at(Active, …)`.
    pub fn set_point(&mut self, role: PointRole, point: Point) -> Result<(), Error>;
    /// `setTextNodeRange(anchorNode, anchorOffset, focusNode, focusOffset)` on a slot.
    pub fn set_text_node_range_at(&mut self, slot: SelectionSlot, anchor: impl Into<NodeKey>,
                                  anchor_offset: Utf16Offset, focus: impl Into<NodeKey>,
                                  focus_offset: Utf16Offset) -> Result<(), Error>;
    pub fn set_text_node_range(&mut self, anchor: impl Into<NodeKey>, anchor_offset: Utf16Offset,
                               focus: impl Into<NodeKey>, focus_offset: Utf16Offset) -> Result<(), Error>;
    /// `selection.setFormat / setStyle / toggleFormat` on a slot (F-26; `$patchStyleText`
    /// collapsed, markdown shortcuts). Each marks that selection dirty, as upstream.
    pub fn set_selection_format_at(&mut self, slot: SelectionSlot, format: TextFormat) -> Result<(), Error>;
    pub fn set_selection_style_at(&mut self, slot: SelectionSlot, style: &str) -> Result<(), Error>;
    pub fn toggle_selection_format_at(&mut self, slot: SelectionSlot, format_type: TextFormatType) -> Result<(), Error>;
    /// The `Active` forms of the three above.
    pub fn set_selection_format(&mut self, format: TextFormat) -> Result<(), Error>;
    pub fn set_selection_style(&mut self, style: &str) -> Result<(), Error>;
    pub fn toggle_selection_format(&mut self, format_type: TextFormatType) -> Result<(), Error>;
    /// Copies `$getPreviousSelection()` (the committed selection) into a new detached slot,
    /// for upstream code that operates on the previous selection object, which tree-op
    /// adjustments never touch (`$insertNodes`, R2-25). `Ok(None)` when it is null.
    pub fn detach_previous_selection(&mut self) -> Result<Option<SelectionSlot>, Error>;
}
```

Naming rule (R2-54): every method that takes a `SelectionSlot` ends in `_at`, and its plain
name is `_at(SelectionSlot::Active, …)`. Every range-editing operation of §9.4 follows it. Detached slots still holding a value at commit are
discarded. A detached selection whose points name removed keys is the caller's business,
as upstream (it is never validated).

The range-editing methods (`insert_text`, …) are in §9.4.

---

## 8. The update pipeline: transforms, normalization, GC, model caches

S2: UPD-03, UPD-04, UPD-17, TF-01..TF-08, NRM-01..NRM-10, SEL-54.

`flush()` runs these steps, matching `$beginUpdate` after `updateFn()`
(`LexicalUpdates.ts:1017–1069`):

- **0. Drain nested updates** (`$processNestedUpdates`, `:907-955`): pop queued
  `queue_update` entries in FIFO order and run each body on this transaction; entries queued
  while draining are drained too. Each entry's tags merge into the transaction's, and any
  entry with `skip_transforms` switches this flush to `FlushMode::NormalizeOnly`.
- **1. Selection transforms** (§8.1).
- **2. Transforms to a fixpoint** (§8.2), or normalize-only (§8.3). Steps 2–4 run only when
  something is dirty (`_dirtyType !== NO_DIRTY_NODES`).
- **3. Drain nested updates again** (`:1029`): updates queued by transforms run now, after
  the transform loop. Their writes are not transformed or normalized, but they are GC'd.
  Their `skip_transforms` has no effect (upstream ignores the return value here).
- **4. GC** (§8.4).
- **5. Validation** (§8.5), which always runs.

`commit()` runs `flush()` if anything happened since the last flush (§7.1), then §8.7, §8.6
and §8.8 in that order (the non-DOM half of `$commitPendingUpdates`, `:521`). Mutations are
computed **before** the model-cache writes, so those writes are never reported (F-50).

### 8.1 Selection transforms

`applySelectionTransforms` (`LexicalSelection.ts:2972-2995`). If the pending selection is a
range: for the anchor, if it is a text point, look its node up; a missing key returns
`Error::PointNodeNotFound` (`Point.getNode: node not found`) **here**, before transforms and
before the SelectionLost check of §8.5 (F-30). Then call
`TextNode::selection_transform(tx, anchor_text_key)` (the hook reads `tx.previous_selection()`
itself, R2-49). Then do the same for the focus's node if it is a different text node.

### 8.2 Transforms to a fixpoint

```rust
/// A node transform: a plain function item, registered at build time. Generic fns
/// monomorphize (`log::<Paragraph>`), so one body can serve many types.
pub type TransformFn<Node> = fn(&mut Transaction<'_>, Id<Node>) -> Result<(), Error>;
```

`$applyAllTransforms` (`LexicalUpdates.ts:269-364`), ported line for line. `master_leaves`
and `master_elements` are the transaction's full dirty sets.

1. Let `leaves = master_leaves` and `elements = master_elements` (on the first pass these
   **are** the master sets, not copies). Loop while either is non-empty.
2. If `leaves` is non-empty: swap a fresh set into the leaf collector (`:290`). Element marks
   made during this phase keep going into the **current** `elements` batch; only leaves get
   a new collector. For each key in `leaves`, in insertion order:
   - If the node is a text node, attached, `is_simple_text`, and not unmergeable, run
     `normalize_text_node` (§8.3).
   - If the node exists, is attached, and is not the composition key, run the node's
     transforms (`$applyTransforms`). Stop early once the node detaches. "The composition
     key" is the value read **once** when `$applyAllTransforms` starts (`LexicalUpdates.ts:276`,
     R2-28): a transform that moves the key does not change later passes of this loop.
     Normalization (the previous bullet) does not skip the composing node; only transforms
     do.
   - Re-insert the key into `master_leaves`.
   If new leaves were collected, set `leaves` to them, increment the counter and repeat
   step 2 (leaves have priority over elements).
3. Swap fresh collectors for both leaves and elements (`:328`). If `root` is in `elements`,
   remove it and re-append it as `Intentional` (the finalizer, `:333-336`; only if present).
   On the first pass `elements` is the master map, so this reorders `master_elements` too.
   For each `(key, intent)` of `elements`: `master_elements.insert(key, intent)` (an
   `IndexMap::insert`: overwrites the intent and keeps the position, as `Map.set`, `:339`).
   If `intent` is `Intentional` and the node is valid, run its transforms.
4. Set `leaves` and `elements` to the newly collected sets, increment the counter, and loop.
5. Guard: the counter is checked by every dirty mark and every node creation. Above 99,
   return Error::InfiniteTransforms (upstream's message). The counter resets at the end of
   every flush.

A type's transform list is built at `build()`, nearest first: the per-level
`static_transform` of the type and of each ancestor up to the marker (one entry per level
that declares one, no dedupe); then, in builder call order, the `.transform::<Node>` and
`transform_each` entries that cover the type; then those registered for the type it
**directly** replaces (`.transform::<Original>` runs for `replaced_by(Original)`, one level,
as `registerNodeTransform`, `LexicalEditor.ts:1358-1365`; not transitive) (F-31). The list is
cached per type (`transformsCache`).

`FlushMode::NormalizeOnly` (`skipTransforms`) runs only `$normalizeAllDirtyTextNodes`: step
2's normalization over the current dirty leaves, once.

### 8.3 Normalization

```rust
/// `$normalizeTextNode` (`LexicalNormalization.ts:46-90`). If the node is empty, simple and
/// mergeable, remove it and stop. Backward: while the previous sibling is a simple,
/// mergeable text node, remove it if empty and continue; else merge if
/// `can_merge(previous, node)` and stop; else stop. Forward: the same with the next sibling
/// and `can_merge(node, next)`. So each direction merges at most once. Merged keys (both)
/// go to `normalized`.
///
/// `can_merge(left, right)` (`$canSimpleTextNodesBeMerged`, `:20-34`) is **asymmetric**:
/// left.mode == right.mode && left.format == right.format && left.style == right.style &&
/// (left.state is None || same Arc || NodeState::equivalent(left.state, right.state)).
/// Upstream's `node1Mode === null` clauses are never true (the fields are never null), so
/// they are dropped. Equality includes absence: a field whose `AbsentKeys` bit is set holds
/// `undefined` upstream, which equals only another absent field (`undefined === 0` is
/// false). `left.state is None` merges whatever `right` holds and drops right's state
/// (B-F2b-10).
pub(crate) fn normalize_text_node(tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error>;

/// `$normalizeSelection` (exported as `$normalizeSelection__EXPERIMENTAL`): descends element
/// points into text points (or deeper elements) using `set(.., onlyIfChanged = true)`
/// semantics. Pure over a value; there are no side effects on the transaction. Use it only on
/// values that are never installed (R2-29): upstream's `point.set(…, true)`
/// (`LexicalNormalization.ts:113-129`) moves the composition key and dirties the selection,
/// so `applyDOMRange` (`LexicalSelection.ts:695`) and `$selectAll` (`LexicalUtils.ts:1242,
/// 1247`) map to `normalize_selection_at`, never to this function.
pub fn normalize_range_selection(view: StateRef<'_>, selection: &mut RangeSelection) -> Result<(), Error>;

impl Transaction<'_> {
    /// Normalizes the selection in `slot` in place, with point-set side effects.
    pub fn normalize_selection_at(&mut self, slot: SelectionSlot) -> Result<(), Error>;
    /// `normalize_selection_at(Active)`.
    pub fn normalize_selection(&mut self) -> Result<(), Error>;
}
```

### 8.4 Garbage collection

`$garbageCollectDetachedNodes(prev, pending, dirtyLeaves, dirtyElements)` (`LexicalGC.ts:72`):
for each dirty element that is detached, collect it and its whole subtree (children whose
`parent` link still points at it). The deep-children walk (`:62-66`) removes created child
keys (absent from `prev`) from `dirty_elements` **only**, even for leaf children. The
deletions are applied after the walk. Then each detached dirty leaf whose key is still in
the node map is deleted, and dropped from `dirty_leaves` if it is absent from `prev`; leaf
keys already deleted by the subtree walk are skipped (`:115-123`). So a text node created
inside an element that was created and detached in the same update **stays in
`dirty_leaves`** although it is in neither snapshot (upstream quirk, ported, with a test;
F-28). Consumers of `Changes` (history's `dirtyLeaves.size`, nodeId, markdown shortcuts)
must tolerate such keys. GC runs only when something is dirty and touches only dirty nodes,
so it is O(dirty).

### 8.5 Validation

After GC (`LexicalUpdates.ts:1043`):
- If the composition key changed during this transaction, `Commit::composition_changed` is
  set (upstream forces a sync flush; Rust always commits synchronously).
- Range selection: anchor and focus keys must exist, else Error::SelectionLost (upstream's
  message).
- Node selection: an empty node set becomes `None`.
- `cfg(debug_assertions)` only (R2.1): every Created or Updated node whose type row has flags
  (§4.1) answers its six flag hooks as the row says; a mismatch is
  `Error::Invariant("type table flags differ for <type>: set FLAGS_PER_INSTANCE")`, so a
  wrong probe fails tests instead of misleading the view.

### 8.6 Model caches (commit phase)

These replace the reconciler's writes to the model (`LexicalReconciler.ts:214-279, 545-566,
637-678`). There is no element size cache (§5.4). `EditorMode::ViewAttached` only, and only
for the elements whose children the reconciler **reconciles** (R2-03): elements present in
`prev` and dirty in this commit (on a full reconcile, every element present in both `prev` and
`next`). Elements created in this commit are not synced: upstream writes these fields only in
`reconcileTextFormat`/`reconcileTextStyle` (`:637-655`), called only from
`$reconcileChildrenWithDirection` (`:657-679`), which `$reconcileNode` reaches only for an
element in both states whose `$updateDOM` returned false (`:1407-1445`); `$createNode` /
`$createChildren` (`:540-591`) never call it. So a paragraph created by Enter, paste, import or
`set_editor_state` on new keys keeps the `text_format` it was given until a later commit
dirties it (fixture: Enter at the end of bold text in a ViewAttached editor creates a
paragraph whose `text_format` is the selection's format, not its first child's).

- For each such element that is not root or shadow root, let `t` be the first Text-kind node
  in a pre-order walk of its subtree that descends into element children and skips
  decorators and line breaks (upstream's leftmost-wins `subTreeTextFormat` capture with
  `$beginCaptureGuard`/`$bubbleChildFirstText`). If `t` exists and its format/style differ
  from the element's `text_format`/`text_style`, write them. A paragraph
  `[Link["a"(bold)], "b"]` gets `text_format = BOLD` (fixture; F-10). Upstream does this only
  when a DOM is attached (D-3).

These writes run no transforms, are not added to `Commit::changes`, and are not reported as
mutations (§8.7 ran first). If the element's `Arc` was shared, the write clones it, which
is invisible except in memory (F-50).

### 8.7 Mutations

Computed against `prev` (§11.1), before §8.6:
- Normal commits: from the dirty sets. A node is Updated only if it is dirty **and** its
  record `Arc` differs from `prev`'s (`!Arc::ptr_eq`). The pipeline never writes records
  behind the user's back before this point, so typing one character yields exactly one
  Updated mutation, the text node's (test; F-8).
- Full-reconcile commits (`set_editor_state`, undo, `request_full_reconcile`; R2-01): compare
  the two node maps **entry by entry**. A key only in `next` is Created, a key only in `prev`
  is Destroyed, and a key in both whose record `Arc`s differ (`!Arc::ptr_eq`) is Updated. No
  subtree is pruned by tree-ancestor identity: a parent's record is not cloned when a
  descendant changes (§7.2), so an unchanged paragraph `Arc` says nothing about its text
  child. The walk is O(nodes) pointer compares, as upstream's full reconcile
  (`treatAllNodesAsDirty`, `LexicalReconciler.ts:1395-1404, 1443-1445`) is O(nodes) DOM work.
  An implementation may skip HAMT-internal nodes that the two `imbl` maps share, because a
  shared HAMT node holds identical entries; that is sound and gives the same result, unlike
  pruning by node-tree ancestors. Test: type one character, undo, and assert exactly one
  Updated mutation (the text node) and one TEXT diff op.

Upstream computes them only in the reconciler, so a headless upstream editor never fires
mutation listeners. Rust always computes them (D-4).

### 8.8 Swap

The pending state becomes the committed state. The editor's composition key and extension
state are replaced by the transaction's. The returned `Commit` holds both snapshots.
A transaction that dirtied nothing and whose selection is unchanged and not dirty
(`editorStateHasDirtySelection`) does not swap: `Commit::is_noop()` is true and
`prev.same_snapshot(&next)`.

Tag carry-over (F-5, `LexicalUpdates.ts:622-629`): upstream resets `_updateTags` at commit
only when nodes were dirty. So:
- a commit with dirty nodes clears `Editor::carried_tags`;
- a commit that changed only the selection stores its tag set in `carried_tags`, and the next
  `Editor::transaction` starts from it (`history-merge`, `skip-scroll-into-view` and
  `historic` included, which changes history merge decisions);
- a no-op commit clears `carried_tags` (`:1104-1112`).
This is upstream behaviour, not a divergence; conformance tests hit it.

The composition key is staged in the transaction and swapped in here, so a failed
transaction rolls it back. Upstream's `$setCompositionKey` writes `editor._compositionKey`
immediately and its error path (`LexicalUpdates.ts:1066-1082`) does not restore it. That is
D-16, already in the ledger; the Tier C comparator masks the composition key after an `Err`
(R2-18).

On any `Err` from flush or commit, nothing is swapped. The `Transaction` is consumed by
`commit`, so the caller cannot retry it. This is upstream's "reset to the current state",
minus the `_onError` callback and the FULL_RECONCILE re-render, which are the host's job.
An early commit made by `Transaction::set_editor_state` has already been swapped and stays.

---

## 9. Selection

S2: SEL-01..SEL-55 (§3A; the `@lexical/selection` ids are `LSEL-nn`, S3), EVT-08..EVT-11 (the
model half of `onSelectionChange`, §9.2), EVT-14, EVT-15, EVT-25, EVT-28 (model predicates the
view's `beforeinput` path calls, §15.1).

### 9.1 Types

```rust
/// `BaseSelection` implementations. Upstream is open; Rust closes the set. TableSelection
/// is a core variant whose span-dependent behaviour comes from lexical_rich_nodes through
/// `TableSelectionHooks` (Q4, CR-7).
#[derive(Clone, PartialEq, Debug)]
pub enum Selection { Range(RangeSelection), Node(NodeSelection), Table(TableSelection) }

/// `PointType` (`'text' | 'element'`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, strum::EnumString, strum::Display)]
#[serde(rename_all = "lowercase")] #[strum(serialize_all = "lowercase")]
pub enum PointType { Text, Element }

/// `Point` / `TextPointType` / `ElementPointType`. A text point's offset is UTF-16; an
/// element point's offset is a child index. Making them separate variants makes a text point
/// with a child offset unrepresentable. `_selection` (the back-reference) is gone; point
/// side effects go through `Transaction::set_point_at`. A `Point` is a `Copy` snapshot,
/// not a live object (porting rule in §7.6).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Point {
    Text { key: NodeKey, offset: Utf16Offset },
    Element { key: NodeKey, offset: ChildIndex },
}
impl Point {
    pub fn text(key: impl Into<NodeKey>, offset: Utf16Offset) -> Point;
    pub fn element(key: impl Into<NodeKey>, offset: ChildIndex) -> Point;
    /// `$createPoint(key, offset, type)`.
    pub fn new(key: impl Into<NodeKey>, offset: u32, point_type: PointType) -> Point;
    pub fn key(&self) -> NodeKey;
    pub fn offset(&self) -> u32;
    pub fn point_type(&self) -> PointType;
    /// `point.is(other)` is `==`.
    /// `point.isBefore(other)` (`LexicalSelection.ts:167`): same key → offset compare,
    /// otherwise normalized carets and `$comparePointCaretNext`.
    pub fn is_before(&self, view: StateRef<'_>, other: &Point) -> Result<bool, Error>;
    /// `point.getNode()`: Error::PointNodeNotFound.
    pub fn node(&self, view: StateRef<'_>) -> Result<NodeKey, Error>;
}

/// Which end of a range selection.
#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::Display)]
#[strum(serialize_all = "lowercase")]
pub enum PointRole { Anchor, Focus }

/// `RangeSelection` (`LexicalSelection.ts:476`). `is` (value equality) compares anchor,
/// focus, format and style but not `dirty` (custom PartialEq).
#[derive(Clone, Debug)]
pub struct RangeSelection {
    pub anchor: Point,
    pub focus: Point,
    pub format: TextFormat,
    /// `Arc<str>` like node styles (R2-57), so copying a node's style into the selection on
    /// every update is a refcount bump.
    pub style: Arc<str>,
    dirty: bool,
}
impl PartialEq for RangeSelection;

impl RangeSelection {
    /// `new RangeSelection(anchor, focus, 0, '')`.
    pub fn new(anchor: Point, focus: Point) -> RangeSelection;
    /// `$createRangeSelection()`: both points at (root, 0, element).
    pub fn at_root() -> RangeSelection;
    pub fn collapsed(point: Point) -> RangeSelection;
    pub fn is_dirty(&self) -> bool;
    /// `isCollapsed()`.
    pub fn is_collapsed(&self) -> bool;
    /// `getStartEndPoints()` → (anchor, focus).
    pub fn start_end_points(&self) -> (Point, Point);
    /// `toggleFormat(type)` / `setFormat(format)` / `setStyle(style)` / `hasFormat(type)`.
    /// These are value edits that set `dirty`; they do not touch nodes.
    pub fn toggle_format(&mut self, format_type: TextFormatType);
    pub fn set_format(&mut self, format: TextFormat);
    pub fn set_style(&mut self, style: &str);
    pub fn has_format(&self, format_type: TextFormatType) -> bool;
    /// `isBackward()` (focus before anchor).
    pub fn is_backward(&self, view: StateRef<'_>) -> Result<bool, Error>;
    /// `getNodes()` (`LexicalSelection.ts:550`, via `$getNodesFromCaretRangeCompat`).
    pub fn nodes(&self, view: StateRef<'_>) -> Result<Vec<NodeKey>, Error>;
    /// `getTextContent()`.
    pub fn text_content(&self, view: StateRef<'_>) -> Result<String, Error>;
    /// `forwardDeletion(anchor, anchorNode, isBackward)`: true when deleting forward at the
    /// end would cross into a shadow root.
    pub fn forward_deletion(&self, view: StateRef<'_>, direction: EditDirection) -> Result<bool, Error>;
}

/// `NodeSelection` (`LexicalSelection.ts:330`). An insertion-ordered key set.
#[derive(Clone, Debug, Default)]
pub struct NodeSelection { nodes: IndexSet<NodeKey>, dirty: bool }
impl PartialEq for NodeSelection;   // set equality, ignoring order and dirty (`is`)
impl NodeSelection {
    /// `$createNodeSelection()`.
    pub fn new() -> NodeSelection;
    pub fn add(&mut self, key: impl Into<NodeKey>);
    pub fn delete(&mut self, key: impl Into<NodeKey>);
    pub fn clear(&mut self);
    pub fn has(&self, key: impl Into<NodeKey>) -> bool;
    pub fn keys(&self) -> impl ExactSizeIterator<Item = NodeKey> + '_;
    /// `getNodes()`: keys that still exist, in insertion order.
    pub fn nodes(&self, view: StateRef<'_>) -> Vec<NodeKey>;
    pub fn text_content(&self, view: StateRef<'_>) -> String;
    // isCollapsed() → false; isBackward() → false; getStartEndPoints() → None (on Selection)
}

/// `@lexical/table`'s TableSelection data (`LexicalTableSelection.ts`). `is` (PartialEq)
/// compares `table`, anchor and focus, not `dirty`. `Copy` (every field is), so S3's
/// `TableSelectionExt` methods can take it by value next to `&mut Transaction` (R2-52).
#[derive(Clone, Copy, Debug)]
pub struct TableSelection { pub table: NodeKey, pub anchor: Point, pub focus: Point, dirty: bool }
impl PartialEq for TableSelection;
impl TableSelection {
    /// `$createTableSelectionFrom` data part: both points are element points.
    pub fn new(table: NodeKey, anchor_cell: NodeKey, focus_cell: NodeKey) -> TableSelection;
    /// `set(tableKey, anchorCellKey, focusCellKey)`: replaces the three keys, marks dirty.
    pub fn set(&mut self, table: NodeKey, anchor_cell: NodeKey, focus_cell: NodeKey);
    pub fn is_dirty(&self) -> bool;
    /// `isValid()` (`:139`): `table`, anchor and focus keys are not root, both points are
    /// element points, and all three keys exist.
    pub fn is_valid(&self, view: StateRef<'_>) -> bool;
}

/// The span-dependent half of TableSelection, supplied by lexical_rich_nodes
/// (`EditorBuilder::table_selection_hooks`). Core implements the rest itself:
/// `is_collapsed() == false`, `is_backward() = focus.is_before(anchor)`,
/// `start_end_points() = (anchor, focus)`, `insert_text`/`insert_raw_text` no-ops
/// (`:213-219`), `extract() = nodes()`. Without hooks, `nodes`, `text_content` and
/// `insert_nodes` on a TableSelection return `Error::UnsupportedSelection`.
pub trait TableSelectionHooks: Send + Sync + 'static {
    /// `getNodes()` (needs the table span map). Core memoizes it per write counter.
    fn nodes(&self, view: StateRef<'_>, selection: &TableSelection) -> Result<Vec<NodeKey>, Error>;
    /// `getTextContent()`.
    fn text_content(&self, view: StateRef<'_>, selection: &TableSelection) -> Result<String, Error>;
    /// `insertNodes(nodes)`.
    fn insert_nodes(&self, tx: &mut Transaction<'_>, slot: SelectionSlot, nodes: &[NodeKey]) -> Result<(), Error>;
}

impl Selection {
    pub fn as_range(&self) -> Option<&RangeSelection>;
    pub fn as_node(&self) -> Option<&NodeSelection>;
    pub fn as_table(&self) -> Option<TableSelection>;
    /// `$isRangeSelection` / `$isNodeSelection` / `$isTableSelection`.
    pub fn is_range(&self) -> bool;
    pub fn is_node(&self) -> bool;
    pub fn is_table(&self) -> bool;
    pub fn is_collapsed(&self) -> bool;
    pub fn start_end_points(&self) -> Option<(Point, Point)>;
    pub fn is_backward(&self, view: StateRef<'_>) -> Result<bool, Error>;
    pub fn nodes(&self, view: StateRef<'_>) -> Result<Vec<NodeKey>, Error>;
    pub fn text_content(&self, view: StateRef<'_>) -> Result<String, Error>;
    pub fn is_dirty(&self) -> bool;
}
```

### 9.2 View-supplied selection

S2: SEL-51 (`$normalizeSelectionPointsForBoundaries`), SEL-53 (the model half of per-event
selection creation; which events use the DOM selection is the view's), EVT-08..EVT-11.

```rust
/// A selection already resolved from DOM (node, offset) to points by the view, which owns
/// the key ↔ DOM map. Replaces `$internalCreateSelection` / `$createRangeSelectionFromDom` /
/// `applyDOMRange` on the model side.
#[derive(Clone, PartialEq, Debug)]
pub enum ViewSelection {
    /// The DOM selection is outside the editor, or the event does not use the DOM selection:
    /// keep the model selection (`lastSelection.clone()`).
    KeepModel,
    /// No selection (`null`).
    None,
    /// Resolved points. `resolution_dirty` is the `dirty` flag `$internalResolveSelectionPoint`
    /// returns (the point was moved off a DOM position Lexical does not own).
    Range { anchor: Point, focus: Point, resolution_dirty: bool },
    /// The view is selecting whole decorators.
    Node(Vec<NodeKey>),
    /// A table cell-range selection from the view's table observer (R2.1, S12 §1.12): the
    /// `$createTableSelectionFrom(table, anchorCell, focusCell)` data. Installed as
    /// `Selection::Table(TableSelection::new(table, anchor_cell, focus_cell))`; an invalid one
    /// (`TableSelection::is_valid` false) keeps the model selection, as upstream's
    /// `$updateTableSelection` guard does.
    Table { table: NodeKey, anchor_cell: NodeKey, focus_cell: NodeKey },
}

impl Transaction<'_> {
    /// The model half of `$internalCreateRangeSelection` (`LexicalSelection.ts:2697`): runs
    /// `$normalizeSelectionPointsForBoundaries` (`resolveSelectionPointOnBoundary`, `:2486`),
    /// then takes format/style from the last selection when the anchor key is unchanged, else
    /// from the anchor text node or element (`text_format`/`text_style`), then sets the active
    /// selection.
    pub fn selection_from_view(&mut self, selection: ViewSelection) -> Result<(), Error>;
    /// `RangeSelection.applyDOMRange(range)` (`:667`): like `selection_from_view` but mutating
    /// the active range in place (`onlyIfChanged` sets), then `normalize_selection`.
    pub fn apply_view_range(&mut self, anchor: Point, focus: Point, resolution_dirty: bool) -> Result<(), Error>;
    /// The model half of `onSelectionChange` (`LexicalEvents.ts:340-458`), run after
    /// `selection_from_view` by `Input::SelectionFromView` (EVT-08..EVT-11):
    /// 1. `post_delete_restore` (EVT-08, Android): if the active range is collapsed and its
    ///    anchor is the saved anchor shifted right by one in the same node, or is at offset 1
    ///    in the saved anchor node's next sibling, install the saved selection.
    /// 2. Collapsed range: `dom_range_same_node` marks it dirty (EVT-10, #1482). Then, if
    ///    `marked` is Some and its key and offset equal the anchor's, set format/style from it
    ///    (`$updateSelectionFormatStyle`); else a text anchor takes the node's format/style; an
    ///    element anchor (unless not composing and the root text is `""`) takes the element's
    ///    `text_format`/`text_style` when the element is empty, else keeps the format and
    ///    clears the style (EVT-09).
    /// 3. Non-collapsed range: `format` = AND of the formats of the text nodes of
    ///    `nodes()` with non-zero size, excluding a first node whose start point sits at its
    ///    end and a last node whose end point sits at 0, with start/end taken from the **DOM**
    ///    offsets `dom_anchor_offset`/`dom_focus_offset` as upstream does; 0 when there is none
    ///    (EVT-11). Style is not touched.
    /// Then SELECTION_CHANGE_COMMAND is dispatched (`Command::SelectionChange`).
    pub fn selection_change_format(&mut self, context: &SelectionChangeContext) -> Result<(), Error>;
}

/// What `onSelectionChange` reads from the DOM and from view-side module state. The host
/// applies its own time windows (sans-IO): `marked` is passed only when the
/// `markCollapsedSelectionFormat` record is younger than 200 ms.
#[derive(Clone, PartialEq, Debug, Default)]
pub struct SelectionChangeContext {
    /// `domSelection.type === 'Range' && anchorNode === focusNode`.
    pub dom_range_same_node: bool,
    /// The `[format, style, offset, key]` recorded by the view's `$updateDOMSelection`.
    pub marked: Option<MarkedSelectionFormat>,
    /// `domSelection.anchorOffset` / `focusOffset` (UTF-16 or child index, as the DOM gives).
    pub dom_anchor_offset: u32,
    pub dom_focus_offset: u32,
    /// `postDeleteSelectionToRestore` (Android, set by the view after a delete).
    pub post_delete_restore: Option<RangeSelection>,
    /// The view saw a triple click within its threshold (`NormalizeTripleClickSelection`'s
    /// `refreshTripleClick`: a `mousedown`/`mouseup` with `detail === 3`, default 100 ms; the
    /// timer is the view's, sans-IO). Read by the SELECTION_CHANGE listener of S3's
    /// normalize-triple-click plugin through `Transaction::selection_change_context` (R2.1).
    pub triple_click: bool,
}

impl Transaction<'_> {
    /// The `SelectionChangeContext` of the `Input::SelectionFromView` this transaction is
    /// running, while its `Command::SelectionChange` dispatch runs; `None` for every other
    /// dispatch (R2.1). Lets a SELECTION_CHANGE listener read what upstream's listeners read
    /// from module state or the DOM event.
    pub fn selection_change_context(&self) -> Option<&SelectionChangeContext>;
    /// `$fixFocusOverselection` (`@lexical/extension` `NormalizeTripleClickSelectionExtension`,
    /// R2.1): for a non-collapsed range, take the caret range in the `Next` direction and
    /// move the focus toward the anchor: out of a next text node of which nothing is selected
    /// (offset 0), behind a single LineBreak, out of the start of every element, then into the
    /// end of a containing element, then `normalize_caret`; when the focus moved, set the
    /// selection from the caret range (§10.5). Returns whether it moved. Upstream's eager
    /// `$updateDOMSelection(..., SKIP_SELECTION_FOCUS | SKIP_SCROLL_INTO_VIEW)` is the ordinary
    /// `Effect::SetViewSelection` of this commit, emitted because the selection changed.
    pub fn fix_focus_overselection(&mut self) -> Result<bool, Error>;
}
#[derive(Clone, PartialEq, Debug)]
pub struct MarkedSelectionFormat { pub format: TextFormat, pub style: Arc<str>, pub key: NodeKey, pub offset: u32 }
```

### 9.3 Modify (layout-dependent movement)

S2: SEL-48 (the decorator and block pass, pure model), SEL-49 (the DOM `Selection.modify` call,
view), SEL-50.

`RangeSelection.modify(alter, isBackward, granularity)` (`:1573`) asks the browser's
`Selection.modify` for the new focus, because word and line boundaries need layout. Rust
takes that answer as input.

```rust
#[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum Alter { Move, Extend }
#[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum Granularity { Character, Word, LineBoundary }

/// Where the selection lands after layout-aware movement.
#[derive(Clone, PartialEq, Debug)]
pub enum ModifyTarget {
    /// The host ran `Selection.modify` (or read `beforeinput.getTargetRanges()`) and resolved
    /// the resulting DOM range to points. `is_backward_in_dom` says whether DOM anchor ≠ range
    /// start, which triggers `$swapPoints`.
    View { anchor: Point, focus: Point, resolution_dirty: bool, is_backward_in_dom: bool },
    /// No layout available, as in headless upstream, where `modify` returns early after the
    /// decorator/block handling (`getDOMSelection` is null).
    NoView,
    /// Feature `model-segmentation`: extended grapheme clusters for Character and Unicode
    /// word boundaries for Word inside the current text node. LineBoundary is Error::LayoutRequired.
    /// This deliberately departs from upstream (D-8) for servers that need deleteCharacter.
    ModelSegmentation,
}

impl Transaction<'_> {
    /// `modify(alter, isBackward, granularity)`:
    /// 1. `$modifySelectionAroundDecoratorsAndBlocks` (`:3572`), fully in the model; it may
    ///    switch to a NodeSelection and return.
    /// 2. Otherwise apply `target` (`applyDOMRange` semantics), then the shadow-root shrink and
    ///    `$swapPoints` logic of `:1655–1712`.
    /// 3. For LineBoundary, run the decorators pass again.
    pub fn modify_selection(&mut self, alter: Alter, direction: EditDirection,
                            granularity: Granularity, target: ModifyTarget) -> Result<(), Error>;
}
```

### 9.4 Range-editing operations

S2: SEL-11..SEL-36, SEL-40..SEL-50 (SEL-44 the emoji/surrogate shrink and SEL-45
`$removeSegment` are inside `delete_character`; SEL-50 headless `modify` is `ModifyTarget::NoView`).

Each operation exists as `op_at(&mut self, slot: SelectionSlot, …)` and as `op(…)`, which
is `op_at(SelectionSlot::Active, …)` (§7.6). The table shows the plain names. Inside an
`_at` body, upstream's `$getSelection() === this` is `slot == SelectionSlot::Active`
(`removeText`, `:1177-1182`; `deleteNodes`, `:462`, where upstream compares with
`$getSelection() || $getPreviousSelection()`, and Rust with `Active`), and
`$removeTextAndSplitBlock` switches from its slot to `Active` halfway, as upstream does
(`:3364-3367`). Tree-op adjustments still go to `Active` only. Each returns
Error::NoRangeSelection when the slot does not hold a range, except where noted. CR-9:
`remove` on a detached node is a no-op, and `format_text_at(Detached(..))` formats a
detached range.

| Upstream (`LexicalSelection.ts`) | Rust (`impl Transaction`) | Notes |
| --- | --- | --- |
| `RangeSelection.insertText(text)` `:772` | `insert_text(&mut self, text: &str) -> Result<(), Error>` | the full 400-line algorithm; NodeSelection → no-op (`Ok(())`), as upstream |
| `insertRawText(text)` `:763` | `insert_raw_text(&mut self, text: &str)` | = `insert_nodes(nodes_from_raw_text)` |
| `removeText()` `:1176` | `remove_text(&mut self)` | via `remove_text_from_caret_range` |
| `formatText(type, alignWithFormat?)` `:1193` | `format_text(&mut self, format_type: TextFormatType, align_with: Option<TextFormat>)` | collapsed → toggles selection format and clears composition |
| `insertNodes(nodes)` `:1344` | `insert_nodes(&mut self, nodes: &[NodeKey])` | Empty → no-op; non-collapsed → `remove_text` first; anchor on root → `insert_paragraph` and recurse (SEL-23). Then, with `first_block` = the anchor's block (Error::MissingBlockElementAncestor otherwise) (R2-20): **CASE 1** (SEL-24, `:1368-1376`): if `has_language_field(first_block)`: if `nodes[0]` also `has_language_field`, `insert_text(text_content(nodes[0]))`; else split at the selection (`$splitNodeAtPoint`), splice every node into the block at the split index, and `select_end(last)`. **CASE 2** (SEL-25, `:1378-1389`): no node is a non-inline element or a block decorator → split the inline ancestors at the point, splice into the block, `select_end(last)`. **CASE 3** (SEL-26): `$wrapInlineNodes`: inline runs are wrapped in `create_parent_element` blocks; a LineBreak that would open a new wrapper is left detached; the virtual-root paragraph is `create::<Paragraph>` (burns keys as upstream). NodeSelection branch (`:408`) handled by `Selection::Node` |
| `insertParagraph()` `:1463` | `insert_paragraph(&mut self) -> Result<Option<NodeKey>, Error>` | None = `insertNewAfter` returned null (CodeNode) |
| `insertLineBreak(selectStart?)` `:1494` | `insert_line_break(&mut self, select_start: bool)` | |
| `extract()` `:1511` | `extract(&mut self) -> Result<Vec<NodeKey>, Error>` | splits boundary text nodes, moves points; NodeSelection → its nodes |
| `modify(alter, isBackward, granularity)` `:1573` | `modify_selection(…, ModifyTarget)` | §9.3 |
| `deleteCharacter(isBackward)` `:1754` | `delete_character(&mut self, direction: EditDirection, target: ModifyTarget)` | `target` feeds the internal `modify('extend', …, 'character')` |
| `deleteWord(isBackward)` `:1965` | `delete_word(&mut self, direction, target: ModifyTarget, character_target: ModifyTarget)` | `forward_deletion` guard; `modify(Extend, direction, Word)` with `target`; if still collapsed, `delete_character(direction, character_target)`, whose own `modify(Extend, …, Character)` needs a second layout answer (`:1880`); else `remove_text` (SEL-46, R2-21). The host computes both targets from the same DOM state |
| `deleteLine(isBackward)` `:1945` | `delete_line(&mut self, direction, target: ModifyTarget, character_target: ModifyTarget)` | `modify(Extend, direction, LineBoundary)` with `target`; still collapsed → `delete_character(direction, character_target)`; else `remove_text` (SEL-47, R2-21) |
| `NodeSelection.deleteNodes()` `:460` | `delete_nodes(&mut self)` / `delete_nodes_at(slot)` | Error::NoNodeSelection. Upstream relocates the selection when `this` is `$getSelection() \|\| $getPreviousSelection()` (`:462-465`); Rust relocates only for `Active` (R2-26, D-25) |
| `NodeSelection.insertNodes(nodes)` `:408` | `insert_nodes` (dispatches on the selection kind) | |
| `NodeSelection.insertText` / `insertRawText` | `insert_text` / `insert_raw_text` → no-op | upstream "Do nothing?" |
| `setTextNodeRange(…)` `:583` | `set_text_node_range` (§7.6) | |
| `applyDOMRange(range)` `:667` | `apply_view_range` (§9.2) | |
| `$insertNodes(nodes)` `:3284` | `insert_nodes_at_selection(&mut self, nodes: &[NodeKey])` | Active when there is an active selection. Otherwise, when the previous selection is non-null, `detach_previous_selection()` and `insert_nodes_at(that_slot)`: upstream calls `.insertNodes` on the previous selection object, which is not `$getSelection()`, so tree-op adjustments do not touch it (R2-25). Only when both are null: `select_end(ROOT)` and Active (SEL-33) |
| `$selectAll(selection?)` (Utils `:1231-1249`) | `select_all(&mut self, expand: Option<SelectionSlot>) -> Result<(), Error>` | R2-19. `None` is upstream's `$selectAll()`, which both SELECT_ALL handlers call (`lexical-rich-text/src/index.ts:1192`, `lexical-plain-text/src/index.ts:349`): `ElementMut::select(ROOT, Some(0), Some(children_size))` on the active selection (it creates a range if there is none, and rewrites an existing range in place, keeping its format and style), then `normalize_selection_at(Active)`. Inside a table cell this selects the whole document. `Some(slot)` is the passed-selection branch: set the slot's anchor to `(top_level(anchor).parent, 0, element)` and its focus to `(that parent, children_size, element)` (the parent is a shadow root inside a table cell), then `normalize_selection_at(slot)` |
| `$getCharacterOffsets(selection)` | `Read::character_offsets` | |
| `$isBlockElementNode` | `Read::is_block_element` | |
| `$splitNodeAtPoint` (internal) | crate-private; builds a `Detached` element-point slot (format 0, style "") and calls the virtual `insert_new_after(element, that_slot, true)` | F-1 |
| `$updateElementSelectionOnCreateDeleteNode` | crate-private `adjust::on_create_delete` | used by tree ops; Active only |
| `moveSelectionPointToSibling` / `adjustPointOffsetForMergedSibling` / `$moveSelectionPointToEnd` | crate-private `adjust` | |

### 9.5 Selection method inventory

Every `Point`, `BaseSelection`, `RangeSelection` and `NodeSelection` member:

| Upstream member | Rust |
| --- | --- |
| `Point.key` / `.offset` / `.type` | `Point::key()` / `offset()` / `point_type()` (and the variant) |
| `Point._selection` | n/a (no back-reference; side effects via `set_point`) |
| `Point.is(p)` | `==` |
| `Point.isBefore(p)` | `Point::is_before(view, &p)` |
| `Point.getNode()` | `Point::node(view)` |
| `Point.set(key, offset, type, onlyIfChanged?)` | `Transaction::set_point_at(slot, role, point)` (side effects for any slot); plain assignment on a value outside a transaction |
| `BaseSelection.clone()` | `Clone` |
| `BaseSelection.extract()` | `Transaction::extract` |
| `BaseSelection.getNodes()` | `Selection::nodes(view)` |
| `BaseSelection.getTextContent()` | `Selection::text_content(view)` |
| `BaseSelection.insertText` / `insertRawText` / `insertNodes` | `Transaction::insert_text` / `insert_raw_text` / `insert_nodes` |
| `BaseSelection.is(sel)` | `==` |
| `BaseSelection.getStartEndPoints()` | `Selection::start_end_points` |
| `BaseSelection.isCollapsed()` / `isBackward()` | `Selection::is_collapsed` / `is_backward(view)` |
| `BaseSelection.getCachedNodes()` / `setCachedNodes()` | n/a: internal memo (§5.4) |
| `BaseSelection.dirty` | `Selection::is_dirty()` (read-only; set by edits) |
| `RangeSelection.format` / `.style` / `.anchor` / `.focus` | pub fields |
| `RangeSelection._cachedNodes` / `_cachedIsBackward` | n/a: internal memo |
| `RangeSelection.is` / `isCollapsed` / `getNodes` / `setTextNodeRange` / `getTextContent` / `applyDOMRange` / `clone` / `toggleFormat` / `setFormat` / `setStyle` / `hasFormat` / `insertRawText` / `insertText` / `removeText` / `formatText` / `insertNodes` / `insertParagraph` / `insertLineBreak` / `extract` / `modify` / `forwardDeletion` / `deleteCharacter` / `deleteLine` / `deleteWord` / `isBackward` / `getStartEndPoints` | §9.1 and §9.4, one item each (27 members) |
| `NodeSelection._nodes` | `NodeSelection::keys()` |
| `NodeSelection.is` / `isCollapsed` / `isBackward` / `getStartEndPoints` / `add` / `delete` / `clear` / `has` / `clone` / `extract` / `insertRawText` / `insertText` / `insertNodes` / `getNodes` / `getTextContent` / `deleteNodes` | §9.1 and §9.4 (16 members) |
| `$createPoint` / `$createRangeSelection` / `$createNodeSelection` | `Point::new` / `RangeSelection::at_root` / `NodeSelection::new` |
| `$getSelection()` / `$getPreviousSelection()` / `$setSelection()` | `Read::selection` / `Read::previous_selection` / `Transaction::set_selection` |
| `$isRangeSelection` / `$isNodeSelection` | `Selection::is_range` / `is_node`, or `matches!` |

---

## 10. Carets (`caret/LexicalCaret.ts`, `caret/LexicalCaretUtils.ts`)

S2: CARET-01..CARET-39 (CARET-05 offset spec and clamp vs dev error, CARET-06 sibling
iteration, CARET-14 direction check).

Upstream's caret API is already value-oriented. The Rust port keeps its shape. The
TypeScript type parameter `D extends CaretDirection` becomes a runtime `direction` field;
mixing directions is Error::CaretDirectionMismatch. Every caret is `Copy`. Methods that read
the tree take a `StateRef`. Methods that mutate are on `Transaction`. `getLatest()` is a no-op
in Rust (keys always resolve to the latest node) and is omitted.

### 10.1 Types

```rust
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, strum::Display)]
#[strum(serialize_all = "lowercase")]
pub enum CaretDirection { Next, Previous }
impl CaretDirection {
    /// `flipDirection(direction)`.
    pub fn flip(self) -> CaretDirection;
}

/// `RootMode`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum RootMode { #[default] Root, ShadowRoot }

/// `CaretType` (`'sibling' | 'child'`) plus the text point type, for match-free inspection.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CaretType { Sibling, Child, Text }

/// `SiblingCaret<T, D>`: points at the side of `origin` in `direction`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct SiblingCaret { pub origin: NodeKey, pub direction: CaretDirection }
/// `ChildCaret<T, D>`: inside element `origin`, before its first (Next) or after its last
/// (Previous) child.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ChildCaret { pub origin: NodeKey, pub direction: CaretDirection }
/// `TextPointCaret<T, D>`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct TextPointCaret { pub origin: NodeKey, pub offset: Utf16Offset, pub direction: CaretDirection }

/// `NodeCaret<D>` = SiblingCaret | ChildCaret.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum NodeCaret { Sibling(SiblingCaret), Child(ChildCaret) }
/// `PointCaret<D>` = NodeCaret | TextPointCaret.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum PointCaret { Sibling(SiblingCaret), Child(ChildCaret), Text(TextPointCaret) }

/// `CaretRange<D>`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CaretRange { pub anchor: PointCaret, pub focus: PointCaret, pub direction: CaretDirection }

/// `TextPointCaretSlice<T, D>`. `distance` is signed UTF-16 code units.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TextPointCaretSlice { pub caret: TextPointCaret, pub distance: i64 }

/// `TextPointCaretSliceTuple<D>`.
pub type TextPointCaretSlices = (Option<TextPointCaretSlice>, Option<TextPointCaretSlice>);

/// `CommonAncestorResult` and its four interfaces.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommonAncestor {
    /// `CommonAncestorResultSame`.
    Same { ancestor: NodeKey },
    /// `CommonAncestorResultAncestor`: `a` is the ancestor.
    Ancestor { ancestor: NodeKey },
    /// `CommonAncestorResultDescendant`: `b` is the ancestor.
    Descendant { ancestor: NodeKey },
    /// `CommonAncestorResultBranch`.
    Branch { ancestor: NodeKey, a: NodeKey, b: NodeKey },
}
impl CommonAncestor {
    /// `$getCommonAncestorResultBranchOrder` (Branch only, else Error::Internal).
    pub fn branch_order(&self, view: StateRef<'_>) -> Result<Ordering, Error>;
}
```

### 10.2 Constructors and predicates

| Upstream | Rust |
| --- | --- |
| `$getSiblingCaret(origin, direction)` | `SiblingCaret::new(origin, direction)` (`origin: null` → `Option` at the call site) |
| `$getChildCaret(origin, direction)` | `ChildCaret::new(view, origin, direction) -> Option<ChildCaret>` (None unless element) |
| `$getTextPointCaret(origin, direction, offset \| direction)` | `TextPointCaret::new(view, origin, direction, TextOffsetSpec) -> Result<TextPointCaret, Error>` |
| `$getTextNodeOffset(origin, offset \| direction, mode)` | `text_node_offset(view, origin, TextOffsetSpec, OffsetMode) -> Result<Utf16Offset, Error>`; `OffsetMode::{Error, Clamp}` (Error::InvalidTextOffset). Upstream's devInvariant applies in DEV only; Rust errors in Error mode always (D-11) |
| `$getTextPointCaretSlice(caret, distance)` | `TextPointCaretSlice { caret, distance }` |
| `$getChildCaretOrSelf(caret)` | `PointCaret::child_caret_or_self(self, view) -> PointCaret` |
| `$getAdjacentChildCaret(caret)` | `NodeCaret::adjacent_child_caret(self, view) -> Option<NodeCaret>` |
| `$getCaretRange(anchor, focus)` | `CaretRange::new(anchor, focus) -> Result<CaretRange, Error>` (Error::CaretDirectionMismatch) |
| `$getCollapsedCaretRange(anchor)` | `CaretRange::collapsed(anchor)` |
| `$extendCaretToRange(anchor)` | `CaretRange::extend(view, anchor) -> CaretRange` |
| `$isSiblingCaret` / `$isChildCaret` / `$isNodeCaret` / `$isTextPointCaret` / `$isTextPointCaretSlice` | `matches!` on the enums; `PointCaret::caret_type()` |
| `$getCommonAncestor(a, b)` | `Read::common_ancestor(a, b)` |
| `$getCommonAncestorResultBranchOrder` | `CommonAncestor::branch_order` |
| `$comparePointCaretNext(a, b)` | `compare_point_caret_next(view, a, b) -> Result<Ordering, Error>` (Error::NoCommonAncestor) |
| `flipDirection` | `CaretDirection::flip` |
| `makeStepwiseIterator(config)` | `StepwiseCursor` trait (§10.4) |
| `StepwiseIteratorConfig` | `StepwiseCursor` (state + step + map are its methods) |
| `FlipDirection<D>` | n/a: type-level only; `CaretDirection::flip` |

```rust
/// `offset: number | CaretDirection` for text carets.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TextOffsetSpec { At(Utf16Offset), Start, End }   // 'previous' → Start, 'next' → End
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OffsetMode { Error, Clamp }
```

### 10.3 Caret methods (`BaseCaret`, `SiblingCaret`, `ChildCaret`, `TextPointCaret`, `CaretRange`, `TextPointCaretSlice`)

Every method on `NodeCaret`/`PointCaret` (and on the three structs where the type is
known):

| Upstream member | Rust | Mutates? |
| --- | --- | --- |
| `origin` / `type` / `direction` / `offset` | fields, `caret_type()` | |
| `getParentAtCaret()` | `parent_at_caret(view) -> Option<NodeKey>` | |
| `getNodeAtCaret()` | `node_at_caret(view) -> Option<NodeKey>` | |
| `getAdjacentCaret()` | `adjacent_caret(view) -> Option<SiblingCaret>` | |
| `getSiblingCaret()` | `sibling_caret(self) -> SiblingCaret` | |
| `getChildCaret()` | `child_caret(view) -> Option<ChildCaret>` | |
| `getParentCaret(mode)` | `parent_caret(view, RootMode) -> Option<SiblingCaret>` | |
| `getFlipped()` | `flipped(view) -> PointCaret` (`TextPointCaret::flipped(self)` needs no view) | |
| `isSameNodeCaret(other)` / `isSamePointCaret(other)` | `is_same_node_caret(&other)` / `is_same_point_caret(&other)` | |
| `getLatest()` | n/a | |
| `remove()` | `Transaction::caret_remove(caret) -> Result<PointCaret, Error>` | yes |
| `insert(node)` | `Transaction::caret_insert(caret, node) -> Result<PointCaret, Error>` | yes |
| `replaceOrInsert(node, includeChildren?)` | `Transaction::caret_replace_or_insert(caret, node, include_children)` | yes |
| `splice(deleteCount, nodes, nodesDirection?)` | `Transaction::caret_splice(caret, delete_count: u32, nodes: &[NodeKey], nodes_direction: CaretDirection)` (Error::CaretSpliceUnderflow) | yes |
| `CaretRange.isCollapsed()` | `CaretRange::is_collapsed(&self)` | |
| `CaretRange.iterNodeCarets(rootMode)` | `CaretRange::node_carets(self, view, RootMode) -> Result<NodeCaretCursor, Error>` (steps once at construction, R2-22) | |
| `CaretRange.getTextSlices()` | `CaretRange::text_slices(view) -> Result<TextPointCaretSlices, Error>` | |
| `CaretRange.getLatest()` | n/a | |
| `CaretRange[Symbol.iterator]` | `node_carets(view, RootMode::Root)` | |
| `TextPointCaretSlice.getSliceIndices()` | `slice_indices(&self) -> Range<Utf16Offset>` | |
| `.getTextContent()` / `.getTextContentSize()` | `text_content<'state>(&self, view: StateRef<'state>) -> Result<&'state str, Error>` (the borrow comes from the view, not from `self`, R2-39) / `text_content_size()` | |
| `.removeTextSlice()` | `Transaction::remove_text_slice(slice) -> Result<TextPointCaret, Error>` | yes |
| `SiblingCaret` iteration (`for (const c of caret)`) | `NodeCaret::siblings(self, view) -> SiblingCursor` (steps once at construction) | |

### 10.4 Cursors (mutation-tolerant iteration)

Upstream caret iterators are `makeStepwiseIterator`s (`caret/LexicalCaret.ts:1195-1202`), and
they are **one step eager** (R2-22): the iterator stores `map(state)` and computes `state =
step(state)` *before* returning it, so the successor already exists when the loop body runs.
`iterNodeCarets` also steps once on creation and captures `focus.getLatest()`
(`:1027-1043`), and so does the sibling iterator (`:391-397`). A body that removes or moves the
current origin and keeps looping therefore continues from the successor computed before the
mutation. Rust ports exactly that. A cursor holds only `Copy` caret state: construction
computes the first item from the construction-time view; `next(view)` returns the stored item
and then immediately computes its successor with this `view`, before the caller's body runs.
Fixture: remove `caret.origin` inside a `node_carets` loop and continue.

```rust
/// `makeStepwiseIterator`. `next` takes the view per step, so the loop body may hold `&mut tx`.
/// One step eager: `next(view)` returns the stored item, then stores its successor computed
/// from `view`.
pub trait StepwiseCursor {
    type Item;
    fn next(&mut self, view: StateRef<'_>) -> Result<Option<Self::Item>, Error>;
    /// Read-only adapter for `for` loops when nothing mutates.
    fn iter<'state>(self, view: StateRef<'state>) -> CursorIter<'state, Self> where Self: Sized;
}

/// `CaretRange.iterNodeCarets(rootMode)`. `CaretRange::node_carets(self, view, RootMode)`
/// takes the construction view, because the first step happens at construction.
#[derive(Clone, Copy, Debug)]
pub struct NodeCaretCursor { /* next_item: Option<NodeCaret>, focus: PointCaret, root_mode */ }
impl StepwiseCursor for NodeCaretCursor { type Item = NodeCaret; /* … */ }

/// Iterating a NodeCaret: the adjacent sibling carets in its direction.
#[derive(Clone, Copy, Debug)]
pub struct SiblingCursor { /* … */ }
impl StepwiseCursor for SiblingCursor { type Item = SiblingCaret; /* … */ }
```

Usage pattern from `deleteCharacter`:

```rust
let mut cursor = range.node_carets(tx.view(), RootMode::ShadowRoot)?;
while let Some(caret) = cursor.next(tx.view())? {
    // may call tx.remove(..) here, then `return` or `break`, exactly as upstream
}
```

### 10.5 Caret utilities (`LexicalCaretUtils.ts`)

| Upstream | Rust |
| --- | --- |
| `$caretFromPoint(point, direction)` | `caret_from_point(view, &Point, CaretDirection) -> Result<PointCaret, Error>` (Error::CaretFromPointNotText / NotElement) |
| `$setPointFromCaret(point, caret)` | `point_from_caret(view, &PointCaret) -> Result<Point, Error>`; for the active selection, `Transaction::set_point_from_caret(role, caret)` |
| `$setSelectionFromCaretRange(range)` | `Transaction::set_selection_from_caret_range(range) -> Result<(), Error>` |
| `$updateRangeSelectionFromCaretRange(selection, range)` | `Transaction::update_range_selection_from_caret_range(range)` (active); `range_selection_from_caret_range(view, &mut RangeSelection, range)` (value) |
| `$caretRangeFromSelection(selection)` | `caret_range_from_selection(view, &RangeSelection) -> Result<CaretRange, Error>` |
| `$rewindSiblingCaret(caret)` | `SiblingCaret::rewind(self, view) -> Result<NodeCaret, Error>` |
| `$removeTextFromCaretRange(range, sliceMode)` | `Transaction::remove_text_from_caret_range(range, SliceMode) -> Result<CaretRange, Error>`; `SliceMode::{RemoveEmptySlices, PreserveEmptyTextSliceCaret}` (Error::RemoveTextSelectionLost) |
| `$normalizeCaret(caret)` | `normalize_caret(view, PointCaret) -> Result<PointCaret, Error>` |
| `$isExtendableTextPointCaret(caret)` | `TextPointCaret::is_extendable(self, view) -> Result<bool, Error>` |
| `$getCaretInDirection(caret, direction)` | `PointCaret::in_direction(self, view, CaretDirection) -> PointCaret` |
| `$getCaretRangeInDirection(range, direction)` | `CaretRange::in_direction(self, view, CaretDirection) -> CaretRange` |
| `$getChildCaretAtIndex(parent, index, direction)` | `child_caret_at_index(view, parent, ChildIndex, CaretDirection) -> Result<NodeCaret, Error>` |
| `$getAdjacentSiblingOrParentSiblingCaret(caret, rootMode)` | `NodeCaret::adjacent_sibling_or_parent_sibling(self, view, RootMode) -> Option<(NodeCaret, i32)>` |
| `$getAdjacentNodes(caret)` (internal) | `NodeCaret::adjacent_nodes(view) -> Vec<NodeKey>` |
| `$splitTextPointCaret(caret)` (internal) | `Transaction::split_text_point_caret(caret) -> Result<NodeCaret, Error>` |
| `$splitAtPointCaretNext(caret, options)` | `Transaction::split_at_point_caret_next(caret: PointCaret, options: SplitAtPointCaretNextOptions) -> Result<Option<NodeCaret>, Error>` |
| `SplitAtPointCaretNextOptions` | struct below |

```rust
/// `SplitAtPointCaretNextOptions`. Upstream's `$`-callbacks become plain fn pointers with the
/// upstream defaults (`$copyNode`, `$splitTextPointCaret`, always split).
#[derive(Clone, Copy)]
pub struct SplitAtPointCaretNextOptions {
    pub copy_element: fn(&mut Transaction<'_>, NodeKey) -> Result<NodeKey, Error>,
    pub split_text_point_caret: fn(&mut Transaction<'_>, TextPointCaret) -> Result<NodeCaret, Error>,
    pub root_mode: RootMode,                                       // default ShadowRoot
    pub should_split: fn(StateRef<'_>, NodeKey, SplitEdge) -> bool,
    pub remove_empty_destination: bool,
}
impl Default for SplitAtPointCaretNextOptions;
#[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum SplitEdge { First, Last }
```

---

## 11. Commit, changes, diff

### 11.1 Commit

S2: LST-01..LST-09 (LST-01 update payload, LST-02 cleanup returns are n/a, LST-03 text content,
LST-04 mutations per class, LST-05 headless mutations are D-4, LST-06 root listener is view,
LST-09 decorators), UPD-09, TF-08.

```rust
/// Monotonic per editor (and per `KeySource::Shared` counter), starting at 1. Identifies a
/// commit for skips that upstream does by object identity (history, R2-23).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct CommitId(pub u64);

/// What one update produced. Replaces every listener payload: update
/// (`UpdateListenerPayload`), mutation, text content and decorator.
#[derive(Clone, Debug)]
pub struct Commit {
    pub id: CommitId,
    /// `prevEditorState`.
    pub prev: EditorState,
    /// `editorState`.
    pub next: EditorState,
    pub changes: Changes,
    /// `tags`.
    pub tags: TagSet,
    /// `normalizedNodes`: keys merged away or into, in merge order.
    pub normalized: IndexSet<NodeKey>,
    /// `editorStateHasDirtySelection`.
    pub selection_changed: bool,
    /// The composition key after the commit (`editor.isComposing()` at listener time).
    pub composition_key: Option<NodeKey>,
    /// The composition key changed during the update (upstream's forced `_flushSync`).
    pub composition_changed: bool,
    /// `$fullReconcile()` or `set_editor_state`.
    pub full_reconcile: bool,
    /// A handler called `Transaction::prevent_default` (Key/Paste commands, §14.1).
    pub default_prevented: bool,
    /// The early commit made by `Transaction::set_editor_state` inside this transaction
    /// (F-24), oldest first. Its `next` is this commit's `prev`.
    pub preceding: Option<Box<Commit>>,
    /// The `Plugin::after_commit` follow-up commits (§14.2), oldest first. The first one's
    /// `prev` is this commit's `next`. No-op follow-ups are not kept.
    pub following: Vec<Commit>,
    /// A follow-up round that failed and was rolled back (upstream's `_onError` for an update
    /// queued by a listener). The commits before it stand.
    pub follow_up_error: Option<FollowUpError>,
    /// Plugin events emitted by the transaction (§14.5), in emission order.
    pub events: Vec<PluginEvent>,
    /// Feature `bench-counters` only (§0).
    #[cfg(feature = "bench-counters")]
    pub work: WorkCounters,
}

impl Commit {
    /// Nothing dirty and the selection unchanged: upstream would fire no listeners.
    pub fn is_noop(&self) -> bool;
    /// `registerTextContentListener` semantics: compares root text of prev and next. O(n) the
    /// first time per snapshot (memoized, §5.4). Never computed unless asked.
    pub fn text_content_changed(&self) -> bool;
    /// Builds the view diff (§11.2) for the whole chain: `preceding.prev` (or `self.prev`) →
    /// the last `following.next` (or `self.next`). A chain that contains a full-reconcile
    /// commit uses the full-reconcile compare (§8.7); any other chain is computed from the
    /// union of the chain's dirty sets with the per-key `Arc` rule, so it stays O(dirty).
    pub fn diff(&self, options: &DiffOptions) -> Result<Diff, Error>;
    /// `preceding` (flattened), `self`, then `following`, oldest first: the order History and
    /// EditorCore's `Output::commits` use.
    pub fn chain(&self) -> impl Iterator<Item = &Commit> + '_;
    /// Writes the flat encoding (§11.3) directly, without building a typed `Diff` first.
    pub fn encode_diff(&self, options: &DiffOptions, buffer: &mut DiffBuffer) -> Result<(), Error>;
    /// `registerMutationListener(Klass, …)`: mutations of nodes whose exact type is
    /// `registry.resolve_replacements(Node)` (transitive, `LexicalEditor.ts:1253-1255`).
    /// When `Node` is replaced, nodes of type `Node` itself are **not** reported (F-31).
    /// Destroyed nodes are typed from `prev`.
    pub fn mutations_of<Node: NodeType>(&self) -> impl Iterator<Item = (NodeKey, Mutation)> + '_;
}

/// The dirty sets and the mutations derived from them.
#[derive(Clone, Debug, Default)]
pub struct Changes {
    /// `dirtyLeaves`, insertion order.
    pub dirty_leaves: IndexSet<NodeKey>,
    /// `dirtyElements` (`Map<NodeKey, IntentionallyMarkedAsDirtyElement>`), insertion order.
    pub dirty_elements: IndexMap<NodeKey, DirtyIntent>,
    /// Per-node mutation. Order: dirty leaves in insertion order, then dirty elements in
    /// insertion order; on full reconcile, `next` pre-order then destroyed in `prev`
    /// pre-order. Upstream groups per class in reconcile order; conformance compares the
    /// per-class mutation maps **as sets** (F-36).
    pub mutations: IndexMap<NodeKey, Mutation>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DirtyIntent { Intentional, AncestorOfDirty }

/// `NodeMutation`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::Display)]
#[strum(serialize_all = "lowercase")]
pub enum Mutation { Created, Updated, Destroyed }

impl Changes {
    pub fn is_empty(&self) -> bool;
}

/// A failed `Plugin::after_commit` round (§14.2).
#[derive(Clone, Debug)]
pub struct FollowUpError { pub plugin: &'static str, pub error: Error }
```

Mutation rule, which reproduces `setMutatedNode` (`LexicalUtils.ts:1271`) without a
reconciler:
- Created: in `next`, not in `prev`.
- Destroyed: in `prev`, not in `next`.
- Updated: in both, dirty in this commit, and the `Arc<NodeSlot>` differs (`prevNode !==
  nextNode` and `isDirty`). Ancestors marked `AncestorOfDirty` are not cloned (§7.2), so
  typing reports only the text node. Full-reconcile commits use the entry-by-entry map
  compare (§8.7), never ancestor pruning (R2-01).
- A move is Updated, because both the node and its links were written. Upstream reports a
  destroy plus create on the same key as "updated" too.

### 11.2 Diff (typed)

```rust
/// Options for building a Diff.
#[derive(Clone, Copy, Debug, Default)]
pub struct DiffOptions {
    /// Include STATE ops (NodeState changes). Off by default: the DOM ignores NodeState.
    pub include_state: bool,
}

/// A view patch from `prev` to `next`. Built from the chain's dirty sets, or by the
/// full-reconcile map compare (§8.7) when the chain contains a full-reconcile commit.
#[derive(Clone, PartialEq, Debug)]
pub struct Diff {
    pub generation: u32,
    pub full_reconcile: bool,
    /// DOM-first typing: the view already shows this node's text (§15.3).
    pub view_text_matches: Option<NodeKey>,
    pub ops: Vec<DiffOp>,
}

#[derive(Clone, PartialEq, Debug)]
pub enum DiffOp {
    /// In prev, not in next. `subtree_root`: its parent survived, or the parent was also removed
    /// but this node was its parent's child in prev and is listed first.
    Remove { key: NodeKey, subtree_root: bool },
    /// Created node (pre-order of next, parents first). `props` is the exportJSON object minus
    /// the keys carried in typed fields (children, the base fields, type, version, "$").
    CreateElement { key: NodeKey, type_index: NodeTypeIndex, base: ElementProps, props: SerializedNode },
    CreateText { key: NodeKey, type_index: NodeTypeIndex, text: String, base: TextProps, props: SerializedNode },
    CreateDecorator { key: NodeKey, type_index: NodeTypeIndex, props: SerializedNode },
    CreateLineBreak { key: NodeKey, type_index: NodeTypeIndex },
    /// The complete new child order of an element whose child list changed (created
    /// elements included). The host's keyed DOM children diff handles moves.
    Children { parent: NodeKey, children: Vec<NodeKey> },
    Text { key: NodeKey, text: String },
    TextProps { key: NodeKey, props: TextProps },
    ElementProps { key: NodeKey, props: ElementProps },
    NodeProps { key: NodeKey, props: SerializedNode },
    State { key: NodeKey, state: Option<SerializedNode> },
}

#[derive(Clone, PartialEq, Debug)]
pub struct TextProps { pub format: TextFormat, pub mode: TextMode, pub detail: TextDetail, pub style: Arc<str> }
#[derive(Clone, PartialEq, Debug)]
pub struct ElementProps { pub format: ElementFormat, pub indent: u32, pub direction: Option<TextDirection>,
                          pub text_format: TextFormat, pub style: Arc<str>, pub text_style: Arc<str> }
```

Op order: all `Remove` (prev pre-order), then all `Create*` (next pre-order), then
`Children` (next pre-order of parents), then property ops for surviving dirty nodes in dirty
order. In each surviving dirty node, only the changed groups are emitted: text, text props,
element props, own props (compared via `dyn_eq`), state. Clean nodes are never visited, so
the cost is O(dirty + children of elements whose child list changed).

Full-reconcile diffs (undo, `set_editor_state`, `request_full_reconcile`; R2-01) use the
entry-by-entry map compare of §8.7: Created and Destroyed keys by map membership, and property
ops for every key in both maps whose record `Arc`s differ. `Children` ops are emitted for every
element present in `next` whose child sequence differs from `prev`. That set is found without
walking every element: an element's child sequence can differ only if the element's own
record differs (its `first`/`last`/`size`) or a node that is a child of it in `prev` or `next`
is Created, Destroyed or Updated (its links changed), so the candidates are those elements and
the `prev` and `next` parents of every changed key, and each candidate's two sequences are
compared. No subtree is skipped because an ancestor's `Arc` is shared: ancestors are not cloned
when a descendant changes (§7.2), so that pruning would drop the text change of an undo. The
compare is O(nodes) pointer checks (HAMT-shared nodes may be skipped, §8.7), and the ops are
O(changed). Test: type one character, undo, and assert one TEXT op and nothing else.

### 11.3 Flat encoding (wasm boundary)

```rust
/// The diff as two flat buffers: u32 words and a UTF-8 string table. JS reads the words as a
/// `Uint32Array` view over wasm memory and decodes strings lazily with `TextDecoder`
/// (measured 0.25-0.32 µs/node with lazy decoding, `notes-bench.md`).
pub struct DiffBuffer { pub words: Vec<u32>, pub strings: Vec<u8> }

impl Diff {
    /// Appends to `buffer` (cleared first). Reuse one buffer per editor; no allocation in
    /// steady state.
    pub fn encode(&self, buffer: &mut DiffBuffer);
}
/// Bumped on any change to the layout below. Source of truth for the JS decoder (§11.4).
pub const DIFF_FORMAT_VERSION: u32 = 1;
/// `NONE` in a key or optional-key word.
pub const DIFF_NONE: u32 = u32::MAX;

/// The opcode word values, exactly as the table below. `#[repr(u32)]`, strum-derived names.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, strum::EnumIter, strum::IntoStaticStr)]
#[repr(u32)]
pub enum DiffOpcode {
    Remove = 1, CreateElement = 2, CreateText = 3, CreateDecorator = 4, CreateLineBreak = 5,
    Children = 6, Text = 7, TextProps = 8, ElementProps = 9, NodeProps = 10, State = 11,
}
```

Word conventions (normative):
- Every word is a little-endian `u32` (wasm memory is little-endian; JS `Uint32Array` over
  `memory.buffer` reads it natively). `words` is 4-byte aligned by construction.
- **key**: one word, `NodeKey::index` (`ROOT` = 0). The generation is header word 1, and a
  diff never mixes generations (a state never does, F-47).
- **type**: one word, `NodeTypeIndex` zero-extended from `u16`; the view maps it to a type
  name through `Registry::types()`, sent once per editor.
- **str**: two words, `byte_offset, byte_len`, into `strings` (UTF-8, no terminator, no
  alignment padding inside the table). `""` is `(0, 0)`. Offsets are bytes; JS decodes with
  `TextDecoder('utf-8', { fatal: true })` and works in UTF-16 from the decoded string.
- **bool**: one word, 0 or 1. Any other value is a decode error.
- **json**: a str holding compact JSON (`serde_json::to_writer`, upstream key order). For
  props, `(0, 0)` means `{}`. For STATE, `(0, 0)` means `None` (no NodeState); a present state
  is never `""`, because an object prints at least `{}`.
- Enumerations: element `format` = `ElementFormat::bits()` (Unset 0, Left 1, Center 2,
  Right 3, Justify 4, Start 5, End 6); `direction` 0 none, 1 ltr, 2 rtl; text `mode` 0 normal,
  1 token, 2 segmented; text `format` = `TextFormat` bits; `detail` = `TextDetail` bits;
  `text_format` = `TextFormat` bits; `indent` = the virtual `indent` value.

Header (5 words):

| Word | Field |
| ---: | --- |
| 0 | `DIFF_FORMAT_VERSION` |
| 1 | key generation |
| 2 | flags: bit 0 FULL_RECONCILE, bits 1-31 zero |
| 3 | `view_text_matches` key, or `DIFF_NONE` |
| 4 | op count |

Ops follow, each an opcode word then its payload. Word counts are fixed per opcode except
CHILDREN:

| Opcode | Name | Payload, in order | Payload words |
| ---: | --- | --- | ---: |
| 1 | REMOVE | key, subtree_root: bool | 2 |
| 2 | CREATE_ELEMENT | key, type, format, indent, direction, text_format, style: str, text_style: str, props: json | 12 |
| 3 | CREATE_TEXT | key, type, format, mode, detail, text: str, style: str, props: json | 11 |
| 4 | CREATE_DECORATOR | key, type, props: json | 4 |
| 5 | CREATE_LINE_BREAK | key, type | 2 |
| 6 | CHILDREN | parent: key, n, key × n | 2 + n |
| 7 | TEXT | key, text: str | 3 |
| 8 | TEXT_PROPS | key, format, mode, detail, style: str | 6 |
| 9 | ELEMENT_PROPS | key, format, indent, direction, text_format, style: str, text_style: str | 9 |
| 10 | NODE_PROPS | key, props: json | 3 |
| 11 | STATE | key, state: json | 3 |

Op order is §11.2's. The decoder fails (and the host re-renders from a full diff) on an
unknown opcode, a version mismatch, a non-zero reserved flag bit, a str range outside
`strings`, or an op count that does not end exactly at `words.len()`. Props JSON is decoded
only for nodes the view renders from props (decorators, headings, list types).

### 11.4 Cross-boundary encoding (audit R2-3 F18)

`lexical_model` is free of wire concerns: `Input`, `Command`, `Output`, `Commit` and `Diff`
have no serde, bebop or postcard derives and the crate has no wire module (F18 point 4; this
closes the open "postcard encoding of `Input`" requirement S7 placed on S1). The session
adapter (`document_session_wasm`, S7) owns the boundary with three encodings, each chosen for
its call rate:

1. **Hot calls: wasm-bindgen primitives.** `textFromView`, `selectionFromView`, `command(code,
   a, b, text)`, plus S7's socket and tick calls. The adapter builds the `Input` from the
   arguments directly. `lexical_model` provides the pieces it needs without an intermediate
   encoding: `NodeKey::from_parts(KeyParts)`, `Utf16Offset`, `ChildIndex`, and
   `text_from_utf16(units: &[u16]) -> Result<String, Error>` (strict, `Error::LoneSurrogate`,
   Q6). Numeric command codes are not a `lexical_model` concept: the code table is a bebop
   enum in `session.bop`, mapped to `Command` variants by hand in the adapter.
2. **View diff: §11.3's flat layout**, written by `Commit::encode_diff` straight into the
   session's output buffer (S7 §4.2 places the words and string table after its own header).
   Wasm only: the native FFI passes the typed `Diff` as uniffi records.
3. **Everything else crossing JS ↔ wasm: bebop**, from one schema,
   `crates/client/document_session_wasm/abi/session.bop` (owned by S7). Cold inputs (commands
   with payloads, composition, Node selections, `SetState`) cross as an `EditorInputMsg`
   union that mirrors only what JS can send cold; `SerializedEditorState` and props cross as
   JSON strings inside it. `Error` crosses as `kind()` plus its `Display` text.

Versioning. `ABI_MAJOR` is a `const` in `session.bop`, generated into Rust and TS;
`create(abiMajor, …)` throws `AbiMismatch` unless the two majors are equal (no fallback).
`session.bop` also declares `const uint32 DIFF_FORMAT_VERSION` and `enum DiffOpcode : uint32`
mirroring §11.3; `document_session_wasm` asserts at compile time that
`lexical_model::DIFF_FORMAT_VERSION` equals the generated constant, and a unit test asserts
every `lexical_model::DiffOpcode` value equals the generated enum value of the same name, so
`lexical_model` stays the source of truth and the generated TS decoder cannot drift. A change
to §11.3 bumps `DIFF_FORMAT_VERSION`, which fails that assertion until `session.bop` and
`ABI_MAJOR` are bumped with it. CI fails when the generated files are stale. The JS decoder
also checks header word 0 at run time.

---

## 12. History (`@lexical/history`)

S2: HIS-01..HIS-83. Line cites are v0.45.0 (`lexical-history/src/index.ts`: `getChangeType`
:97, `isTextNodeUnchanged` :203, `createMergeActionGetter` :238, `redo` :358, `undo` :394,
`clearHistory` :430, `registerHistory` :463, `applyChange` :483, `createEmptyHistoryState`
:593, `HistoryExtension` :679, `SharedHistoryExtension` :771; audit R2-2 row x).

A port of `registerHistory` and `createMergeActionGetter`. History is a value the host or
`EditorCore` owns. It sees each `Commit` once. For collaborative surfaces S7 uses Loro's
`UndoManager` instead (`CoreConfig.history = None`, Q12 closed); this `History` serves headless
and non-collaborative editors and Tier A replay. A session that needs only the merge
classification uses `MergeTracker` alone, which keeps no `EditorState` (audit R2-3 F36).

```rust
/// Host clock in milliseconds (upstream `dateNow`). The core never reads a clock (sans-IO).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct HistoryTime(pub u64);

/// `HistoryConfig` minus `disabled` (don't construct a History) and `now` (pass HistoryTime).
/// Upstream's `delay` and `maxDepth` may be signals; `History::set_config` is the
/// reconfiguration (`delayOrSignal.peek()` reads the current value at each evaluation).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct HistoryConfig {
    /// `delay`, default 300 ms.
    pub delay_ms: u64,
    /// `maxDepth`: FIFO-evict beyond this many undo entries (None = unbounded, the default).
    pub max_depth: Option<NonZeroU32>,
}
impl Default for HistoryConfig;

/// The closure state of `createMergeActionGetter` (HIS-30): `prevChangeTime`,
/// `prevChangeType`, and the composition-start triple. Classifies commits without retaining
/// history entries.
#[derive(Clone, Debug)]
pub struct MergeTracker { /* prev_change_time, prev_change_type, composition_start: Option<(HistoryTime, ChangeType, EditorState)>, delay_ms */ }
impl MergeTracker {
    /// `prevChangeTime = dateNow()` at creation (HIS-30), so `now` is required.
    pub fn new(delay_ms: u64, now: HistoryTime) -> MergeTracker;
    /// One evaluation of the getter for `commit` (rules below). Updates the tracker as
    /// upstream does. Upstream's `currentHistoryEntry` argument only feeds `isSameEditor`,
    /// which is always true here (HIS-42), so it is not a parameter (R2.1: S11's
    /// `MergeActionGetter::action(commit, now)` is this method).
    pub fn classify(&mut self, commit: &Commit, now: HistoryTime) -> HistoryAction;
    pub fn set_delay(&mut self, delay_ms: u64);
}

/// `HistoryState { current, undoStack, redoStack }`. Entries are snapshots (O(1) clones).
/// Upstream's `entry.editor` (shared history across nested editors) is n/a.
#[derive(Clone)]
pub struct History { current: Option<EditorState>, current_commit: Option<CommitId>,
                     undo_stack: Vec<EditorState>, redo_stack: Vec<EditorState>,
                     tracker: MergeTracker, config: HistoryConfig }

/// `MergeAction`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HistoryAction { Merge, Push, Discard }

/// `ChangeType`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ChangeType { Other, ComposingCharacter, InsertCharacterAfterSelection,
                      DeleteCharacterBeforeSelection, DeleteCharacterAfterSelection }

/// `CAN_UNDO_COMMAND` / `CAN_REDO_COMMAND`: both current values, reported whenever upstream
/// dispatches either command (HIS-50..HIS-64), not only when a value flips.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct HistoryAvailability { pub can_undo: bool, pub can_redo: bool }

impl History {
    /// `createEmptyHistoryState()` plus `registerHistory(…, delay, dateNow)`.
    pub fn new(config: HistoryConfig, now: HistoryTime) -> History;
    /// `createInitialHistoryState`: seed stacks (e.g. shared history).
    pub fn with_stacks(config: HistoryConfig, now: HistoryTime, current: Option<EditorState>,
                       undo: Vec<EditorState>, redo: Vec<EditorState>) -> History;
    /// The update listener (`applyChange`, `index.ts:483`). Returns what it did and, when
    /// upstream would dispatch CAN_UNDO/CAN_REDO, the availability. Records each commit at
    /// most once: a second `record` of the same `CommitId` is a no-op (R2-23).
    pub fn record(&mut self, commit: &Commit, now: HistoryTime) -> (HistoryAction, Option<HistoryAvailability>);
    /// `undo(editor, historyState)` (`index.ts:394`): pops, pushes `current` to redo, sets
    /// `current` to the popped entry, then `set_editor_state(entry, {historic})`, and records
    /// the resulting commit. `Ok(None)` when the stack is empty.
    pub fn undo(&mut self, editor: &mut Editor, now: HistoryTime) -> Result<Option<Commit>, Error>;
    pub fn redo(&mut self, editor: &mut Editor, now: HistoryTime) -> Result<Option<Commit>, Error>;
    /// The UNDO_COMMAND handler body, inside a running transaction (upstream's history
    /// plugin is a command listener): pops and calls `tx.set_editor_state(entry, {historic})`
    /// (§7.2), which seals the transaction. Returns whether an entry was applied. The command
    /// counts as handled either way (HIS-62: upstream returns true on an empty stack). The
    /// caller records every commit of `commit()`'s chain with `record` (F-24).
    pub fn undo_in(&mut self, tx: &mut Transaction<'_>) -> Result<bool, Error>;
    pub fn redo_in(&mut self, tx: &mut Transaction<'_>) -> Result<bool, Error>;
    /// `clearHistory` (`:430`): stacks replaced, `current = None`, `current_commit = None`.
    /// CLEAR_EDITOR_COMMAND calls it and is **not** handled (returns false so ClearEditor
    /// runs) and reports nothing (HIS-63). CLEAR_HISTORY_COMMAND calls it, is handled, and
    /// reports `{can_undo: false, can_redo: false}` (HIS-64).
    pub fn clear(&mut self);
    /// Reconfiguration (upstream's `delay`/`maxDepth` signals). A smaller `max_depth` takes
    /// effect at the next Push, as upstream reads it there.
    pub fn set_config(&mut self, config: HistoryConfig);
    pub fn config(&self) -> HistoryConfig;
    pub fn availability(&self) -> HistoryAvailability;
    pub fn undo_depth(&self) -> usize;
    pub fn redo_depth(&self) -> usize;
}
```

Merge heuristics, ported exactly:
- `getChangeType(prev, next, dirtyLeaves, dirtyElements, isComposing)` (`index.ts:97`, HIS-10
  ..HIS-18) uses the commit's dirty sets, the selections, and `commit.composition_key.is_some()`
  for `isComposing`. In order: `prev` null, or no dirty leaves, no dirty elements and not
  composing → Other (HIS-10); composing → ComposingCharacter, checked before the selection
  checks (HIS-11); either selection not a range, or either not collapsed → Other (HIS-12).
  The dirty-node set is the dirty leaves present in `next` plus the `Intentional` dirty
  elements other than root (`getDirtyNodes`, `:66`, HIS-13); none → Other (HIS-14). More than
  one → INSERT_CHARACTER_AFTER_SELECTION iff the next anchor node is a text node absent from
  `prev` whose text length equals the anchor offset (the first-character case, HIS-15).
  Exactly one: both versions must be text nodes with the same mode and different text, the
  anchors must share the key and the next anchor must be a text point, and a ±1 length change
  with the matching offset shift gives INSERT_CHARACTER_AFTER / DELETE_CHARACTER_BEFORE /
  DELETE_CHARACTER_AFTER; anything else is Other (HIS-16..HIS-18).
- `isTextNodeUnchanged` (`:203-235`, HIS-20, HIS-21) compares
  `to_js_json_string(export_node(..))` of the node in both states (a string compare,
  order-sensitive, as upstream's `JSON.stringify` compare; `serde_json::Map` equality would
  ignore order, F-48) under the same guards: same parent, and not the "deleting line"
  selection shape (prev anchor and focus both element points, next both text points).
- `createMergeActionGetter` (`:238-353`), evaluated by `MergeTracker::classify`:
  1. COMPOSITION_START tag: save the prior time, type and `prev` state (HIS-31).
  2. HISTORIC tag: set type = Other, time = now, return Discard (HIS-32).
  3. COMPOSITION_END tag with a saved state: evaluate against the saved time, type and `prev`
     (HIS-33).
  4. Compute the change type. Then decide (`:296-348`):
     - HISTORY_MERGE tag and no HISTORY_PUSH tag → Merge (HIS-34).
     - ComposingCharacter → Discard (HIS-35).
     - `prev` is null → Push (HIS-36; never true in Rust, every commit has a `prev`).
     - No dirty leaves and no dirty elements → Merge if `next` has a selection, else
       Discard (HIS-37).
     - No HISTORY_PUSH tag, type ≠ Other, type == previous type, `now < previous time +
       delay` → Merge (HIS-38).
     - Exactly one dirty leaf and `isTextNodeUnchanged` → Merge (HIS-39).
     - Else Push (HIS-40).
  5. After every non-HISTORIC evaluation, whatever the result (Discard included), set the
     previous time to `now` and the previous type to this change type (`:350-351`, HIS-41).
  HISTORY_PUSH suppresses only the HISTORY_MERGE rule and the delay rule (R2-24): the
  composing Discard, the no-dirty Merge and the unchanged-leaf Merge still apply under it.
  `isSameEditor` is always true (HIS-42; one `History` per editor).
- `applyChange` (`:483-545`, HIS-50..HIS-56):
  - Skip only if `commit.id == current_commit` (R2-23, HIS-51). Never skip on `same_snapshot`:
    upstream's `editorState === current.editorState` never fires after an undo or redo,
    because `setEditorState` clones the state, while Rust installs the entry's map unchanged.
    With a snapshot skip, the HISTORIC commit of an undo would never reach the getter, the
    tracker would keep INSERT_CHARACTER, and the next keystroke within `delay` would merge
    into the restored entry and lose an undo step. Fixture: type, undo, type within 300 ms,
    undo, and check that the second undo restores the post-first-undo state.
  - Classify. On Push: if redo is non-empty, clear it and report (can_redo false); if
    `current` is set, push it, evict past `max_depth` from the front, and report (can_undo
    true) (HIS-52). The first commit after construction with `current = None` pushes nothing
    and only sets `current` (HIS-56, ported as is).
  - On Discard, return (HIS-53). Otherwise set `current = next` and `current_commit =
    commit.id` (HIS-54).
- `undo` / `redo` (`:358-428`, HIS-60, HIS-61): undo pushes `current` to redo (report
  can_redo true), pops undo (report can_undo false when it becomes empty), sets `current` to
  the popped entry and `current_commit = None`, then installs it with the HISTORIC tag. Redo is
  symmetric. The resulting HISTORIC commit goes through `record`, whose getter resets the
  tracker and discards it (HIS-32). An empty stack is a no-op that still counts as handled
  (HIS-62).

`@lexical/history` export mapping (audit R2-2 T1a):

| Upstream | Rust |
| --- | --- |
| `registerHistory(editor, state, delay, dateNow, onChange, maxDepth)` | `History::new(config, now)` + `History::record` on each commit + `EditorCore` routing UNDO/REDO/CLEAR_* to it (§15.1). `onHistoryStateChange` is n/a: the caller reads the `History` after each call (HIS-55) |
| `createEmptyHistoryState()` | `History::new` (empty stacks) |
| `HistoryState` | `History` |
| `HistoryStateEntry` | `EditorState` (the `editor` field is n/a: one `History` per editor) |
| `HistoryConfig` | `HistoryConfig`; `disabled` → `CoreConfig.history = None`; `createInitialHistoryState` → `History::with_stacks` |
| `HistoryExtension` | `CoreConfig.history` (EditorCore owns the `History`) |
| `HistoryExtensionOutput` | `History::availability()` (`canUndo`/`canRedo`, derived from the stack lengths, HIS-74) and `History::config()` (`delay`, `maxDepth`); signals (HIS-70..HIS-73) are n/a |
| `SharedHistoryExtension`, `SharedHistoryConfig` | n/a (HIS-80..HIS-83): nested editors are separate `Editor`s (D-20); a host that wants a shared stack passes one `History` to both cores' undo routing. Stays upstream JS in the shim |

---

## 13. JSON import/export

S2: JSON-01..JSON-09 (JSON-09 text key order), NS-08, NS-12, EL-18, ID-12.

### 13.1 Types

```rust
/// One node's JSON object, ordered (`serde_json` with `preserve_order`). Upstream
/// `SerializedLexicalNode` and every `Serialized*Node` type.
pub type SerializedNode = serde_json::Map<String, serde_json::Value>;

/// `SerializedEditorState` (`{root: SerializedRootNode}`). Upstream does not serialize the
/// selection.
#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
pub struct SerializedEditorState { pub root: SerializedNode }

/// `NODE_STATE_KEY`.
pub const NODE_STATE_KEY: &str = "$";

/// Which parts of `updateFromJSON` a custom `NodeType::import` applies (CR-12).
#[derive(Clone, Copy, Debug)]
pub struct JsonImport {
    /// `$` / flat NodeState keys to import.
    pub state: StateImportFilter,
    /// The kind's base fields (ElementNode/TextNode `updateFromJSON`).
    pub base_fields: bool,
    /// The struct's own `update_from_json`.
    pub own_fields: bool,
}
impl JsonImport {
    /// Everything: upstream's full `updateFromJSON`.
    pub const FULL: JsonImport;
}
/// Which NodeState keys survive an import.
#[derive(Clone, Copy, Debug)]
pub enum StateImportFilter {
    All,
    /// Only these names (Macro `$applyIdFromSerialized` = `Only(&["id"])`,
    /// `$applyPeerIdFromSerialized` adds `"peerId"`). The rest is dropped, not kept in
    /// `unknown`.
    Only(&'static [&'static str]),
    None,
}

/// `JSON.stringify(value)` byte-for-byte (CR-13): integer-like object keys (canonical
/// array indices `0..=2^32-2`) first in ascending order, then the rest in insertion order;
/// numbers through `js_number`; strings escaped as JS does. `export_node` → string, the
/// corpus comparison and history's `isTextNodeUnchanged` use it. S3's `js_json` re-exports it.
pub fn to_js_json_string(value: &serde_json::Value) -> String;
```

The typed `SerializedElementNode`, `SerializedTextNode`, `SerializedParagraphNode`,
`SerializedRootNode`, `SerializedTabNode` and `SerializedLineBreakNode` are not separate Rust
types (CS-69). Their shape is the export rule below. `LexicalExportJSON<T>` and
`LexicalUpdateJSON<T>` are type-level only (n/a).

### 13.2 Export shape and key order

Key order matches upstream's object spread order, so `JSON.stringify` output is
byte-identical (the corpus test in SCOPE §4 Tier C needs it):

| Kind | Keys, in order |
| --- | --- |
| Element (any) | `children`, `direction`, `format`, `indent`, `type`, `version`, flat state keys, `"$"`?, `textFormat`?, `textStyle`?, own fields, `adjust_export_json` additions |
| Text (any) | `detail`, `format`, `mode`, `style`, `text`, `type`, `version`, flat state keys, `"$"`?, own fields, additions |
| Decorator | `type`, `version`, flat state keys, `"$"`?, own fields, additions |
| LineBreak | `type`, `version`, flat state keys, `"$"`? |

Rules:
- Element base keys come from the **virtual** getters (`ElementNode.exportJSON`,
  `LexicalElementNode.ts:639-646`): `direction`: `"ltr" | "rtl" | null`; `format`: the
  ElementFormat string (`""` when Unset); `indent`: `Read::indent(key)`, the virtual
  `getIndent` (ListItemNode overrides it, F-33).
- A base key whose `AbsentKeys` bit is set is omitted, as `JSON.stringify` drops `undefined`
  (element `indent`, `direction`; text `format`, `detail`, `mode`, `style`, `text`) (F-29).
- Element `textFormat`/`textStyle` (`LexicalElementNode.ts:639`): present only when they are
  non-zero/non-empty, the node is not root or shadow root, and it has no Text-kind child.
- Paragraph's `adjust_export_json` (#7971): if either key is absent, set both from the first
  Text child, else from the element's own values.
- Text `format`/`detail`: integers. `mode`: string.
- `version`: `json_version()` (1 for every built-in).
- Children are exported recursively through the virtual export (`exportNodeToJSON`).
- Own fields are the struct's serde output, which must be a JSON object: node structs are
  braced (§3.3). A subclass struct that contains its parent uses
  `#[serde(flatten)]` on the parent field, so the parent's fields come first, as
  `...super.exportJSON()` does.

### 13.3 Import

`Editor::parse_editor_state` → `Transaction::import_node(root)`, recursively
(`$parseSerializedNodeImpl`, `LexicalUpdates.ts:385-417`):
1. Look up `type` (Error::UnknownSerializedType: `parseEditorState: type "%s" + not found`,
   or an opaque record with `opaque_unknown_types`, D-23).
2. Call that type's `NodeType::import(tx, json)` (§3.2). Root's updates the existing root.
   The default creates the node with replacement from `import_json`, then calls the
   **virtual** `update_from_json`, so a replacement (`ListNode → TaskListNode`) runs its own
   `update_from_json` and round-trips its own fields (CR-3). An override may return another
   type (CR-11) or apply only part of the JSON through `update_from_json_with` (CR-12).
3. `update_from_json` (`JsonImport::FULL`) applies, in upstream order (`LexicalNode.ts:1268`,
   `LexicalElementNode.ts:668-678`, `LexicalTextNode.ts:648-656`, which call
   `super.updateFromJSON` first):
   1. NodeState (§6);
   2. the kind's base setters, through their virtual hooks:
      - element: `set_format`, the **virtual** `set_indent` (ListItemNode's restructures the
        list, `lexical-list/src/LexicalListItemNode.ts:497-510`), `set_direction`,
        `set_text_format(textFormat || 0)`, `set_text_style(textStyle || "")`;
      - text: `text`, `format`, `detail`, `mode`, `style`, each through its coerce hook;
   3. the struct's `NodeType::update_from_json`.
4. If the node returned by step 2 is an element and the JSON has a `children` array, import
   each child and `append` it (virtual).

Absent and null keys:
- Element `format` absent → Unset (`setFormat` maps undefined to 0). `textFormat`/`textStyle`
  absent → 0 / "" (`|| 0`).
- Element `indent`/`direction` and text `format`/`detail`/`mode`/`style`/`text` absent →
  the Rust default is stored and the `AbsentKeys` bit is set, so export omits the key again
  (upstream stores `undefined`). Reads see the default; upstream reads `undefined`, which
  differs in arithmetic on it (`undefined + 1` is NaN), in `=== null` checks, and in `=== 0`
  checks. The `=== 0` case is reproduced where the core makes it: `isSimpleText` is
  `__mode === 0`, so a text node with `mode` absent is **not** simple (never normalized,
  merged or removed when empty, §8.2-§8.3), and `is_simple_text` tests `!absent(mode)`
  (R2-06; fixture: two adjacent text nodes, one without `mode`, do not merge). `isToken` and
  `isSegmented` stay false for an absent mode, as upstream (D-22).
  The setter for the field clears the bit. A dev-corpus scan for such JSON is a M1 task.
- Unknown top-level keys are ignored. Unknown NodeState keys pass through verbatim.

`apply_remote_fields` (`NodeChange::Update`) writes base fields raw: no virtual setters, no
coerce hooks, no selection side effects; NodeState and the struct's fields are replaced from
the JSON as given.

### 13.4 Unknown NodeState passthrough

NodeState keys not declared by any registered `StateKey` stay in `NodeState::unknown`. They
keep insertion order and their JSON values unchanged, and they round-trip on export. This
is how a Rust editor that does not know a web-only key (`pinnedPropertyIds`) preserves it.

### 13.5 Numbers

JavaScript has one number type: `JSON.stringify(2)` is `"2"`, while serde_json prints
`2.0` for an f64. Every core numeric field is an integer type. For user values:

```rust
/// JS-compatible JSON number: integral f64 within ±2^53 → integer `Value`; NaN/±∞ → `null`
/// (as JSON.stringify); otherwise the shortest round-trip float.
pub fn js_number(value: f64) -> serde_json::Value;
```

```rust
/// `Boolean(value)`: false for null, false, 0, -0, NaN and ""; true otherwise.
pub fn js_truthy(value: &serde_json::Value) -> bool;
```

`StateValue for f64` uses `js_number`. Node structs with float fields annotate them with
`#[serde(serialize_with = "lexical_model::json::serialize_js_number")]`.

### 13.6 `@lexical/file`

S2 targets the model half of `@lexical/file` at `lexical_model` (audit R2-2 T1a). `exportFile`
/`importFile` are view (file pickers and downloads).

```rust
/// `SerializedDocument` (`lexical-file/src/fileImportExport.ts:9-18`).
#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedDocument {
    pub editor_state: SerializedEditorState,
    /// Epoch milliseconds.
    pub last_saved: u64,
    /// `"Lexical"` unless set.
    pub source: String,
    /// The `@lexical/file` package version that wrote it; Rust writes `LEXICAL_VERSION`.
    pub version: String,
}
impl SerializedDocument {
    /// `serializedDocumentFromEditorState(state, {source, lastSaved})`. Upstream defaults
    /// `lastSaved` to `Date.now()` (`config.lastSaved || Date.now()`); the core reads no clock,
    /// so the host passes `now`, and `last_saved: Some(0)` falls back to `now` as `||` does.
    /// `source: Some("")` falls back to `"Lexical"` likewise.
    pub fn from_state(state: &EditorState, source: Option<&str>, last_saved: Option<u64>,
                      now: HistoryTime) -> Result<SerializedDocument, Error>;
}
impl Editor {
    /// `editorStateFromSerializedDocument(editor, doc | string)`: `parse_editor_state` of
    /// `doc.editor_state`. The string form parses JSON first (`Error::Json`).
    pub fn state_from_serialized_document(&mut self, document: &SerializedDocument) -> Result<EditorState, Error>;
    pub fn state_from_serialized_document_str(&mut self, document: &str) -> Result<EditorState, Error>;
}
```

---

## 14. Commands, plugins, extension state

S2: CMD-01..CMD-50 (CMD-03 dispatch order, CMD-04 per-level update and parent-editor walk
(D-20), CMD-07 unregister is n/a, CMD-09 default core handlers are view, CMD-25 and CMD-31 are the
view's key and `beforeinput` mapping, CMD-50 `DRAG_DROP_PASTE` is a rich-text command, S3),
EXT-01..EXT-09 (§14.4), TF-08 (§14.2 follow-up cascade guard).

### 14.1 Command

```rust
/// Model-level commands. The pure DOM-event commands (CLICK, DRAG*, FOCUS/BLUR,
/// BEFORE_INPUT, INPUT, COPY, CUT) stay in the view, which translates them into these (§17).
/// The keyboard and paste commands are BRIDGE (S2 CMD-21/33/35/38): their handlers are
/// model code in rich-text, list, table, code, markdown shortcuts and Macro plugins, at
/// their own priorities, so they are commands with plain-data payloads (F-16). `Clone` and
/// `PartialEq`, so `Batch` replay and fuzz shrinking can copy and compare them (R2-58).
#[derive(Clone, PartialEq, Debug)]
pub enum Command {
    /// CONTROLLED_TEXT_INSERTION_COMMAND (string payload).
    InsertText(String),
    /// DELETE_CHARACTER_COMMAND(isBackward).
    DeleteCharacter { direction: EditDirection, target: ModifyTarget },
    /// DELETE_WORD_COMMAND. `character_target` is the layout answer for the
    /// `deleteCharacter` fallback when the word extension leaves the selection collapsed
    /// (R2-21, §9.4).
    DeleteWord { direction: EditDirection, target: ModifyTarget, character_target: ModifyTarget },
    /// DELETE_LINE_COMMAND. As `DeleteWord`.
    DeleteLine { direction: EditDirection, target: ModifyTarget, character_target: ModifyTarget },
    /// REMOVE_TEXT_COMMAND.
    RemoveText,
    /// INSERT_PARAGRAPH_COMMAND.
    InsertParagraph,
    /// INSERT_LINE_BREAK_COMMAND(selectStart).
    InsertLineBreak { select_start: bool },
    /// INSERT_TAB_COMMAND.
    InsertTab,
    /// INDENT_CONTENT_COMMAND / OUTDENT_CONTENT_COMMAND.
    IndentContent,
    OutdentContent,
    /// FORMAT_TEXT_COMMAND.
    FormatText(TextFormatType),
    /// FORMAT_ELEMENT_COMMAND.
    FormatElement(ElementFormat),
    /// SELECT_ALL_COMMAND (payload: the KeyboardEvent, if any).
    SelectAll(Option<KeyEvent>),
    /// SELECTION_CHANGE_COMMAND. The host may dispatch it after Effect::SelectionChange.
    SelectionChange,
    /// SELECTION_INSERT_CLIPBOARD_NODES_COMMAND `{nodes, selection}`
    /// (`lexical-clipboard/src/clipboard.ts:395-408`): detached nodes created in this
    /// transaction and the selection to insert them at (R2-07). The table handler reads
    /// `selection` (`LexicalTablePluginHelpers.ts:455`). Only dispatched inside a transaction
    /// (S3 `insert_generated_nodes`); a `Detached` slot in an EditorCore `Input` is
    /// `Error::UnknownSelectionSlot`.
    InsertClipboardNodes { nodes: Vec<NodeKey>, selection: SelectionSlot },
    /// KEY_DOWN_COMMAND: every keydown the view does not swallow (Macro typeahead listens).
    KeyDown(KeyEvent),
    /// KEY_ENTER / KEY_BACKSPACE / KEY_DELETE / KEY_TAB / KEY_ESCAPE / KEY_SPACE /
    /// KEY_ARROW_* / MOVE_TO_START / MOVE_TO_END / KEY_MODIFIER_COMMAND. `event` is None
    /// when dispatched programmatically (upstream passes `null`).
    Key { command: KeyCommand, event: Option<KeyEvent> },
    /// PASTE_COMMAND with the clipboard read into plain data.
    Paste(ClipboardPayload),
    /// CLEAR_EDITOR_COMMAND. Semantics (`$onClear`) are the ClearEditor plugin's, in
    /// lexical_rich_nodes (S3, XB-04); it calls `queue_update`, as upstream's
    /// `editor.update($onClear)`.
    ClearEditor,
    /// CLEAR_HISTORY_COMMAND.
    ClearHistory,
    /// UNDO_COMMAND / REDO_COMMAND, offered to plugins before History (Macro's Loro undo
    /// claims them at CRITICAL).
    Undo,
    Redo,
    /// `createCommand()` for application commands (Macro: INITIALIZE_DOCUMENT_IDS, FORCE_SYNC).
    Extension(ExtensionCommand),
}

/// Which key command (`LexicalCommands.ts`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum KeyCommand { Enter, Backspace, Delete, Tab, Escape, Space, ArrowUp, ArrowDown,
                      ArrowLeft, ArrowRight, MoveToStart, MoveToEnd, Modifier }

/// The parts of a `KeyboardEvent` model handlers read.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct KeyEvent {
    /// `event.key` (`"Enter"`, `"a"`, …).
    pub key: Arc<str>,
    /// `event.code`.
    pub code: Arc<str>,
    pub shift: bool, pub alt: bool, pub ctrl: bool, pub meta: bool, pub repeat: bool,
    /// `event.isComposing`.
    pub is_composing: bool,
}

/// `ClipboardEvent.clipboardData` (or the InputEvent's `dataTransfer`) read by the view.
#[derive(Clone, PartialEq, Debug, Default)]
pub struct ClipboardPayload {
    /// `getData(type)` for each type in `types`, in `types` order
    /// (`application/x-lexical-editor`, `text/html`, `text/plain`, `text/uri-list`, …).
    pub data: IndexMap<String, String>,
    /// `types.includes('Files')`. The files themselves stay in the view (uploads are IO).
    pub has_files: bool,
    /// The view's HTML import of `text/html` (R2.1, S12 V-4 and §1.9): `$generateNodesFromDOM`
    /// run over draft nodes in JS, as serialized nodes with children. Set whenever `text/html`
    /// is present and `application/x-lexical-editor` is not; `None` otherwise, and on native
    /// views (no HTML import, S12 §3.7). The rich-text paste handler (S3
    /// `insert_data_transfer_for_rich_text`) imports these with
    /// `$generateNodesFromSerializedNodes` (replacements and normalization applied) where
    /// upstream calls `$generateNodesFromDOM`; Rust never sees a DOM.
    pub html_nodes: Option<Vec<SerializedNode>>,
}
impl ClipboardPayload { pub fn get(&self, mime: &str) -> Option<&str>; }

/// The identity of an application command, like `StateKey`: a `static`, compared by
/// address (Q3, F-44).
pub struct CommandKey<Payload: Clone + fmt::Debug + Send + Sync + 'static> { name: &'static str, payload: PhantomData<fn() -> Payload> }
impl<Payload: Clone + fmt::Debug + Send + Sync + 'static> CommandKey<Payload> {
    pub const fn new(name: &'static str) -> CommandKey<Payload>;
    pub fn name(&self) -> &'static str;
}

/// An application command: a typed key plus its payload (stored as
/// `Arc<dyn Any + Send + Sync>`, so the command is `Clone`). `PartialEq` compares the key by
/// address and the payload by `Arc` identity (a clone of a command equals it; two separately
/// built commands with equal payloads do not), which is what replay and shrinking need.
#[derive(Clone, Debug)]
pub struct ExtensionCommand { /* key: &'static dyn AnyCommandKey, payload: Arc<dyn Any + Send + Sync> */ }
impl PartialEq for ExtensionCommand;
impl ExtensionCommand {
    pub fn new<Payload: Clone + fmt::Debug + Send + Sync + 'static>(key: &'static CommandKey<Payload>, payload: Payload) -> ExtensionCommand;
    /// The payload if this command is `key`.
    pub fn payload<Payload: Clone + fmt::Debug + Send + Sync + 'static>(&self, key: &'static CommandKey<Payload>) -> Option<&Payload>;
}

impl Command {
    /// The listener-list key.
    pub fn kind(&self) -> CommandKind;
}
/// Fieldless discriminant of `Command`, hand-written because `Extension` carries its key:
/// `InsertText`, …, `Key(KeyCommand)`, `Paste`, …, `Extension(&'static dyn AnyCommandKey)`
/// (equality by address). Const-constructible, so plugins can list it in statics.
#[derive(Clone, Copy, Debug)]
pub enum CommandKind { /* one variant per Command variant */ }
impl PartialEq for CommandKind; impl Eq for CommandKind; impl Hash for CommandKind;
```

A Key or Paste handler that would call `event.preventDefault()` calls `tx.prevent_default()`.

### 14.2 Plugin

```rust
/// `registerCommand` handlers, grouped per extension. Behaviour is immutable: `&self`.
/// Mutable plugin state lives in ExtensionState (§14.3), which is staged in the transaction,
/// so it rolls back with it and a handler can re-dispatch (re-entrant, as upstream).
pub trait Plugin: Send + Sync + 'static {
    /// Diagnostic name (upstream extension `name`).
    fn name(&self) -> &'static str;
    /// The commands this plugin listens to, each with upstream's priority and placement
    /// (one upstream extension registers different commands at different priorities;
    /// table uses CRITICAL, HIGH and LOW). Read once at `build()` into per-command listener
    /// lists; dispatch visits only these (F-18).
    fn commands(&self) -> &[CommandRegistration];
    /// Return `Handled::Yes` to stop propagation (upstream `return true`). Called only for
    /// commands listed in `commands()`.
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error>;
    /// The post-commit hook (audit R2-1 R2-48, R2-4 H5): what upstream does in a mutation or
    /// update listener that calls `editor.update` (Macro nodeId and peerId). Runs in a
    /// follow-up transaction after every non-no-op commit (rules below). Default: nothing.
    fn after_commit(&self, _tx: &mut Transaction<'_>, _commit: &Commit) -> Result<(), Error> { Ok(()) }
}

/// One `registerCommand(command, listener, priority)`.
#[derive(Clone, Copy, Debug)]
pub struct CommandRegistration { pub command: CommandKind, pub priority: CommandPriority, pub placement: Placement }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Handled { Yes, No }

/// `COMMAND_PRIORITY_*`. Dispatch order is Critical → Editor.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum CommandPriority { Editor = 0, Low = 1, Normal = 2, High = 3, Critical = 4 }

/// `COMMAND_PRIORITY_BEFORE_*` (`priority & 7` pushed to the front of its level) vs normal
/// registration (appended).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Placement { Before, After }
```

```rust
/// Which priority levels have a Rust listener, per command kind (R2.1, S12 §0.2). Built at
/// `build()` from every plugin's `commands()` (plus, under `foreign-nodes`, the run-time
/// listeners, refreshed on each register/unregister). The view uses it to skip keydowns no
/// Rust listener wants and to order its own listeners around the Rust ones (S12 §1.4); the
/// session exports it once (S7 `listenerTable()`).
#[derive(Clone, Debug, Default)]
pub struct ListenerTable { /* IndexMap<CommandKind, PriorityLevels>, in first-registration order */ }
impl ListenerTable {
    /// `None` when no Rust listener exists for `kind`.
    pub fn levels(&self, kind: CommandKind) -> Option<PriorityLevels>;
    pub fn iter(&self) -> impl Iterator<Item = (CommandKind, PriorityLevels)> + '_;
}
/// A bit set over `CommandPriority` (bit `priority as u8`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct PriorityLevels(u8);
impl PriorityLevels {
    pub fn contains(self, priority: CommandPriority) -> bool;
    /// The highest level present (dispatch visits it first).
    pub fn highest(self) -> Option<CommandPriority>;
    pub fn bits(self) -> u8;
}
```

`Handled::No` from every Rust listener at every level is what lets the view's after-phase
listeners run (S12 §1.4), so the table never lists the view's own listeners.

Dispatch (`triggerCommandListeners`, `LexicalUpdates.ts:803-841`): for each priority from
Critical to Editor, call that command's listeners at that level in order (Before
placements in reverse registration order at the front, then After placements in
registration order) until one returns Yes. Levels with no listener are skipped.

- `Transaction::dispatch` (inside an update; upstream's `activeEditor === editor` branch of
  `updateEditorSync`) runs every level inline and never flushes.
- A command with no listener at any level opens no update upstream (`triggerCommandListeners`
  starts `$beginUpdate` only for a non-empty level, `LexicalUpdates.ts:814-841`; R2-17). So
  `Editor::dispatch` and EditorCore's `Command` input open no transaction, apply no view
  selection and return a no-op commit with `Handled::No`.
- `Editor::dispatch` and EditorCore's command inputs (outside an update) wrap each non-empty
  level in its own `$beginUpdate` upstream. So when a level ran and none returned Yes, they
  call `tx.flush()` before the next level: a CRITICAL handler that mutates and returns No
  shows the HIGH handlers the transformed state (Macro's nodeId `prepare_clipboard_nodes`
  has exactly this shape) (F-4). Only the first level's update derives the selection from
  the view (§15).

Parent-editor propagation is n/a: nested editors are separate `Editor`s, and the host
forwards between them if needed.

Follow-up rounds (`Plugin::after_commit`). Upstream runs listeners with `editor._updating =
true` (`LexicalUpdates.ts:770-800`), so an `editor.update` inside a mutation or update listener
is queued; `$triggerEnqueuedUpdates` (`:858-885`) then starts one `$beginUpdate` for the first
queued update, whose nested drain runs the rest in the same pending state (tags merged), and
that commit triggers the listeners again. Rust reproduces it:
1. After a non-no-op commit chain (`preceding`, the commit), open one follow-up transaction
   (no tags, no view selection: upstream's queued update clones the committed selection).
2. Call every plugin's `after_commit` in `plugin()` registration order, once for each commit
   of the chain, oldest first. Each call is like one queued update body: tags it adds merge,
   and nothing flushes between calls.
3. `commit()` the follow-up. A no-op is dropped and ends the rounds. Otherwise it is appended
   to `Commit::following`, and the next round runs with that commit as the chain.
4. More than 99 consecutive rounds (`_cascadeCount > 99`, TF-08) stops the rounds with
   `Error::EndlessFollowUps` (upstream's message, §16 row 66) in `Commit::follow_up_error`.
   An `Err` from a body or from the follow-up commit rolls that follow-up back and is
   recorded the same way; the commits before it stand (upstream reports through `_onError`
   and keeps them).

One post-commit mechanism (R2.1). S11 §5.1 proposed a second one, `CommitHook` (a `fn` plus
`EditorBuilder::commit_hook`), for NodeId and PeerId. It is not added: a hook-only plugin is a
`Plugin` whose `commands()` is empty and whose `after_commit` is the hook body. S11's needs map
onto the rules above as follows:
- "Each hook in its own follow-up transaction": all plugins share one follow-up per round
  (upstream's `$triggerEnqueuedUpdates` drains every queued update into one pending state), and
  a later plugin sees the earlier plugins' writes in it. Tags merge.
- "Hooks never run for their own follow-ups": they do, as upstream's listeners do, bounded by
  TF-08's 99-round guard. NodeId's and PeerId's second round finds nothing to write and is
  dropped as a no-op, which ends the rounds.
- "Also on `Editor::transaction` commits (`commit_with_hooks`)": `Editor::run_after_commit`
  plus `Commit::chain()`.
- "Initial hook pass, `EditorCore::take_initial_output()`": `EditorBuilder::initial_state` runs
  the rounds at `build()` and keeps their commits; `Editor::take_initial_commits` and
  `EditorCore::take_initial_output` (§15) hand them to the host, which projects them like any
  other commit.
- PeerId's remote rule (nodes `Updated` in a commit tagged `from-loro` whose `$.peerId`
  changed) reads `commit.tags`, `commit.changes.mutations`, and `Read::state_change` against
  `commit.prev.view()`.

History records the main commit before any follow-up (upstream's history update listener
runs before the queued update), then each follow-up in order; an untagged follow-up (nodeId)
is classified like any other commit. A plugin tags its follow-up when upstream's listener does
(peerId tags `local-status`). The rounds run in `Editor::update`/`try_update`/`dispatch`/
`set_editor_state`, `Editor::run_after_commit`, `EditorCore::apply` and `EditorBuilder::build`
(synthetic all-Created commit, §4.2); `Transaction::commit` alone does not run them. They run
headless too (D-4).

No core plugin is registered by default. Upstream's `registerDefaultCommandHandlers` binds
only DOM commands (`LexicalEvents.ts:679`); its KEY_DOWN handler (`$handleKeyDown`, which
maps a keydown to KEY_ENTER, DELETE_WORD, FORMAT_TEXT, UNDO, …) is view code, and EditorCore
reproduces it as described in §15.1. The rich-text and plain-text behaviour
(`registerRichText`, `registerPlainText`) are `Plugin`s in lexical_rich_nodes.

### 14.3 Extension state

```rust
/// Per-editor state for transforms and plugins: id maps, RNG seeds, caches. `Clone` because
/// the transaction stages a copy-on-write `Arc` and swaps it in on commit.
pub trait ExtensionState: Clone + Send + Sync + 'static {}
impl<State: Clone + Send + Sync + 'static> ExtensionState for State {}
```

- Registered with `EditorBuilder::extension_state(initial)`.
- Read with `Transaction::extension` / `Editor::extension`; written with
  `Transaction::extension_mut`, which clones on first write.
- Dropping the transaction discards the writes.
- History undo does not revert extension state, just as upstream plugin JS state is not
  reverted.
- Read-only plugin configuration may live here too (CR-6); reads never clone.
- Randomness (Macro nodeId's `nanoid`, Q5): a seeded RNG whose state lives in an
  ExtensionState, seeded by the host at build. A rolled-back transaction rewinds it, which
  deterministic fuzzing needs. No `Box<dyn IdGenerator>` in plugin structs.
- Runtime enable flags (per-surface markdown shortcuts, read-only mode, Q11) are
  ExtensionState fields the plugin checks.

### 14.4 Extension-core mapping

S2: EXT-01..EXT-09 (core definitions), EXT-20..EXT-40 (builder), EXT-50..EXT-53 (signals, n/a).

Upstream's `defineExtension` / `configExtension` / `buildEditorFromExtensions` system is a
JS composition framework. In Rust, `EditorBuilder` calls are the composition:

| Upstream | Rust |
| --- | --- |
| `LexicalExtension { name, nodes, register, config, dependencies, … }` | a function `fn install(builder: EditorBuilder, config: MyConfig) -> EditorBuilder` per crate (e.g. `lexical_rich_nodes::rich_text::install`) |
| `dependencies` / `peerDependencies` | install calls made by the dependent's install fn; duplicates are a BuildError |
| `config` / `mergeConfig` / `shallowMergeConfig` | the install fn's typed config struct (`..Default::default()` merges) |
| `init` / `build` / `register` phases, signals, `LexicalEditorWithDispose` | n/a: build-time only; there is nothing to dispose (`Drop`) |

`@lexical/extension` exports that S2 targets at `lexical_model` (audit R2-2 T1a). The builder
and lookup functions map to core items; the built-in extensions are packages, owned by S3
§1a.17 (ClearEditor and TabIndentation are ported in `lexical_rich_nodes`; the others run as
upstream JS in the Tier B core configuration), and S2 corrects their target to that owner:

| Upstream | Rust |
| --- | --- |
| `LexicalBuilder`, `buildEditorFromExtensions(...args)` | `EditorBuilder` + install fns; `build()` (EXT-20..EXT-40: dedupe = `BuildError` on a second install, order = call order, config merge = struct update) |
| `getExtensionDependencyFromEditor(editor, ext)`, `$getExtensionDependency(ext)`, `$getExtensionOutput(ext)` | `Editor::extension::<State>()` / `Transaction::extension::<State>()`: typed, so a missing dependency is `Error::UnknownExtensionState` at the first read (a missing install is a programming error that a unit test of the install fn catches) |
| `$getPeerDependency(name)`, `getPeerDependencyFromEditor(editor, name)` | `Editor::try_extension::<State>() -> Option<&State>` / `Transaction::try_extension` (an optional peer is an `Option`, not a name lookup) |
| `getPeerDependencyFromEditorOrThrow(editor, name)` | `Editor::extension::<State>()` (`Err` when absent) |
| `getKnownTypesAndNodes(config)`, `KnownTypesAndNodes` | `Registry::types()` (names, classes and kinds of every registered type) |
| `InitialStateExtension`, `InitialStateConfig` | `EditorBuilder::initial_state` (S3 owns any extension wrapper) |
| `EditorStateExtension` | n/a: the caller holds the `Commit` (signals are n/a) |
| `NodeSelectionExtension` (`watchNodeKey`) | `Commit::selection_changed` + `Read::is_selected(key, None)` |
| `NestedEditorExtension` | n/a: nested editors are separate `Editor`s (D-20) |
| `ClearEditorExtension`, `ClearEditorConfig`, `registerClearEditor` | S3 (`lexical_rich_nodes`, XB-04), over `Command::ClearEditor` + `queue_update` |
| `TabIndentationExtension`, `TabIndentationConfig`, `registerTabIndentation`, `CanIndentPredicate` | S3 (`lexical_rich_nodes`); `CanIndentPredicate` is a plain `fn(StateRef<'_>, NodeKey) -> bool` |
| `NormalizeTripleClickSelectionExtension`, `NormalizeTripleClickSelectionConfig`, `NormalizeTripleClickSelectionOutput` (R2.1; S4 matrix row `blocked:no-rust-owner`) | Split three ways. Model: `$fixFocusOverselection` is `Transaction::fix_focus_overselection` (§9.2, this crate). Plugin: S3 `lexical_rich_nodes::normalize_triple_click` (a SELECTION_CHANGE listener at `Critical`/`Before` that calls it when `tx.selection_change_context()` has `triple_click`; Macro's `normalize-triple-click` plugin, S12 §1.14, maps to it). View: the `mousedown`/`mouseup` `detail === 3` tracking and `thresholdMsec`/`dateNow` are S12 web-view and set `SelectionChangeContext::triple_click`. `disabled` = not registering the plugin |
| `ClickAfterLastBlockExtension`, `ClickAfterLastBlockConfig`, `ClickAfterLastBlockOutput`, `$defaultShouldInsertAfter` (R2.1; S4 matrix row `blocked:no-rust-owner`) | Split. View (S12 web-view, Macro's `trailing-paragraph` view part): the claim test is DOM geometry (`event.target === rootElement`, `clientY` below the last block's `getBoundingClientRect().bottom`) plus the `mousedown` `preventDefault`, so it cannot run in Rust. Model: S3 `lexical_rich_nodes::click_after_last_block`: `default_should_insert_after(view: StateRef<'_>, key) -> bool` (decorator, or element with `is_shadow_root`), a `ClickAfterLastBlockConfig { should_insert_after: fn(StateRef<'_>, NodeKey) -> bool }` ExtensionState, and an `INSERT_AFTER_LAST_BLOCK: CommandKey<()>` handler that re-reads the root's last child, applies the predicate, appends a paragraph after it and selects its start. Not P0 for Macro (no Macro caller today) |
| `HorizontalRuleExtension`, `HorizontalRuleNode`, `SerializedHorizontalRuleNode`, `DecoratorTextExtension`, `DecoratorTextNode`, `SerializedDecoratorTextNode`, `$isDecoratorTextNode`, `NormalizeInlineElements*`, `applyFormatToDom`, `applyFormatFromStyle` | S3 §1a.17 (not ported; upstream JS) |

### 14.5 Plugin events (side effects without stored callbacks)

A plugin that upstream configures with a side-effecting callback fired from inside an update
(`@lexical/link`'s autolink `ChangeHandler`, audit R2-1 R2-53) emits a typed event instead. The
event is staged in the transaction, so it rolls back with it, and the host reads it from the
`Commit` after the commit, which keeps the core sans-IO and deterministic. This keeps the
decision "no stored callbacks": configuration may hold `fn` pointers and plain data, never
closures that perform effects.

```rust
/// Identity of an event type, like `CommandKey`: a `static`, compared by address.
pub struct EventKey<Event: Clone + fmt::Debug + Send + Sync + 'static> { name: &'static str, event: PhantomData<fn() -> Event> }
impl<Event: Clone + fmt::Debug + Send + Sync + 'static> EventKey<Event> {
    pub const fn new(name: &'static str) -> EventKey<Event>;
    pub fn name(&self) -> &'static str;
}
/// One emitted event (`Arc` payload, so `Clone`; `PartialEq` by key address and `Arc` identity).
#[derive(Clone, Debug)]
pub struct PluginEvent { /* key: &'static dyn AnyEventKey, payload: Arc<dyn Any + Send + Sync> */ }
impl PartialEq for PluginEvent;
impl PluginEvent {
    pub fn payload<Event: Clone + fmt::Debug + Send + Sync + 'static>(&self, key: &'static EventKey<Event>) -> Option<&Event>;
}
impl Transaction<'_> {
    /// Stages an event; it reaches `Commit::events` only if the transaction commits.
    pub fn emit<Event: Clone + fmt::Debug + Send + Sync + 'static>(&mut self, key: &'static EventKey<Event>, event: Event);
}
impl Commit {
    /// Events of one type, in emission order.
    pub fn events_of<'commit, Event: Clone + fmt::Debug + Send + Sync + 'static>(&'commit self, key: &'static EventKey<Event>)
        -> impl Iterator<Item = &'commit Event> + 'commit;
}
```

EditorCore surfaces every event as `Effect::PluginEvent(PluginEvent)`. S3's autolink port
emits `AutoLinkChanged { url: Option<String>, prev_url: Option<String> }`.

---

## 15. EditorCore (sans-IO black box)

S2: EVT-01..EVT-36 (each classified in §15.4), CMD-10..CMD-50 routing, HIS-60..HIS-64 routing,
HDL-01..HDL-03 (`createHeadlessEditor` is `EditorBuilder::new(EditorMode::Headless)`; HDL-03's
`window` check is view).

```rust
/// The engine and OS of the host view (R2.1, S12 §0.2; replaces R2's `ViewPlatform`). Set on
/// the editor with `EditorBuilder::view_host`, read with `Editor::view_host` and
/// `Transaction::view_host`. Upstream's `environment.ts` flags map onto it (§17).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ViewHost { pub engine: ViewEngine, pub os: ViewOs }
impl ViewHost {
    /// Headless/server editors: upstream with `CAN_USE_DOM === false`, so every `IS_*` is
    /// false. Composition characters as on Chromium.
    pub const HEADLESS: ViewHost = ViewHost { engine: ViewEngine::Chromium, os: ViewOs::Other };
    /// `IS_IOS`, `IS_ANDROID`, `IS_APPLE` (macOS or iOS), as upstream computes them.
    pub fn is_ios(self) -> bool; pub fn is_android(self) -> bool; pub fn is_apple(self) -> bool;
}
/// What the engine does with composition characters (`COMPOSITION_SUFFIX` /
/// `COMPOSITION_START_CHAR` depend on `IS_SAFARI || IS_IOS || IS_APPLE_WEBKIT` and
/// `IS_FIREFOX`). `Native` is a model-first native view (S12 §3: lexical-ios fork, Android
/// `EditText`): no DOM, so no composition characters are inserted or stripped.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum ViewEngine { Chromium, Firefox, AppleWebKit, Native }
/// The OS, for the `IS_IOS`/`IS_ANDROID`/`IS_APPLE` branches in rich-text and Macro plugins.
/// `Apple` is macOS (`IS_APPLE && !IS_IOS`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum ViewOs { Apple, Ios, Android, Other }

/// No `Default`: the host states every field. The editor mode is the `Editor`'s own
/// (`EditorBuilder::new(mode)`); EditorCore never changes it (Q9). A headless EditorCore
/// (ai-editing) is allowed.
#[derive(Clone, Debug)]
pub struct CoreConfig {
    pub history: Option<HistoryConfig>,
    // R2.1: the platform moved to `EditorBuilder::view_host` (one source; plugins read it).
    pub editable: bool,
    pub diff: DiffOptions,
    /// Compute Effect::TextContentChanged (an O(n) compare per changed commit, memoized).
    pub track_text_content: bool,
}

/// The editor as a state machine: no Loro, no timers, no DOM. One `apply` = one
/// transaction plus its follow-up rounds; usually one Commit (two when an undo commits pending
/// work first, F-24; more when `Plugin::after_commit` writes, §14.2).
pub struct EditorCore { editor: Editor, history: Option<History>, composition: Composition, config: CoreConfig }

/// `editor._compositionKey` as an explicit state.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Composition { Idle, Composing { key: NodeKey } }

/// `Clone + PartialEq + Debug` for replay and fuzz shrinking (R2-58).
#[derive(Clone, PartialEq, Debug)]
pub enum Input {
    /// DOM-first typing (`$updateSelectedTextFromDOM` → `$updateTextNodeFromDOMContent`,
    /// `LexicalUtils.ts:746`): the browser already changed text node `key` to `text`.
    /// The offsets are the DOM selection offsets in that node.
    TextFromView { key: NodeKey, text: String, anchor: Option<Utf16Offset>, focus: Option<Utf16Offset>,
                   composition_end: bool, composition_data: Option<String>, selection: ViewSelection },
    /// A model command. Plugins first; Undo/Redo fall back to History.
    Command { command: Command, selection: ViewSelection },
    /// A keydown (`onKeyDown`, `LexicalEvents.ts:1315`). Dispatches `Command::KeyDown`; if no
    /// listener returns Yes, the view-computed `routed` command (`$handleKeyDown`'s mapping:
    /// KEY_ENTER, DELETE_WORD, FORMAT_TEXT 'bold', UNDO, …) is dispatched in the same
    /// transaction, standing in for upstream's default KEY_DOWN listener (first After
    /// listener at Editor priority). `routed_prevent_default` is the `preventDefault()`
    /// that `$handleKeyDown` itself calls for that mapping.
    KeyDown { event: KeyEvent, routed: Option<Command>, routed_prevent_default: bool, selection: ViewSelection },
    /// `selectionchange` / any event that rebuilds selection from the DOM. `change` carries
    /// what `onSelectionChange` reads besides the points (§9.2); `None` for events that only
    /// rebuild the selection.
    SelectionFromView { selection: ViewSelection, change: Option<SelectionChangeContext> },
    /// The model half of `beforeinput` `insertText`/`insertTranspose` and of `input`
    /// (`LexicalEvents.ts:886-917, 1085-1160`; §15.4).
    InsertTextEvent { phase: TextEventPhase, data: Option<String>, data_transfer_text: Option<String>,
                      facts: InsertTextFacts, last_key: Option<Arc<str>>, selection: ViewSelection },
    Composition { event: CompositionEvent, selection: ViewSelection },
    /// Model-level changes from a sync layer (lexical_loro's projection).
    ApplyRemote { changes: Vec<NodeChange>, options: UpdateOptions },
    Undo,
    Redo,
    /// `setEditorState(parseEditorState(json))`.
    SetState { state: SerializedEditorState, tags: TagSet },
    /// Several inputs in one transaction and one commit: upstream's same-tick batching
    /// (keydown + beforeinput + input + selectionchange). Each element is flushed (§8)
    /// before the next. Undo, Redo, SetState and Batch cannot be nested (Error::InputNotBatchable).
    Batch(Vec<Input>),
}

#[derive(Clone, PartialEq, Debug)]
pub enum CompositionEvent {
    /// `compositionstart`: the composition key becomes the anchor's text node;
    /// COMPOSITION_START tag (`$handleCompositionStart`, model part).
    Start { data: String },
    /// `compositionend`: run TextFromView with composition_end, clear the key,
    /// COMPOSITION_END tag.
    End { key: NodeKey, text: String, anchor: Option<Utf16Offset>, focus: Option<Utf16Offset>, data: String },
}

/// A remote edit addressed by key, or by a batch-local id for nodes the batch creates.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct LocalNode(pub u32);
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum NodeTarget { Key(NodeKey), Local(LocalNode) }

#[derive(Clone, PartialEq, Debug)]
pub enum NodeChange {
    /// Create a detached node from its JSON object without `children`. The exact type is
    /// used, with no replacement: the JSON type is already final.
    Create { local: LocalNode, json: SerializedNode },
    /// The full child order of `parent`, applied by the splice sequence below.
    Children { parent: NodeTarget, children: Vec<NodeTarget> },
    /// Raw field update (`Transaction::apply_remote_fields`): props, base fields, NodeState,
    /// with no virtual setters (F-11). The sending peer already ran the hooks.
    Update { node: NodeTarget, json: SerializedNode },
    /// Text edit (Loro text delta).
    SpliceText { node: NodeTarget, range: Range<Utf16Offset>, insert: String },
    /// Remove (preserve_empty_parent: true; the sync layer sends parent removal itself).
    Remove { node: NodeTarget },
}

#[derive(Clone, Debug)]
pub struct Output {
    /// The commits this input produced, oldest first (`Commit::chain()`: preceding, the
    /// commit, then the follow-ups). Almost always one.
    pub commits: SmallVec<[Commit; 1]>,
    /// `commits.first().prev → commits.last().next`.
    pub diff: Diff,
    pub effects: Vec<Effect>,
    /// For Command / KeyDown inputs: whether a listener returned Yes.
    pub handled: Handled,
}

#[derive(Clone, PartialEq, Debug)]
pub enum Effect {
    /// Write this selection to the DOM (`$updateDOMSelection`). Emitted when editable,
    /// without SKIP_DOM_SELECTION, and (nodes dirty, or selection None, dirty, or changed),
    /// except as elided below. `format`/`style` are the range selection's (`TextFormat` 0
    /// and `""` for other selections), so the view keeps `markCollapsedSelectionFormat` and
    /// decides EVT-09/EVT-14 without a crossing (R2.1, S12 §1.5, §1.6).
    SetViewSelection { selection: ViewSelection, format: TextFormat, style: Arc<str> },
    /// Scroll the focus into view (absent with SKIP_SCROLL_INTO_VIEW).
    ScrollIntoView(NodeKey),
    /// Decorators created, updated or destroyed (`registerDecoratorListener`, decorator GC).
    DecoratorsChanged(Vec<NodeKey>),
    /// CAN_UNDO / CAN_REDO (only on change).
    HistoryState(HistoryAvailability),
    /// `registerTextContentListener` (only with `track_text_content`).
    TextContentChanged,
    /// SELECTION_CHANGE_COMMAND for non-range selection changes (`LexicalUpdates.ts:687`).
    SelectionChange,
    /// A Key/Paste handler (or `routed_prevent_default`) prevented the DOM default.
    PreventDefault,
    /// Android composition: upstream removes an emptied text node in a `setTimeout(20ms)`
    /// update. The host schedules `Input::ApplyRemote`/a command after `delay_ms`.
    ScheduleRemoveEmptyText { key: NodeKey, delay_ms: u32 },
    /// Keys assigned to `NodeChange::Create` locals.
    RemoteNodesCreated(Vec<(LocalNode, NodeKey)>),
    /// A plugin event from any commit of the chain (§14.5), in order.
    PluginEvent(PluginEvent),
    /// A follow-up round failed and was rolled back (`Commit::follow_up_error`); upstream's
    /// `_onError`. The host reports it.
    FollowUpFailed { plugin: &'static str, kind: &'static str, message: Arc<str> },
}

/// A failed `apply` (§15.2).
#[derive(Debug, thiserror::Error)]
#[error("{error}")]
pub struct ApplyError { pub error: Error, pub committed: SmallVec<[Commit; 1]> }

impl EditorCore {
    /// Takes `editor.take_initial_commits()` (R2.1).
    pub fn new(editor: Editor, config: CoreConfig) -> EditorCore;
    /// The `Output` of the build-time initial round (`EditorBuilder::initial_state`, §14.2):
    /// its commits, the diff from the parsed initial state to the last of them, and their
    /// effects. `Some` once, before the first `apply`, when the round committed anything;
    /// `None` after, or when it did not. The session projects it like any `apply` output
    /// (S11 §5.1, S7). History is not fed (upstream's history listener is registered after
    /// initialization). Calling `apply` first discards it.
    pub fn take_initial_output(&mut self) -> Option<Output>;
    pub fn apply(&mut self, input: Input, now: HistoryTime) -> Result<Output, ApplyError>;
    pub fn state(&self) -> &EditorState;
    pub fn editor(&self) -> &Editor;
    pub fn composition(&self) -> Composition;
    pub fn history(&self) -> Option<&History>;
    pub fn set_editable(&mut self, editable: bool);
}
```

### 15.1 `apply` flow

1. Open one transaction. Its tags start from the editor's carried tags (§8.8), then the
   input's: Undo/Redo → HISTORIC; Composition → the COMPOSITION_* tags; ApplyRemote →
   `options.tags`.
1b. Selection (F-17). In `ViewAttached` mode each fresh update takes its selection from the
   DOM (`$internalCreateSelection`, `LexicalUpdates.ts:999-1009`), so commands act on the
   live DOM selection even when a keypress arrives before its `selectionchange`. Apply the
   input's `selection` with `selection_from_view` as the first step, only when the
   transaction is fresh (the first element of a `Batch`, not later ones; upstream clones
   the pending state only once per batch). For `Command` inputs the selection is applied
   lazily, when the first non-empty listener level is entered (R2-17): upstream opens the
   `$beginUpdate` that creates the selection only for a non-empty level
   (`LexicalUpdates.ts:814-841`), so a command no listener handles commits nothing
   (`Commit::is_noop`, no `Effect::SetViewSelection`, carried tags untouched). `KeyDown`
   always has the routed default listener, so this changes only `Command`. `KeepModel` keeps
   the committed selection. In `Headless` mode the field must be `KeepModel`
   (Error::ViewSelectionInHeadless): headless upstream copies the committed selection.
2. Run the input:
   - Command → dispatch with per-level flush (§14.2).
   - KeyDown → dispatch `Command::KeyDown`; if not handled and `routed` is Some, apply
     `routed_prevent_default` and dispatch `routed` (per-level flush throughout).
   - SelectionFromView → `tx.selection_from_view`, then, with `change`,
     `tx.selection_change_format(change)` and `Command::SelectionChange` (§9.2).
   - InsertTextEvent → §15.4.
   - TextFromView → the `$updateTextNodeFromDOMContent` port, with the platform's composition
     characters.
   - ApplyRemote → each change in order, resolving `Local` ids. `NodeChange::Children` is
     applied by this splice sequence (F-25), so local and remote application adjust the
     selection and mark dirt in the same order: (1) for each current child of `parent` that
     is not in the target list, in current order, `remove_from_parent` plus the active
     selection's element fix-up (`$updateElementSelectionOnCreateDeleteNode`); (2) walk the
     target list left to right, and for every node not already at index `i`, remove it from
     its old position (if attached) and `splice(parent, i, 0, [k])`. A fuzz target compares
     this against the Loro projection.
   - Undo/Redo → dispatch `Command::Undo`/`Redo`. If no plugin handles it and history is
     configured, `history.undo_in(&mut tx)` / `redo_in`: `Transaction::set_editor_state`
     commits any pending work first (upstream's early commit, commit phase only) and
     installs the entry, sealing the transaction (F-24, R2-02). Handled even when the stack
     is empty (HIS-62).
   - `Command::ClearHistory` with history configured → `history.clear()`, handled, and
     `Effect::HistoryState({false, false})` (HIS-64). `Command::ClearEditor` → plugins first;
     the history half calls `history.clear()` without handling the command and without an
     effect (HIS-63).
   - SetState → `tx.set_editor_state(parsed, tags)`.
3. `tx.commit()`, then the `Plugin::after_commit` rounds (§14.2). `Output::commits` is
   `commit.chain()`. With history configured, `history.record(&commit, now)` for each,
   oldest first (preceding, the commit, each follow-up).
4. Build `diff` (`Commit::diff`, which spans the whole chain) and `effects` (rules on each
   variant; `PreventDefault` iff `default_prevented`; one `PluginEvent` per event of the
   chain; `FollowUpFailed` from `follow_up_error`).
   `SetViewSelection` elision (R2.1, S12 §1.5): for `TextFromView`, `SelectionFromView` and
   `Composition` inputs, when no node is dirty in the chain and the committed selection
   (points, type, format, style) equals what the input's `ViewSelection` installed in step
   1b, the effect is omitted. Upstream would call `$updateDOMSelection`, which returns early
   at `LexicalSelection.ts:3205-3221` because the DOM already shows that selection, so nothing
   observable changes; DOM-first typing and plain caret moves then cost no
   `setBaseAndExtent`. Composition gets no other rule: while composing, the view's input
   selection is the composing caret, so this elision covers it.

`Composition` mirrors the commit's composition key after each apply.

`ViewHost::engine` picks the composition characters for `TextFromView` and
`CompositionEvent` (`Native`: none). `ViewHost` reaches plugins only through
`Transaction::view_host`; EditorCore adds no other platform switch.

Text crossing the wasm boundary (Q6): `TextFromView.text`, `InsertText` and composition data
are passed as UTF-16 (`&[u16]` / `Vec<u16>`) and decoded strictly with `text_from_utf16`
(§11.4) before the `Input` is built; a lone surrogate returns `Err(Error::LoneSurrogate)` with
the state unchanged, and the view re-renders. (A `wasm-bindgen` `String` argument would
silently turn it into U+FFFD.)

Boundary reads (Q16). DOM → point resolution (`$internalResolveSelectionPoint`) stays in JS
and needs only these model reads, all exported to the view: `kind(key)`,
`children_size(key)`, `child_at_index(key, i)`, `descendant_by_index(key, i)`,
`text_content_size(key)` (text nodes), `is_inline(key)`, `type_index(key)`. Everything else
the view needs comes in the Diff. Since R2.1 the web view keeps a mirror of the Diff and the
type table (S12 V-2), so these reads are dev and debug cross-checks there, not hot calls.

### 15.2 Errors

`apply` returns `Err(ApplyError { error, committed })` and the state is as it was before the
input, except for an early commit already made by `Transaction::set_editor_state` before the
failure (upstream keeps it too: its error path resets to the then-current state), which
`committed` carries so the host can render it; it is empty in every other case. The host does what upstream's `_onError` plus FULL_RECONCILE recovery did: it
reports the error, keeps the old state, and re-renders if the DOM diverged (DOM-first
typing).

### 15.3 DOM-first typing

For `TextFromView`, if the committed text of `key` equals the reported `text`, set
`Diff::view_text_matches = Some(key)` and omit that node's TEXT op. The view already shows
it. This is upstream's `dom.nodeValue` comparison in `TextNode.updateDOM`. A keystroke on the
fast path therefore yields an empty diff body (SCOPE §3.4 item 1).

### 15.4 Model halves of view event handlers

`LexicalEvents.ts` is view code, but several handlers make model decisions inside their
update. The ones the view cannot make without the model are Rust items; everything else stays
in the view (the S10 shim on the web, the native view on mobile).

```rust
/// Which handler an `InsertTextEvent` comes from.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TextEventPhase { BeforeInput, Input }

/// The DOM halves of `$shouldPreventDefaultAndInsertText` (`LexicalEvents.ts:222-282`) that
/// the model cannot evaluate, precomputed by the view (it owns the timers and the DOM).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct InsertTextFacts {
    /// `!isBeforeInput && (!CAN_USE_BEFORE_INPUT || lastBeforeInputInsertTextTimeStamp <
    /// timeStamp + 50)`: a dangling `input` event.
    pub dangling_input: bool,
    /// `(isBeforeInput || !CAN_USE_BEFORE_INPUT) && backingAnchorElement !== null &&
    /// domAnchorNode !== $getDOMTextNode(...)`, minus the `!isComposing()` term, which the
    /// model adds.
    pub dom_anchor_not_backing_text: bool,
    /// The target range is not collapsed, or does not start at the DOM selection's anchor.
    pub target_range_mismatch: bool,
}

pub trait Read {
    // … the methods of §5.2, plus:
    /// `$shouldPreventDefaultAndInsertText` (EVT-14), with `$shouldInsertTextAfterOrBeforeTextNode`
    /// (`LexicalUtils.ts`, EVT-15): anchor key ≠ focus key; anchor not text; the
    /// single-grapheme replacement clause (`dangling_input` or `isDirty && len < 2` or a
    /// surrogate pair in `text`, and offsets differ, and not composing); token or segmented
    /// anchor; `isDirty && len > 1`; `dom_anchor_not_backing_text && !composing`;
    /// `target_range_mismatch`; a format or style mismatch between anchor node and selection
    /// when not composing; the boundary heuristics. `isDirty` is the view's dirty set (false on
    /// a committed state). Lengths are UTF-16.
    fn should_prevent_default_and_insert_text(&self, selection: &RangeSelection, text: &str,
                                              facts: InsertTextFacts) -> Result<bool, Error>;
    /// `$canRemoveText(anchorNode, focusNode)` (EVT-28).
    fn can_remove_text(&self, anchor: impl Into<NodeKey>, focus: impl Into<NodeKey>) -> bool;
}

impl Transaction<'_> {
    /// `$maybeMoveSelectionPastTrailingAcceptanceBoundary(insertedText)` (`:584-640`, EVT-25),
    /// with the view's `lastKeyCode` passed in.
    pub fn move_selection_past_trailing_acceptance_boundary(&mut self, inserted: &str,
                                                            last_key: Option<&str>) -> Result<(), Error>;
}
```

`Input::InsertTextEvent` runs the model half of the two handlers:
- `BeforeInput` (`:886-917`): `data == "\n"` → `Command::InsertLineBreak { select_start: false }`
  and `PreventDefault`; `data == "\n\n"` → `InsertParagraph` and `PreventDefault`; `data` absent
  with `data_transfer_text` → `PreventDefault` and `insert_raw_text` (EVT-23); else, if
  `should_prevent_default_and_insert_text`, `PreventDefault`, dispatch `InsertText(data)`
  (CONTROLLED_TEXT_INSERTION) and `move_selection_past_trailing_acceptance_boundary`;
  otherwise nothing happens in the model, `Output::handled` is `No`, and the view lets the
  browser mutate the DOM and later sends `TextFromView` (EVT-24). Handled is `Yes` in every
  other case.
- `Input` (`:1085-1160`, EVT-29): if `should_prevent_default_and_insert_text` holds, dispatch
  `InsertText(data)` unless the DOM already shows it, then the boundary move; otherwise the
  view sends `TextFromView` instead (EVT-36). Firefox's pending composition end is a
  `CompositionEvent::End` the view sends first.

The keystroke fast path is unchanged: when `should_prevent_default_and_insert_text` is false
(the common case), the `BeforeInput` call commits nothing, and the text arrives through the
hot `textFromView` call (§11.4, S7 F14).

EVT classification (S2 §3A 1.2). Model, Rust items: EVT-08..EVT-11 (§9.2), EVT-14, EVT-15,
EVT-23, EVT-25, EVT-28, EVT-29 model half, EVT-30 and EVT-31 (`Input::Composition`), EVT-36
(`TextFromView`). View only (shim or native view; they decide which `Input` to send):
EVT-01..EVT-07, EVT-12, EVT-13, EVT-16..EVT-22, EVT-24, EVT-26, EVT-27, EVT-32..EVT-35.

---

## 16. Errors

```rust
/// Every recoverable failure. Messages reproduce upstream's invariant text with `%s` filled,
/// so the JS shim can throw identical `Error`s and `toThrow('…')` tests pass. `Clone`, so a
/// `Commit` can carry a `FollowUpError` and `Output` stays `Clone` (the JSON variant holds
/// `Arc<serde_json::Error>`, with a hand-written `From<serde_json::Error>`).
#[derive(Clone, Debug, thiserror::Error)]
pub enum Error { /* variants in the table below */ }
impl Error {
    /// Stable variant name (`"SelectionLost"`, …) for telemetry and the shim (Q15).
    pub fn kind(&self) -> &'static str;
}

/// Upstream invariants that indicate a bug in the port itself ("logic error",
/// "exhaustiveness check"). Kept separate so callers can tell input errors from defects.
#[derive(Clone, Debug, thiserror::Error)]
pub enum InternalError { /* variants marked "Internal" below */ }
```

Every `invariant`/`devInvariant` in the model files (`LexicalNode.ts`, `LexicalSelection.ts`,
`LexicalUtils.ts`, `LexicalUpdates.ts`, `LexicalEditor.ts`, `LexicalEditorState.ts`,
`LexicalNodeState.ts`, `LexicalNormalization.ts`, `LexicalGC.ts`, `caret/*`, `nodes/*`: 112
call sites) appears below. "Structural" means the Rust types make the condition impossible,
so it has no variant. "Asserted" marks messages that upstream tests assert verbatim.

| # | Upstream message (source) | Rust |
| --- | --- | --- |
| 1 | `LexicalNode: Node %s does not implement .getType().` (Node:501) | Structural (`const TYPE` is required) |
| 2 | `LexicalNode: Node %s does not implement .clone().` (Node:516) | Structural (`Clone` bound) |
| 3 | `LexicalNode: Node %s does not implement .isInline().` (Node:660) | Structural (kinds define it) |
| 4 | `Expected node %s to have a parent.` (Node:783) | `MissingParent { key }` |
| 5 | `Children of root nodes must be elements or decorators` (Node:798) | `RootChildNotBlock` |
| 6 | `Expected node %s to have a top parent element.` (Node:817) | `MissingTopLevelElement { key }` |
| 7 | `LexicalNode.isBefore: exhaustiveness check` (Node:969) | Internal `IsBeforeExhaustiveness` |
| 8 | `getNodesBetween: ancestor is null` (Node:1037) | `NodesBetweenAncestorMissing` |
| 9 | `Lexical node does not exist in active editor state. Avoid using the same node references…` (Node:1080) | `NodeNotFound { key }` (a stale handle is a missing key) |
| 10 | `createDOM: base method not extended` (Node:1157) | View |
| 11 | `updateDOM: base method not extended` (Node:1175) | View |
| 12 | `LexicalNode: Node %s does not implement .importJSON().` (Node:1233) | Structural (default `import_json`) |
| 13 | `includeChildren should only be true for ElementNodes` (Node:1366) | `IncludeChildrenRequiresElements` |
| 14 | `Create node: Attempted to create node %s that was not configured to be used on the editor.` (Node:1656) | `UnregisteredNodeOnCreate { class_name }` (asserted, LexicalUtils.test) |
| 15 | `Create node: Type %s in node %s does not match registered node %s with the same type` (Node:1664) | BuildError::DuplicateNodeType |
| 16 | `insertRangeAfter: lastToInsert must be a later sibling of firstToInsert` (Node:1692) | `InsertRangeAfterOrder` |
| 17 | `Point.getNode: node not found` (Sel:180) | `PointNodeNotFound { key }` (also from selection transforms, before SelectionLost, §8.1) |
| 18 | `PointType.set: node with key %s is %s and can not be used for a %s point` (Sel:206) | `PointTypeMismatch { key, found: String, point_type: PointType }` (all builds, D-11) |
| 19 | `RangeSelection.getNodes() returned %s > 1 nodes in a collapsed selection` (Sel:562) | Internal `CollapsedSelectionMultipleNodes { count }` (all builds, D-11) |
| 20 | `insertText: first node is not a text node` (Sel:849) | Internal `InsertTextFirstNodeNotText` |
| 21 | `Expected RangeSelection after insertParagraph` (Sel:1354) | `ExpectedRangeAfterInsertParagraph` |
| 22 | `Expected node %s of type %s to have a block ElementNode ancestor` (Sel:1384, 1412) | `MissingBlockElementAncestor { key, type_name }` (asserted, LexicalSelection.test) |
| 23 | `Expected node %s of type %s to have a block ancestor` (Sel:1422) | `MissingBlockAncestor { key, type_name }` |
| 24 | `Expected ancestor to be a block ElementNode` (Sel:1472) | `ExpectedBlockElementAncestor` |
| 25 | `shouldDeleteExactlyOneCodeUnit: expecting to be called only with sequences of two or more code units` (Sel:2188) | Internal `DeleteOneCodeUnitTooShort` (debug) |
| 26 | `$internalResolveSelectionPoint: node in DOM but not keyToDOMMap` (Sel:2383) | View |
| 27 | `$internalResolveSelectionPoint: resolvedElement is not an ElementNode` (Sel:2395) | View |
| 28 | `invariant` (Sel:2435, resolve point) | View |
| 29 | `$validatePoint: %s key %s not found in current editorState` (Sel:2802) | `PointKeyNotFound { role, key }` |
| 30 | `$validatePoint: %s key %s is not a TextNode` (Sel:2809) | `PointNotText { role, key }` |
| 31 | `$validatePoint: %s point.offset > node.getTextContentSize() (%s > %s)` (Sel:2816) | `PointTextOffsetOutOfRange { role, offset, size }` |
| 32 | `$validatePoint: %s key %s is not an ElementNode` (Sel:2824) | `PointNotElement { role, key }` |
| 33 | `$validatePoint: %s point.offset > node.getChildrenSize() (%s > %s)` (Sel:2831) | `PointChildOffsetOutOfRange { role, offset, size }` |
| 34 | `Unexpected dirty selection to be null` (Sel:3369) | Internal `RemoveTextAndSplitLostSelection` |
| 35 | `registeredNode: Type %s not found` (Utils:136) | `UnregisteredNodeType { type_name }` |
| 36 | `Lexical node with constructor %s (type %s) has an incorrect clone implementation…` (Utils:364) | Structural (keys never passed by users) |
| 37 | `Lexical node with constructor %s attempted to re-use key … Keys must not be re-used when the type is changed.` (Utils:376) | Structural (asserted upstream; the shim raises it itself) |
| 38 | `… different constructor with the same name (possibly due to invalid Hot Module Replacement)…` (Utils:383) | n/a (JS module duplication) |
| 39 | `internalMarkNodeAsDirty: Ephemeral nodes must not be marked as dirty (key %s type %s)` (Utils:474) | Structural (ephemeral = `NodeRecord` value) |
| 40 | `$setSelection called on frozen selection object…` (Utils:664) | Structural (selections are values) |
| 41 | `Type %s not in registeredNodes` (Utils:1292) | `UnregisteredNodeType { type_name }` |
| 42 | `Reconciliation: could not find DOM element for node key %s` (Utils:1410) | View |
| 43 | `window object not found` (Utils:1578) | View |
| 44 | `$applyNodeReplacement node %s with type %s must be registered to the editor…` (Utils:1652) | `UnregisteredNodeOnCreate { class_name }` |
| 45 | `$applyNodeReplacement failed. Expected replacement node to be an instance of %s…` (Utils:1663) | Structural (`with: fn(Original) -> Replacement`); asserted upstream, so the shim raises it |
| 46 | `$applyNodeReplacement failed. Ensure replacement node %s with type %s is a subclass…` (Utils:1674) | BuildError::ReplacementNotSubtype (asserted upstream, shim) |
| 47 | `$applyNodeReplacement failed. Ensure that the key argument is *not* used…` (Utils:1684) | Structural |
| 48 | `Only element or decorator nodes can be inserted in to the root node` (Utils:1707) | `InsertNonBlockIntoRoot` |
| 49 | `Expected node with key %s to exist but it's not in the nodeMap.` (Utils:1717) | `NodeNotFound { key }` |
| 50 | `Can not call $splitNode() on root element` (Utils:1863) | `SplitRoot` |
| 51 | `Children of a root must be ElementNode` (Utils:1881) | `RootChildrenMustBeElements` |
| 52 | `$getDOMSlot: expected ElementDOMSlot for ElementNode (key %s type %s)` (Utils:2066) | View |
| 53 | `getCachedTypeToNodeMap called with a writable EditorState` (Utils:2124) | Structural |
| 54 | `$cloneWithProperties: %s.clone(node) … did not return a node with the same key…` (Utils:2172) | Structural |
| 55 | `$cloneWithProperties: … did not call super.afterCloneFrom(prevNode)` (Utils:2178) | Structural |
| 56 | `%s (type %s) does not subclass LexicalNode from the lexical package used by this editor…` (Utils:2334) | n/a (asserted upstream; JS-only: multiple package copies) |
| 57 | `%s (type %s) must implement a static clone method since its constructor has %s required arguments…` (Utils:2382) | Structural |
| 58 | `%s (type %s) must implement a static importJSON method…` (Utils:2397) | Structural |
| 59 | `$createChildrenArray: node does not exist in nodeMap` (Utils:2492) | Internal `ChildrenArrayMissingNode { key }` |
| 60 | `Cannot use method in read-only mode.` (Upd:90) | Structural (`&EditorState` has no writers) |
| 61 | `One or more transforms are endlessly triggering additional transforms…` (Upd:96) | `InfiniteTransforms` |
| 62 | `Unable to find an active editor state…` (Upd:105) | Structural (asserted upstream: `/Unable to find an active editor/`; shim only) |
| 63 | `Unable to find an active editor…` (Upd:120) | Structural (shim only) |
| 64 | `parseEditorState: type "%s" + not found` (Upd:392) | `UnknownSerializedType { type_name }` |
| 65 | `LexicalNode: Node %s does not implement .importJSON().` (Upd:398) | Structural |
| 66 | `One or more update listeners are endlessly enqueueing more updates…` (Upd:869) | `EndlessFollowUps`: more than 99 consecutive `Plugin::after_commit` rounds (§14.2, TF-08) |
| 67 | `Unexpected empty pending editor state on discrete nested update` (Upd:932) | Structural (`queue_update` runs only inside a transaction, which always has a pending state; `discrete` has no Rust meaning) |
| 68 | `updateEditor: selection has been lost because the previously selected nodes have been removed…` (Upd:1054) | `SelectionLost` |
| 69 | `%s doesn't extend the %s` (Editor:832) | BuildError::ReplacementNotSubtype |
| 70 | `Listener for type "command" requires a "priority".` (Editor:1186) | Structural (`CommandPriority` is required) |
| 71 | `registerCommand: Command %s not found in command map` (Editor:1204) | n/a (unregister is Drop) |
| 72 | `Node %s has not been registered. Ensure node has been passed to createEditor.` (Editor:1285) | `UnregisteredNodeClass { class_name }` |
| 73 | `setEditorState: the editor state is empty. Ensure the editor state's root node never becomes empty.` (Editor:1539) | `SetEmptyEditorState` |
| 74 | `LexicalNode: Node %s does not match the serialized type…` (EditorState:64) | Structural (the framework writes `type`) |
| 75 | `LexicalNode: Node %s is an element but .exportJSON() does not have a children array.` (EditorState:75) | Structural |
| 76 | `$setState: State key collision %s detected in %s node with type %s and key %s. Only one StateConfig with a given key should be used on a node.` (NodeState:434) | `StateKeyCollision { key, class_name, type_name, node_key }` (asserted, LexicalNodeState.test) |
| 77 | `NodeState: size != computedSize (%s != %s)` (NodeState:582) | Structural (size is not stored) |
| 78 | `NodeState: sharedConfigMap missing knownState key %s` (NodeState:589) | Structural |
| 79 | `NodeCaret.splice: Underflow of expected nodesToRemove during splice (keys: %s)` (Caret:464) | `CaretSpliceUnderflow { keys: Vec<NodeKey> }` |
| 80 | `$getTextNodeOffset: invalid offset %s for size %s at key %s` (Caret:911) | `InvalidTextOffset { offset, size, key }` |
| 81 | `$getCaretRange: anchor and focus must be in the same direction` (Caret:1161) | `CaretDirectionMismatch` |
| 82 | `$comparePointCaretNext: a (key %s) and b (key %s) do not have a common ancestor` (Caret:1235) | `NoCommonAncestor { a, b }` |
| 83–85 | `$originComparison: ancestor / descendant / branch logic error` (Caret:1394/1401/1407) | Internal `OriginComparison { case }` |
| 86 | `$caretFromPoint: Node with type %s and key %s that does not inherit from TextNode encountered for text point` (CaretUtils:68) | `CaretFromPointNotText { type_name, key }` |
| 87 | `… does not inherit from ElementNode encountered for element point` (CaretUtils:76) | `CaretFromPointNotElement { type_name, key }` |
| 88 | `$setPointFromCaret: exhaustiveness check` (CaretUtils:110) | Structural (enum match) |
| 89 | `$removeTextFromCaretRange: selection was lost, could not find a new anchor given candidates with keys: %s` (CaretUtils:371) | `RemoveTextSelectionLost { candidates: Vec<NodeKey> }` |
| 90 | `$splitTextPointCaret: splitText must return at least one TextNode` (CaretUtils:662) | Internal `SplitTextReturnedNothing` |
| 91 | `getTopLevelElementOrThrow: root nodes are not top level elements` (Root:43) | `RootNotTopLevel` |
| 92 | `remove: cannot be called on root nodes` (Root:59) | `RemoveRoot` |
| 93 | `replace: cannot be called on root nodes` (Root:63) | `ReplaceRoot` |
| 94 | `insertBefore: cannot be called on root nodes` (Root:67) | `InsertBeforeRoot` |
| 95 | `insertAfter: cannot be called on root nodes` (Root:71) | `InsertAfterRoot` |
| 96 | `rootNode.splice: Only element or decorator nodes can be inserted to the root node` (Root:87) | `RootSpliceNonBlock` |
| 97 | `updateDOM: prevInnerDOM is null or undefined` (Text:546) | View |
| 98 | `updateDOM: innerDOM is null or undefined` (Text:565) | View |
| 99 | `Expected TextNode createDOM to always return a HTMLElement` (Text:663) | View / lexical_html |
| 100 | `mergeWithSibling: sibling must be a previous or next sibling` (Text:1139) | `MergeWithNonSibling` |
| 101 | `Expected parentElement of Text not to be null` (Text:1258) | View (HTML import) |
| 102 | `TabNode does not support setTextContent` (Tab:62, dev) | `TabSetTextContent` |
| 103 | `TabNode does not support spliceText` (Tab:75) | `TabSpliceText` |
| 104 | `TabNode does not support setDetail` (Tab:84) | `TabSetDetail` |
| 105 | `TabNode does not support setMode` (Tab:89) | `TabSetMode` |
| 106 | `Expected node %s to have a first child.` (Element:251) | `MissingFirstChild { key }` |
| 107 | `Expected node %s to have a last child.` (Element:263) | `MissingLastChild { key }` |
| 108 | `ElementNode.splice: Ephemeral nodes can not mutate their children (key %s type %s)` (Element:464) | Structural |
| 109 | `ElementNode.splice: start + deleteCount > oldSize (%s + %s > %s)` (Element:472) | `SpliceOutOfRange { start, delete_count, size }` |
| 110 | `splice: sibling not found` (Element:504) | Internal `SpliceSiblingNotFound` |
| 111 | `append: attempting to append self` (Element:535) | `AppendSelf { key }` |
| 112 | `$updateDOMSelection` / DOMSlot invariants (LexicalDOMSlot.ts ×4, LexicalReconciler ×19, LexicalEvents ×5) | View (not part of the model, listed for completeness) |

Rust-only variants (conditions JS types or runtime checks covered upstream):

| Variant | When |
| --- | --- |
| `NotAnElement { key }` / `NotAText { key }` / `NotADecorator { key }` | a kind-specific op on another kind (TS types prevent it) |
| `NodeTypeMismatch { key, expected: &'static str, found: &'static str }` | `get_mut::<Node>` / `get_or_err` on a node that is not a `Node` |
| `NoMutableUpcast { key, ancestor: &'static str }` | `get_mut::<Ancestor>` through a marker parent |
| `BaseKindMismatch { expected: NodeKind, found: NodeKind }` | `create_with` |
| `NoRangeSelection` / `NoNodeSelection` | a range op without an active range selection (upstream would throw a TypeError) |
| `UnsupportedSelection` | a TableSelection operation with no `TableSelectionHooks` registered |
| `UnknownSelectionSlot { slot }` / `NoSelection` | a detached slot that was taken or never created / `take_detached(Active)` with no selection |
| `KeyResetWithNodes` | `reset_key_counter` while the state holds more than the root (F-47) |
| `NoDefault { type_name }` | `create_resolved` on a type without `Default` |
| `ViewSelectionInHeadless` | an EditorCore input carries a non-`KeepModel` selection in Headless mode |
| `LoneSurrogate` | text from the wasm boundary contains an unpaired surrogate (Q6) |
| `Utf16OffsetOutOfRange { key, offset, size }` | slicing past the end |
| `Utf16OffsetSplitsSurrogatePair { key, offset }` | an offset inside an astral character (D-6) |
| `LayoutRequired` | `ModifyTarget::ModelSegmentation` with LineBoundary |
| `CaretDirectionMismatch` | (also row 81) |
| `UnknownExtensionState { type_name }` | `extension::<State>` not registered |
| `ForeignEditorState` | `set_editor_state` with a state from another registry |
| `InputNotBatchable` | §15 Batch rules |
| `KeySpaceExhausted` | more than u32::MAX - 1 keys in one generation |
| `Json(Arc<serde_json::Error>)` | malformed JSON / struct import (`From<serde_json::Error>` written by hand, since `#[from]` cannot wrap in `Arc`) |
| `WriteAfterSetEditorState` | a write, dirty mark, `queue_update`, `set_selection` or `dispatch` after `Transaction::set_editor_state` sealed the transaction (R2-02, D-24) |
| `InvalidJsonField { type_name, field: &'static str, reason: &'static str }` | a base field has the wrong JSON type (e.g. `format: "x"` on text) |
| `StaleSuspendedUpdate` | feature `foreign-nodes`: `Editor::resume` of a `PendingUpdate` opened before the editor's last commit (R2.1, §4.4) |
| `UnknownForeignState { key: Arc<str> }` | feature `foreign-nodes`: `set_foreign_state` for a key no `ForeignStateConfig` registered (R2.1) |
| `Invariant(Cow<'static, str>)` | an `invariant(false, msg, …args)` in a package or Macro node (hooks, transforms and plugins return this crate's `Error`, S3 CR-22). Displays the message verbatim so the shim throws upstream's text. Upstream package invariants have `%s` arguments (`LexicalTableSelection.ts:74`, `LexicalTableSelectionHelpers.ts:851`), so it is a `Cow` (R2-44), built by `lexical_model::invariant!("… %s …", arg, …)`, which substitutes each `%s` in order with the argument's `Display`, as upstream's `formatDevErrorMessage` does, and borrows when there are no arguments. The core raises it only in the debug-build type-table check (§8.5, R2.1) |
| `Internal(#[from] InternalError)` | port defects (rows marked Internal) |

Error types outside this crate (R2-45). Hooks, transforms, plugins and every function they
call return `lexical_model::Error`. A package crate's own public API (S3) that has failure
modes the core does not (`InvalidArgument`, `MissingHostname`, …) defines its own
`pub enum Error { #[error(transparent)] Model(#[from] lexical_model::Error), … }`; it never
adds variants here and never widens a hook's error type. `CopyDestination` (§2.4) is the one
definition of the copy destination: `lexical_html` re-exports it and calls
`Read::exclude_from_copy` / `Read::extract_with_child` instead of declaring its own (R2-46).

Counts:
- 112 upstream call sites, in rows 1–111 (row 22 covers two sites; rows 83–85 share one).
- 52 distinct caller-facing `Error` variants (R2 maps row 66 to `EndlessFollowUps`), 9
  `InternalError` variants, and 3 rows that become `BuildError`. The remaining rows are structural, n/a, or view.
- 25 more Rust-only variants (`CaretDirectionMismatch` is counted once; R1 added six and
  the R1 consistency pass added `Invariant`), plus R2's `WriteAfterSetEditorState` and the
  row-66 `EndlessFollowUps` (no longer n/a). In total `Error` has 78 variants plus `Internal`,
  and 80 with feature `foreign-nodes` (R2.1's `StaleSuspendedUpdate`, `UnknownForeignState`).
  `BuildError` gains `NoFlagProbe` (R2.1).
- Upstream tests assert 8 of these messages verbatim (rows 14, 22, 37, 45, 46, 56, 62, 76).
  Rows 14, 22 and 76 are Rust `Error` variants with identical text. Rows 37, 45, 46, 56 and
  62 are compile-time or JS-only conditions in Rust, so the shim raises those messages
  itself.

---

## 17. Mapping: every export of `packages/lexical/src/index.ts`

`index.ts` re-exports **382** names. All 382 are below, grouped by
source module, in `index.ts` order. "View" means the item stays in the JS view, or the
native view, and the shim keeps upstream's JS for it. "n/a" means there is no Rust
counterpart, and the reason is given.

### `caret/LexicalCaret` — 39

| Symbol | Rust |
| --- | --- |
| `BaseCaret` (type) | shared methods on `NodeCaret`/`PointCaret` (§10.3) |
| `CaretDirection` (type) | `CaretDirection` |
| `CaretRange` (type) | `CaretRange` |
| `CaretType` (type) | `CaretType` |
| `ChildCaret` (type) | `ChildCaret` |
| `CommonAncestorResult` (type) | `CommonAncestor` |
| `CommonAncestorResultAncestor` (type) | `CommonAncestor::Ancestor` |
| `CommonAncestorResultBranch` (type) | `CommonAncestor::Branch` |
| `CommonAncestorResultDescendant` (type) | `CommonAncestor::Descendant` |
| `CommonAncestorResultSame` (type) | `CommonAncestor::Same` |
| `FlipDirection` (type) | n/a: type-level; `CaretDirection::flip` |
| `NodeCaret` (type) | `NodeCaret` |
| `PointCaret` (type) | `PointCaret` |
| `RootMode` (type) | `RootMode` |
| `SiblingCaret` (type) | `SiblingCaret` |
| `StepwiseIteratorConfig` (type) | `StepwiseCursor` |
| `TextPointCaret` (type) | `TextPointCaret` |
| `TextPointCaretSlice` (type) | `TextPointCaretSlice` |
| `TextPointCaretSliceTuple` (type) | `TextPointCaretSlices` |
| `$comparePointCaretNext` | `caret::compare_point_caret_next` |
| `$extendCaretToRange` | `CaretRange::extend` |
| `$getAdjacentChildCaret` | `NodeCaret::adjacent_child_caret` |
| `$getCaretRange` | `CaretRange::new` |
| `$getChildCaret` | `ChildCaret::new` |
| `$getChildCaretOrSelf` | `PointCaret::child_caret_or_self` |
| `$getCollapsedCaretRange` | `CaretRange::collapsed` |
| `$getCommonAncestor` | `Read::common_ancestor` |
| `$getCommonAncestorResultBranchOrder` | `CommonAncestor::branch_order` |
| `$getSiblingCaret` | `SiblingCaret::new` |
| `$getTextNodeOffset` | `caret::text_node_offset` |
| `$getTextPointCaret` | `TextPointCaret::new` |
| `$getTextPointCaretSlice` | `TextPointCaretSlice { .. }` |
| `$isChildCaret` | `matches!(c, PointCaret::Child(_))` |
| `$isNodeCaret` | `PointCaret::as_node_caret().is_some()` |
| `$isSiblingCaret` | `matches!(c, PointCaret::Sibling(_))` |
| `$isTextPointCaret` | `matches!(c, PointCaret::Text(_))` |
| `$isTextPointCaretSlice` | n/a: distinct Rust types; always known statically |
| `flipDirection` | `CaretDirection::flip` |
| `makeStepwiseIterator` | `StepwiseCursor` (implement the trait) |

### `caret/LexicalCaretUtils` — 15

| Symbol | Rust |
| --- | --- |
| `$caretFromPoint` | `caret::caret_from_point` |
| `$caretRangeFromSelection` | `caret::caret_range_from_selection` |
| `$getAdjacentSiblingOrParentSiblingCaret` | `NodeCaret::adjacent_sibling_or_parent_sibling` |
| `$getCaretInDirection` | `PointCaret::in_direction` |
| `$getCaretRangeInDirection` | `CaretRange::in_direction` |
| `$getChildCaretAtIndex` | `caret::child_caret_at_index` |
| `$isExtendableTextPointCaret` | `TextPointCaret::is_extendable` |
| `$normalizeCaret` | `caret::normalize_caret` |
| `$removeTextFromCaretRange` | `Transaction::remove_text_from_caret_range` |
| `$rewindSiblingCaret` | `SiblingCaret::rewind` |
| `$setPointFromCaret` | `caret::point_from_caret` / `Transaction::set_point_from_caret` |
| `$setSelectionFromCaretRange` | `Transaction::set_selection_from_caret_range` |
| `$splitAtPointCaretNext` | `Transaction::split_at_point_caret_next` |
| `$updateRangeSelectionFromCaretRange` | `Transaction::update_range_selection_from_caret_range` / `caret::range_selection_from_caret_range` |
| `SplitAtPointCaretNextOptions` (type) | `SplitAtPointCaretNextOptions` |

### `LexicalCommands` — 51

| Symbol | Rust |
| --- | --- |
| `BEFORE_INPUT_COMMAND` | View (the view turns beforeinput into a `Command`/`Input`) |
| `BLUR_COMMAND` | View |
| `CAN_REDO_COMMAND` | `Effect::HistoryState` / `HistoryAvailability::can_redo` |
| `CAN_UNDO_COMMAND` | `Effect::HistoryState` / `HistoryAvailability::can_undo` |
| `CLEAR_EDITOR_COMMAND` | `Command::ClearEditor` |
| `CLEAR_HISTORY_COMMAND` | `Command::ClearHistory` |
| `CLICK_COMMAND` | View |
| `COMPOSITION_END_COMMAND` | `Input::Composition { event: CompositionEvent::End { .. }, .. }` |
| `COMPOSITION_START_COMMAND` | `Input::Composition { event: CompositionEvent::Start { .. }, .. }` |
| `CONTROLLED_TEXT_INSERTION_COMMAND` | `Command::InsertText` (string payload; the InputEvent form is view) |
| `COPY_COMMAND` | View (clipboard serialization is a read: `export_node`) |
| `createCommand` | `static X: CommandKey<P> = CommandKey::new("x")` + `Command::Extension(ExtensionCommand::new(&X, payload))` |
| `CUT_COMMAND` | View (then `Command::RemoveText`) |
| `DELETE_CHARACTER_COMMAND` | `Command::DeleteCharacter` |
| `DELETE_LINE_COMMAND` | `Command::DeleteLine` |
| `DELETE_WORD_COMMAND` | `Command::DeleteWord` |
| `DRAGEND_COMMAND` | View |
| `DRAGOVER_COMMAND` | View |
| `DRAGSTART_COMMAND` | View |
| `DROP_COMMAND` | View |
| `FOCUS_COMMAND` | View |
| `FORMAT_ELEMENT_COMMAND` | `Command::FormatElement` |
| `FORMAT_TEXT_COMMAND` | `Command::FormatText` |
| `INDENT_CONTENT_COMMAND` | `Command::IndentContent` |
| `INPUT_COMMAND` | View → `Input::TextFromView` |
| `INSERT_LINE_BREAK_COMMAND` | `Command::InsertLineBreak` |
| `INSERT_PARAGRAPH_COMMAND` | `Command::InsertParagraph` |
| `INSERT_TAB_COMMAND` | `Command::InsertTab` |
| `KEY_ARROW_DOWN_COMMAND` | `Command::Key { command: KeyCommand::ArrowDown, .. }` |
| `KEY_ARROW_LEFT_COMMAND` | `Command::Key { command: KeyCommand::ArrowLeft, .. }` (handlers may call `modify_selection` with `ModifyTarget::View`) |
| `KEY_ARROW_RIGHT_COMMAND` | `Command::Key { command: KeyCommand::ArrowRight, .. }` |
| `KEY_ARROW_UP_COMMAND` | `Command::Key { command: KeyCommand::ArrowUp, .. }` |
| `KEY_BACKSPACE_COMMAND` | `Command::Key { command: KeyCommand::Backspace, .. }` |
| `KEY_DELETE_COMMAND` | `Command::Key { command: KeyCommand::Delete, .. }` |
| `KEY_DOWN_COMMAND` | `Command::KeyDown` / `Input::KeyDown` |
| `KEY_ENTER_COMMAND` | `Command::Key { command: KeyCommand::Enter, .. }` |
| `KEY_ESCAPE_COMMAND` | `Command::Key { command: KeyCommand::Escape, .. }` |
| `KEY_MODIFIER_COMMAND` | `Command::Key { command: KeyCommand::Modifier, .. }` |
| `KEY_SPACE_COMMAND` | `Command::Key { command: KeyCommand::Space, .. }` |
| `KEY_TAB_COMMAND` | `Command::Key { command: KeyCommand::Tab, .. }` |
| `MOVE_TO_END` | `Command::Key { command: KeyCommand::MoveToEnd, .. }` |
| `MOVE_TO_START` | `Command::Key { command: KeyCommand::MoveToStart, .. }` |
| `OUTDENT_CONTENT_COMMAND` | `Command::OutdentContent` |
| `PASTE_COMMAND` | `Command::Paste(ClipboardPayload)` (the view reads DataTransfer into the payload) |
| `PasteCommandType` (type) | `ClipboardPayload` |
| `REDO_COMMAND` | `Command::Redo` / `Input::Redo` |
| `REMOVE_TEXT_COMMAND` | `Command::RemoveText` |
| `SELECT_ALL_COMMAND` | `Command::SelectAll(Option<KeyEvent>)` |
| `SELECTION_CHANGE_COMMAND` | `Effect::SelectionChange` / `Command::SelectionChange` |
| `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` | `Command::InsertClipboardNodes` |
| `UNDO_COMMAND` | `Command::Undo` / `Input::Undo` |

### `LexicalConstants` — 11

| Symbol | Rust |
| --- | --- |
| `IS_ALL_FORMATTING` | `TextFormat::ALL` |
| `IS_BOLD` | `TextFormat::BOLD` |
| `IS_CODE` | `TextFormat::CODE` |
| `IS_HIGHLIGHT` | `TextFormat::HIGHLIGHT` |
| `IS_ITALIC` | `TextFormat::ITALIC` |
| `IS_STRIKETHROUGH` | `TextFormat::STRIKETHROUGH` |
| `IS_SUBSCRIPT` | `TextFormat::SUBSCRIPT` |
| `IS_SUPERSCRIPT` | `TextFormat::SUPERSCRIPT` |
| `IS_UNDERLINE` | `TextFormat::UNDERLINE` |
| `NODE_STATE_KEY` | `json::NODE_STATE_KEY` |
| `TEXT_TYPE_TO_FORMAT` | `TextFormatType::flag` |

### `LexicalDOMSlot` — 2

| Symbol | Rust |
| --- | --- |
| `DOMSlot` (type) | View |
| `ElementDOMSlot` (type) | View |

### `LexicalEditor` — 41

| Symbol | Rust |
| --- | --- |
| `CommandListener` (type) | `Plugin::handle` |
| `CommandListenerPriority` (type) | `CommandPriority` (in `CommandRegistration`) |
| `CommandListenerPriorityBefore` (type) | `Placement::Before` |
| `CommandPayloadType` (type) | n/a: payloads are `Command` variant fields |
| `CreateEditorArgs` (type) | `EditorBuilder` (nodes → `node`/`replace`; editorState → `initial_state`; onError → `Result`; editable → `CoreConfig::editable`; namespace, theme, html, dom, disableEvents, parentEditor → View or n/a) |
| `DOMSlotForNode` (type) | View |
| `EditableListener` (type) | View |
| `EditorConfig` (type) | View (theme and namespace for createDOM) |
| `EditorDOMRenderConfig` (type) | View |
| `EditorSetOptions` (type) | `TagSet` argument of `set_editor_state` |
| `EditorThemeClasses` (type) | View |
| `EditorThemeClassName` (type) | View |
| `EditorUpdateOptions` (type) | `UpdateOptions` (skipTransforms, tag); `discrete` n/a (every commit is synchronous, D-2); `onUpdate` n/a (code after `commit()`; a nested update's `onUpdate` is code after the `queue_update` body); `event` → `ViewSelection` on the input |
| `HTMLConfig` (type) | View / lexical_html |
| `Klass` (type) | n/a: Rust type parameter `Node: NodeType` |
| `KlassConstructor` (type) | n/a: same |
| `LexicalCommand` (type) | `Command` |
| `LexicalEditor` (type) | `Editor` (member table in §4.3) |
| `LexicalNodeConfig` (type) | `EditorBuilder::node` / `replace` |
| `LexicalNodeReplacement` (type) | `EditorBuilder::replace` |
| `MutationListener` (type) | `Commit::mutations_of` |
| `NodeMutation` (type) | `Mutation` |
| `RootListener` (type) | View |
| `SerializedEditor` (type) | `SerializedEditor` |
| `Spread` (type) | n/a: TS type utility |
| `Transform` (type) | `TransformFn<Node>` |
| `UpdateListener` (type) | n/a: consume `Commit` |
| `UpdateListenerPayload` (type) | `Commit` |
| `COMMAND_PRIORITY_BEFORE_CRITICAL` | `(CommandPriority::Critical, Placement::Before)` |
| `COMMAND_PRIORITY_BEFORE_EDITOR` | `(Editor, Before)` |
| `COMMAND_PRIORITY_BEFORE_HIGH` | `(High, Before)` |
| `COMMAND_PRIORITY_BEFORE_LOW` | `(Low, Before)` |
| `COMMAND_PRIORITY_BEFORE_NORMAL` | `(Normal, Before)` |
| `COMMAND_PRIORITY_CRITICAL` | `CommandPriority::Critical` |
| `COMMAND_PRIORITY_EDITOR` | `CommandPriority::Editor` |
| `COMMAND_PRIORITY_HIGH` | `CommandPriority::High` |
| `COMMAND_PRIORITY_LOW` | `CommandPriority::Low` |
| `COMMAND_PRIORITY_NORMAL` | `CommandPriority::Normal` |
| `createEditor` | `Editor::builder(mode)…build()` |
| `DEFAULT_EDITOR_DOM_CONFIG` | View |
| `getTransformSetFromKlass` | n/a: computed in `build()` (§8.2); inspectable through `Registry` |

### `LexicalEditorState` — 4

| Symbol | Rust |
| --- | --- |
| `EditorState` (type) | `EditorState` |
| `EditorStateReadOptions` (type) | n/a: the registry is in the state |
| `SerializedEditorState` (type) | `SerializedEditorState` |
| `$isEditorState` | n/a: static typing |

### `LexicalEvents` — 2

| Symbol | Rust |
| --- | --- |
| `EventHandler` (type) | View |
| `stopLexicalPropagation` | View |

### `LexicalNode` — 22

| Symbol | Rust |
| --- | --- |
| `BaseStaticNodeConfig` (type) | n/a: `NodeType` consts replace `$config` |
| `DOMChildConversion` (type) | View (HTML import, D4) |
| `DOMConversion` (type) | View |
| `DOMConversionFn` (type) | View |
| `DOMConversionMap` (type) | View |
| `DOMConversionOutput` (type) | View |
| `DOMConversionProp` (type) | View |
| `DOMConversionPropByTagName` (type) | View |
| `DOMConversionTagNameMap` (type) | View |
| `DOMExportOutput` (type) | View / lexical_html |
| `DOMExportOutputMap` (type) | View / lexical_html |
| `LexicalExportJSON` (type) | n/a: type-level; `SerializedNode` |
| `LexicalNode` (type) | `NodeType` + kind traits; a node instance is a `NodeKey` |
| `LexicalUpdateJSON` (type) | n/a: type-level; `SerializedNode` |
| `NodeKey` (type) | `NodeKey` |
| `NodeMap` (type) | n/a: crate-private `NodeMap`; use `Read` |
| `SerializedLexicalNode` (type) | `SerializedNode` |
| `StaticNodeConfig` (type) | n/a: `NodeType` |
| `StaticNodeConfigRecord` (type) | n/a: `NodeType` |
| `StaticNodeConfigValue` (type) | `NodeType::{TYPE, REQUIRED_STATE, static_transform, import_json, Parent}` |
| `$isLexicalNode` | n/a: no foreign objects |
| `buildImportMap` | View |

### `LexicalNodeState` — 14

| Symbol | Rust |
| --- | --- |
| `$getState` | `Read::get_state` |
| `$getStateChange` | `Read::state_change` |
| `$getWritableNodeState` | n/a: internal to `set_state` |
| `$setState` | `Transaction::set_state` / `update_state` |
| `AnyStateConfig` (type) | n/a: crate-private `AnyStateKey` |
| `createSharedNodeState` | n/a: `Registry` `StateLayout` |
| `createState` | `StateKey::new` |
| `NodeStateJSON` (type) | n/a: type-level; `"$"` object |
| `StateConfig` (type) | `StateKey<Value>` |
| `StateConfigKey` (type) | `StateKey::name` |
| `StateConfigValue` (type) | the `Value` parameter |
| `StateValueConfig` (type) | `StateKey::new` arguments + `StateValue` |
| `StateValueOrUpdater` (type) | `set_state` / `update_state` |
| `ValueOrUpdater` (type) | `set_state` / `update_state` |

### `LexicalNormalization` — 1

| Symbol | Rust |
| --- | --- |
| `$normalizeSelection__EXPERIMENTAL` | `normalize_range_selection` / `Transaction::normalize_selection` |

### `LexicalSelection` — 23

| Symbol | Rust |
| --- | --- |
| `BaseSelection` (type) | `Selection` |
| `ElementPoint` (type) | `Point::Element` |
| `NodeSelection` (type) | `NodeSelection` |
| `Point` (type) | `Point` |
| `PointType` (type) | `Point` (and `PointType` for the discriminant) |
| `RangeSelection` (type) | `RangeSelection` |
| `TextPoint` (type) | `Point::Text` |
| `$createNodeSelection` | `NodeSelection::new` |
| `$createPoint` | `Point::new` |
| `$createRangeSelection` | `RangeSelection::at_root` |
| `$createRangeSelectionFromDom` | View resolves the DOM; then `Transaction::selection_from_view` |
| `$generateNodesFromRawText` | `Transaction::nodes_from_raw_text` |
| `$getCharacterOffsets` | `Read::character_offsets` |
| `$getPreviousSelection` | `Read::previous_selection` |
| `$getSelection` | `Read::selection` |
| `$getTextContent` | `Read::selection_text_content` |
| `$insertNodes` | `Transaction::insert_nodes_at_selection` |
| `$isBlockElementNode` | `Read::is_block_element` |
| `$isNodeSelection` | `Selection::is_node` |
| `$isRangeSelection` | `Selection::is_range` |
| `$updateDOMSelection` | View (driven by `Effect::SetViewSelection`) |
| `RawTextVisitor` (type) | `RawTextToken` |
| `tokenizeRawText` | `tokenize_raw_text` |

### `LexicalUpdates` — 3

| Symbol | Rust |
| --- | --- |
| `$fullReconcile` | `Transaction::request_full_reconcile` |
| `$parseSerializedNode` | `Transaction::import_node` |
| `isCurrentlyReadOnlyMode` | n/a: `&EditorState` vs `&mut Transaction` encodes it in types |

### `LexicalUtils` — 67

| Symbol | Rust |
| --- | --- |
| `$addUpdateTag` | `Transaction::add_tag` |
| `$applyNodeReplacement` | n/a: inside `Transaction::create` |
| `$cloneWithProperties` | n/a: `Arc::make_mut` in `get_mut`; for a copy, `NodeRef::to_owned` |
| `$cloneWithPropertiesEphemeral` | `NodeRef::to_owned()` (detached `NodeRecord`) |
| `$copyNode` | `Transaction::copy_node` |
| `$create` | `Transaction::create_resolved` |
| `$createChildrenArray` | `Read::children_keys` |
| `$findMatchingParent` | `Read::find_matching_parent` |
| `$getAdjacentNode` | `Read::adjacent_node` |
| `$getDOMSlot` | View |
| `$getDOMTextNode` | View |
| `$getEditor` | n/a: the `Transaction` is the context |
| `$getEditorDOMRenderConfig` | View |
| `$getNearestNodeFromDOMNode` | View |
| `$getNearestRootOrShadowRoot` | `Read::nearest_root_or_shadow_root` |
| `$getNodeByKey` | `Read::node` / `get` |
| `$getNodeByKeyOrThrow` | `Read::node_or_err` |
| `$getNodeFromDOMNode` | View |
| `$getRoot` | `Read::root` |
| `$hasAncestor` | `Read::has_ancestor` |
| `$hasUpdateTag` | `Transaction::has_tag` |
| `$isElementDOMSlot` | View |
| `$isInlineElementOrDecoratorNode` | `Read::is_inline_element_or_decorator` |
| `$isLeafNode` | `Read::is_leaf` |
| `$isRootOrShadowRoot` | `Read::is_root_or_shadow_root` |
| `$isTokenOrSegmented` | `Read::is_token_or_segmented` |
| `$isTokenOrTab` | `Read::is_token_or_tab` |
| `$nodesOfType` | `Read::nodes_of_type` |
| `$onUpdate` | n/a: run code after `commit()` returns |
| `$selectAll` | `Transaction::select_all` |
| `$setCompositionKey` | `Transaction::set_composition_key` |
| `$setDirectionFromDOM` | View (HTML import) |
| `$setFormatFromDOM` | View (HTML import) |
| `$setSelection` | `Transaction::set_selection` |
| `$splitNode` | `Transaction::split_node` |
| `getDOMOwnerDocument` | View |
| `getDOMSelection` | View |
| `getDOMSelectionFromTarget` | View |
| `getDOMTextNode` | View |
| `getEditorPropertyFromDOMNode` | View |
| `getNearestEditorFromDOMNode` | View |
| `getRegisteredNode` | `Registry::get` |
| `getRegisteredNodeOrThrow` | `Registry::get_or_err` |
| `getStaticNodeConfig` | n/a: `NodeType` consts; `RegisteredNode` |
| `getTextDirection` | `format::text_direction` |
| `INTERNAL_$isBlock` | `Read::is_block` |
| `isBlockDomNode` | View |
| `isDocumentFragment` | View |
| `isDOMDocumentNode` | View |
| `isDOMNode` | View |
| `isDOMTextNode` | View |
| `isDOMUnmanaged` | View |
| `isExactShortcutMatch` | View (KeyboardEvent) |
| `isHTMLAnchorElement` | View |
| `isHTMLElement` | View |
| `isHTMLTableCellElement` | View |
| `isHTMLTableRowElement` | View |
| `isInlineDomNode` | View |
| `isLexicalEditor` | n/a: static typing |
| `isModifierMatch` | View (KeyboardEvent) |
| `isSelectionCapturedInDecoratorInput` | View |
| `isSelectionWithinEditor` | View |
| `removeFromParent` | `Transaction::remove_from_parent` |
| `resetRandomKey` | `Editor::reset_key_counter` / `SharedKeyCounter::reset` |
| `setDOMUnmanaged` | View |
| `setNodeIndentFromDOM` | View (HTML import) |
| `toggleTextFormatType` | `TextFormat::toggled` |

### `nodes/*` — 28

| Symbol | Rust |
| --- | --- |
| `ArtificialNode__DO_NOT_USE` | `Artificial` |
| `$isDecoratorNode` | `Read::is_decorator` |
| `DecoratorNode` | `DecoratorNode` trait + `DecoratorBase` |
| `ElementFormatType` (type) | `ElementFormat` |
| `SerializedElementNode` (type) | `SerializedNode` (shape §13.2) |
| `$isElementNode` | `Read::is_element` |
| `ElementNode` | `ElementNode` trait + `ElementBase` + `ElementData` |
| `SerializedLineBreakNode` (type) | `SerializedNode` |
| `$createLineBreakNode` | `tx.create(LineBreak::default())` |
| `$isLineBreakNode` | `Read::is_line_break` |
| `LineBreakNode` | `LineBreak` (+ `LineBreakNode` trait) |
| `SerializedParagraphNode` (type) | `SerializedNode` |
| `$createParagraphNode` | `tx.create(Paragraph::default())` |
| `$isParagraphNode` | `Read::is::<Paragraph>` |
| `ParagraphNode` | `Paragraph` |
| `SerializedRootNode` (type) | `SerializedNode` |
| `$isRootNode` | `key == NodeKey::ROOT` / `Read::is::<Root>` |
| `RootNode` | `Root` |
| `SerializedTabNode` (type) | `SerializedNode` |
| `$createTabNode` | `tx.create(Tab::default())` |
| `$isTabNode` | `Read::is::<Tab>` |
| `TabNode` | `Tab` |
| `SerializedTextNode` (type) | `SerializedNode` |
| `TextFormatType` (type) | `TextFormatType` |
| `TextModeType` (type) | `TextMode` |
| `$createTextNode` | `Transaction::create_text` |
| `$isTextNode` | `Read::is_text` |
| `TextNode` | `TextNode` trait + `Text` + `TextData` |


### `LexicalUpdateTags` — 12

| Symbol | Rust |
| --- | --- |
| `COLLABORATION_TAG` | `UpdateTag::Collaboration` |
| `COMPOSITION_END_TAG` | `UpdateTag::CompositionEnd` |
| `COMPOSITION_START_TAG` | `UpdateTag::CompositionStart` |
| `HISTORIC_TAG` | `UpdateTag::Historic` |
| `HISTORY_MERGE_TAG` | `UpdateTag::HistoryMerge` |
| `HISTORY_PUSH_TAG` | `UpdateTag::HistoryPush` |
| `PASTE_TAG` | `UpdateTag::Paste` |
| `SKIP_COLLAB_TAG` | `UpdateTag::SkipCollab` |
| `SKIP_DOM_SELECTION_TAG` | `UpdateTag::SkipDomSelection` |
| `SKIP_SCROLL_INTO_VIEW_TAG` | `UpdateTag::SkipScrollIntoView` |
| `SKIP_SELECTION_FOCUS_TAG` | `UpdateTag::SkipSelectionFocus` |
| `UpdateTag` (type) | `UpdateTag` |

```rust
/// `UpdateTag`. The string form is upstream's. `Custom` holds application tags ("from-loro",
/// "local-status", "code-highlight-ids-tag", "registerMutationListener").
#[derive(Clone, PartialEq, Eq, Hash, Debug, strum::Display, strum::EnumString)]
#[strum(serialize_all = "kebab-case")]
pub enum UpdateTag {
    Collaboration, Focus, Historic, HistoryMerge, HistoryPush, Paste, SkipCollab,
    SkipDomSelection, SkipScrollIntoView, SkipSelectionFocus, CompositionStart, CompositionEnd,
    #[strum(default)] Custom(Arc<str>),
}
/// An insertion-ordered tag set.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct TagSet(IndexSet<UpdateTag>);
impl TagSet { pub fn insert(&mut self, tag: UpdateTag) -> bool; pub fn contains(&self, tag: &UpdateTag) -> bool;
              pub fn iter(&self) -> impl Iterator<Item = &UpdateTag>; pub fn from_tags(tags: impl IntoIterator<Item = UpdateTag>) -> TagSet; }
```
(`FOCUS_TAG` is not exported by index.ts but exists in `UpdateTag`; it is included as
`Focus`.)

### `environment` — 10

| Symbol | Rust |
| --- | --- |
| `CAN_USE_BEFORE_INPUT` | View |
| `CAN_USE_DOM` | View |
| `IS_ANDROID` | View (→ `ViewHost::is_android`) |
| `IS_ANDROID_CHROME` | View |
| `IS_APPLE` | View (→ `ViewHost::is_apple`) |
| `IS_APPLE_WEBKIT` | View (→ `ViewEngine::AppleWebKit`) |
| `IS_CHROME` | View |
| `IS_FIREFOX` | View (→ `ViewEngine::Firefox`) |
| `IS_IOS` | View (→ `ViewHost { engine: AppleWebKit, os: Ios }`, `is_ios`) |
| `IS_SAFARI` | View (→ `ViewEngine::AppleWebKit`) |

### `extension-core` — 30

| Symbol | Rust |
| --- | --- |
| `AnyLexicalExtension` (type) | n/a: install fns (§14.4) |
| `AnyLexicalExtensionArgument` (type) | n/a |
| `AnyNormalizedLexicalExtensionArgument` (type) | n/a |
| `configExtension` | install fn config argument |
| `configTypeSymbol` (type) | n/a: TS phantom |
| `declarePeerDependency` | n/a: explicit install calls |
| `defineExtension` | an `install(builder, config) -> EditorBuilder` fn |
| `ExtensionBuildState` (type) | n/a |
| `ExtensionConfigBase` (type) | n/a: the install fn's config struct |
| `ExtensionInitState` (type) | n/a |
| `ExtensionRegisterState` (type) | n/a |
| `InitialEditorConfig` (type) | `EditorBuilder` |
| `InitialEditorStateType` (type) | `EditorBuilder::initial_state` |
| `initTypeSymbol` (type) | n/a |
| `LexicalEditorWithDispose` (type) | n/a: `Drop` |
| `LexicalExtension` (type) | install fn + `Plugin` + `ExtensionState` |
| `LexicalExtensionArgument` (type) | n/a |
| `LexicalExtensionConfig` (type) | install fn config type |
| `LexicalExtensionDependency` (type) | n/a |
| `LexicalExtensionInit` (type) | n/a |
| `LexicalExtensionInternal` (type) | n/a |
| `LexicalExtensionName` (type) | `Plugin::name` |
| `LexicalExtensionOutput` (type) | `ExtensionState` read via `Editor::extension` |
| `NormalizedLexicalExtensionArgument` (type) | n/a |
| `NormalizedPeerDependency` (type) | n/a |
| `OutputComponentExtension` (type) | View (React component output) |
| `OutputExtension` (type) | n/a |
| `outputTypeSymbol` (type) | n/a |
| `safeCast` | n/a: TS type utility |
| `shallowMergeConfig` | struct update syntax (`..config`) |

### `utils/*` — 7

| Symbol | Rust |
| --- | --- |
| `addClassNamesToElement` | View |
| `normalizeClassNames` | View |
| `removeClassNamesFromElement` | View |
| `mergeRegister` | n/a: no unregister closures (`Drop`) |
| `getStyleObjectFromCSS` | `style::parse_css_declarations` |
| `setDOMStyleFromCSS` | View |
| `setDOMStyleObject` | View |

### Totals

| Module | Names | Rust item | View | n/a |
| --- | ---: | ---: | ---: | ---: |
| caret/LexicalCaret | 39 | 37 | 0 | 2 |
| caret/LexicalCaretUtils | 15 | 15 | 0 | 0 |
| LexicalCommands | 51 | 40 | 11 | 0 |
| LexicalConstants | 11 | 11 | 0 | 0 |
| LexicalDOMSlot | 2 | 0 | 2 | 0 |
| LexicalEditor | 41 | 26 | 9 | 6 |
| LexicalEditorState | 4 | 2 | 0 | 2 |
| LexicalEvents | 2 | 0 | 2 | 0 |
| LexicalNode | 22 | 4 | 11 | 7 |
| LexicalNodeState | 14 | 10 | 0 | 4 |
| LexicalNormalization | 1 | 1 | 0 | 0 |
| LexicalSelection | 23 | 21 | 2 | 0 |
| LexicalUpdates | 3 | 2 | 0 | 1 |
| LexicalUtils | 67 | 30 | 31 | 6 |
| nodes/* | 28 | 28 | 0 | 0 |
| LexicalUpdateTags | 12 | 12 | 0 | 0 |
| environment | 10 | 0 | 10 | 0 |
| extension-core | 30 | 9 | 1 | 20 |
| utils/* | 7 | 1 | 5 | 1 |
| **Total** | **382** | **249** | **84** | **49** |

The table is checked mechanically: every name in `index.ts` appears exactly once above, and
no row is extra. View rows that name a Rust target ("View → `Input::…`") are counted as
View: the event stays in JS and the model effect is the Rust item named. R1 moved the 14
KEY_*/MOVE_TO_* commands, PASTE_COMMAND and PasteCommandType from View to Rust items (F-16).

---

## 18. Worked examples: five upstream unit tests in both APIs

Each pair is the upstream test body (trimmed only of harness boilerplate) and the same test
against this API. Tests return `Result<(), Box<dyn std::error::Error>>`, which is allowed in
tests.

### 18.1 `$normalizeSelection`: paragraph to text nodes

`packages/lexical/src/__tests__/unit/LexicalNormalization.test.tsx`, "paragraph to text nodes".

```ts
editor.update(() => {
  const root = $getRoot();
  const paragraph = $createParagraphNode();
  const text1 = $createTextNode('a');
  const text2 = $createTextNode('b');
  paragraph.append(text1, text2);
  root.append(paragraph);

  const selection = paragraph.select();
  selection.anchor.set(paragraph.__key, 0, 'element');
  selection.focus.set(paragraph.__key, 2, 'element');

  const normalizedSelection = $normalizeSelection(selection);
  expect(normalizedSelection.anchor.type).toBe('text');
  expect(normalizedSelection.anchor.getNode().__key).toBe(text1.__key);
  expect(normalizedSelection.anchor.offset).toBe(0);
  expect(normalizedSelection.focus.type).toBe('text');
  expect(normalizedSelection.focus.getNode().__key).toBe(text2.__key);
  expect(normalizedSelection.focus.offset).toBe(1);
});
```

```rust
#[test]
fn normalize_selection_descends_paragraph_points_into_text() -> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let first = tx.create_text("a")?;
    let second = tx.create_text("b")?;
    tx.append(paragraph, &[first.key(), second.key()])?;
    let root = tx.root();
    tx.append(root, &[paragraph.key()])?;

    tx.element(paragraph)?.select(None, None)?;
    tx.set_point(PointRole::Anchor, Point::element(paragraph, ChildIndex(0)))?;
    tx.set_point(PointRole::Focus, Point::element(paragraph, ChildIndex(2)))?;
    tx.normalize_selection()?;

    let selection = tx.range_selection()?;
    assert_eq!(selection.anchor, Point::text(first, Utf16Offset(0)));
    assert_eq!(selection.focus, Point::text(second, Utf16Offset(1)));
    Ok(())
}
```

Notes:
- Six assertions on `type`, `getNode().__key` and `offset` become two `Point` equalities,
  because the point's variant carries the type.
- The transaction is dropped uncommitted. The upstream test never inspects the commit, so
  this is equivalent.
- The `reversed` variant of the upstream loop swaps `PointRole::Anchor`/`Focus` and the
  assertions.

### 18.2 `splitText` moves the selection

`nodes/__tests__/unit/LexicalTextNode.test.tsx`, `'"%s" splitText(...%p) with select(...%p)'`,
row `['Hello World', [4], [2, 7], {anchorNodeIndex: 0, anchorOffset: 2, focusNodeIndex: 1, focusOffset: 3}]`.

```ts
await update(() => {
  const paragraphNode = $createParagraphNode();
  const textNode = $createTextNode('Hello World');
  paragraphNode.append(textNode);
  $getRoot().append(paragraphNode);

  const selection = textNode.select(2, 7);
  const childrenNodes = textNode.splitText(4);

  expect(selection.anchor.getNode()).toBe(childrenNodes[0]);
  expect(selection.anchor.offset).toBe(2);
  expect(selection.focus.getNode()).toBe(childrenNodes[1]);
  expect(selection.focus.offset).toBe(3);
});
```

```rust
#[test]
fn split_text_moves_selection_into_the_parts() -> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("Hello World")?;
        tx.append(paragraph, &[text.key()])?;
        let root = tx.root();
        tx.append(root, &[paragraph.key()])?;

        tx.text(text)?.select(Some(Utf16Offset(2)), Some(Utf16Offset(7)))?;
        let parts = tx.text(text)?.split_text(&[Utf16Offset(4)])?;

        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], text.key());
        let selection = tx.range_selection()?;
        assert_eq!(selection.anchor, Point::text(parts[0], Utf16Offset(2)));
        assert_eq!(selection.focus, Point::text(parts[1], Utf16Offset(3)));
        Ok(())
    })?;
    Ok(())
}
```

Notes:
- `textNode.select(…)` returns the live selection object, and the test reads it after the
  split. In Rust the selection lives in the transaction, so the test reads it back with
  `range_selection()` after the split, and the borrow checker forbids holding it across the
  split.
- The whole `test.each` table becomes a recorded fixture (SCOPE §4 Tier A). This
  hand-written form shows the API.

### 18.3 Transforms: RootNode's transform runs last

`__tests__/unit/LexicalEditor.test.tsx`, "Calls the RootNode transform last on every update"
(first phase).

```ts
const events: string[] = [];
const $transform = (node: LexicalNode) =>
  events.push(`transform ${node.getType()} ${node.getKey()}`);
editor.registerNodeTransform(RootNode, $transform);
editor.registerNodeTransform(ParagraphNode, $transform);
editor.registerNodeTransform(TextNode, $transform);
editor.registerNodeTransform(ParagraphNode, node => {
  const lastChild = node.getLastChild();
  if ($isTextNode(lastChild) && lastChild.getTextContent() === '[third]') {
    node.append($createTextNode('fourth').setMode('token'));
  }
});
await Promise.resolve();
events.length = 0;
let paragraphNode: ParagraphNode;
editor.update(() => {
  paragraphNode = $createParagraphNode();
  $getRoot().clear().append(
    paragraphNode.append(
      $createTextNode('first').setMode('token'),
      $createTextNode('second').setMode('token'),
    ),
  );
}, {discrete: true});
let textNodes = editor.read(() => $getRoot().getAllTextNodes());
expect(events).toEqual([
  `transform text ${textNodes[0].getKey()}`,
  `transform text ${textNodes[1].getKey()}`,
  `transform paragraph ${paragraphNode!.getKey()}`,
  'transform root root',
]);
```

```rust
#[derive(Clone, Debug, Default)]
struct TransformLog(Vec<String>);

fn log_transform<Node: NodeType>(tx: &mut Transaction<'_>, node: Id<Node>) -> Result<(), Error> {
    let entry = format!("transform {} {}", Node::TYPE, node);
    tx.extension_mut::<TransformLog>()?.0.push(entry);
    Ok(())
}

fn append_fourth_after_third(tx: &mut Transaction<'_>, paragraph: Id<Paragraph>) -> Result<(), Error> {
    let Some(last) = tx.last_child(paragraph) else {
        return Ok(());
    };
    if !tx.is_text(last) || tx.text_content(last) != "[third]" {
        return Ok(());
    }

    let fourth = tx.create_text("fourth")?;
    tx.text(fourth)?.set_mode(TextMode::Token)?;
    tx.append(paragraph, &[fourth.key()])
}

#[test]
fn root_transform_runs_last() -> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(TransformLog::default())
        .transform::<Root>(log_transform::<Root>)
        .transform::<Paragraph>(log_transform::<Paragraph>)
        .transform::<Text>(log_transform::<Text>)
        .transform::<Paragraph>(append_fourth_after_third)
        .build()?;

    let ((paragraph, first, second), _commit) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let first = tx.create_text("first")?;
        tx.text(first)?.set_mode(TextMode::Token)?;
        let second = tx.create_text("second")?;
        tx.text(second)?.set_mode(TextMode::Token)?;
        tx.append(paragraph, &[first.key(), second.key()])?;
        let root = tx.root();
        tx.clear(root)?;
        tx.append(root, &[paragraph.key()])?;
        Ok((paragraph, first, second))
    })?;

    assert_eq!(editor.extension::<TransformLog>()?.0, [
        format!("transform text {first}"),
        format!("transform text {second}"),
        format!("transform paragraph {paragraph}"),
        "transform root root".to_string(),
    ]);
    Ok(())
}
```

Notes:
- The closure that captured `events` becomes `ExtensionState`, because a transform is a
  plain `fn`. The log is staged in the transaction and committed with it.
- One generic fn serves three types. Upstream's `node.getType()` is the registered type, so
  `Node::TYPE` is equivalent here.
- Upstream's second phase registers another transform after the first update. Rust
  registers transforms at build time, so the port of that phase builds the editor with the
  extra transform and calls `tx.mark_type_dirty::<Text>()`, which is exactly what
  `registerNodeTransform` does to existing nodes (D-9).

### 18.4 NodeState: flat config serialization round trip

`__tests__/unit/LexicalNodeState.test.ts`, "flat config serialization round-trip".

```ts
const numberState = createState('numberState', {
  parse: v => (typeof v === 'number' ? v : 0),
});
const boolState = createState('boolState', {parse: Boolean});
class StateNode extends TestNode {
  $config() {
    return this.config('state', {
      extends: TestNode,
      stateConfigs: [{flat: true, stateConfig: numberState}, boolState],
    });
  }
}
// …
editor.update(() => {
  const flatJSON = {[NODE_STATE_KEY]: {boolState: true}, numberState: 2, type: 'state', version: 1};
  const nestedJSON = {[NODE_STATE_KEY]: {boolState: true, numberState: 2}, type: 'state', version: 1};
  const bothJSON = {[NODE_STATE_KEY]: {boolState: true, numberState: 3}, numberState: 2, type: 'state', version: 1};
  for (const doc of [flatJSON, nestedJSON, bothJSON]) {
    const node = StateNode.importJSON(doc);
    expect(node.exportJSON()).toEqual(flatJSON);
    expect($getState(node, boolState)).toBe(true);
    expect($getState(node, numberState)).toBe(2);
  }
});
```

```rust
fn parse_number(value: Option<&serde_json::Value>) -> f64 {
    value.and_then(serde_json::Value::as_f64).unwrap_or(0.0)
}

fn parse_truthy(value: Option<&serde_json::Value>) -> bool {
    value.is_some_and(json::js_truthy)
}

static NUMBER_STATE: StateKey<f64> = StateKey::new("numberState", parse_number);
static BOOL_STATE: StateKey<bool> = StateKey::new("boolState", parse_truthy);

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct StateNode {}

impl NodeType for StateNode {
    const TYPE: &'static str = "state";
    type Kind = DecoratorKind;
    const REQUIRED_STATE: &'static [RequiredState] =
        &[RequiredState::flat(&NUMBER_STATE), RequiredState::nested(&BOOL_STATE)];

    fn default_node() -> Option<Self> {
        Some(StateNode::default())
    }
}

impl DecoratorNode for StateNode {
    type Parent = DecoratorBase;

    fn as_parent(&self) -> &DecoratorBase {
        &DecoratorBase
    }

    fn as_parent_mut(&mut self) -> Option<&mut DecoratorBase> {
        None
    }
}

#[test]
fn flat_state_round_trips() -> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).node::<StateNode>().build()?;
    let flat = json!({"$": {"boolState": true}, "numberState": 2, "type": "state", "version": 1});
    let nested = json!({"$": {"boolState": true, "numberState": 2}, "type": "state", "version": 1});
    let both = json!({"$": {"boolState": true, "numberState": 3}, "numberState": 2, "type": "state", "version": 1});

    let mut tx = editor.transaction();
    for document in [&flat, &nested, &both] {
        let object = document.as_object().ok_or("fixture is an object")?;
        let node = tx.import_node(object)?;

        assert_eq!(serde_json::Value::Object(tx.export_node(node)?), flat);
        assert!(tx.get_state(node, &BOOL_STATE));
        assert_eq!(tx.get_state(node, &NUMBER_STATE), 2.0);
    }
    Ok(())
}
```

Notes:
- `TestNode extends LexicalNode` has no Rust equivalent, because every Rust node has one of
  the four kinds. A leaf decorator is the closest match, and its JSON shape is identical.
- `toEqual` is deep equality. serde_json `Map` equality ignores order too.
- The exported bytes are `{"type":"state","version":1,"numberState":2,"$":{"boolState":true}}`,
  upstream's order (§13.2).
- `js_number` makes `2.0f64` export as `2`.

### 18.5 `removeText` across a token node

`__tests__/unit/LexicalSelection.test.ts`, "removeText / with a leading TextNode and a trailing
token TextNode / remove all text".

```ts
beforeEach(() => {
  testEnv.editor.update(() => {
    leadingText = $createTextNode('leading text');
    trailingTokenText = $createTextNode('token text').setMode('token');
    paragraph = $createParagraphNode().append(leadingText, trailingTokenText);
    $getRoot().clear().append(paragraph);
  }, {discrete: true});
});
test('remove all text', () => {
  testEnv.editor.update(() => {
    const sel = $createRangeSelection();
    sel.anchor.set(leadingText.getKey(), 0, 'text');
    sel.focus.set(trailingTokenText.getKey(), trailingTokenText.getTextContentSize(), 'text');
    $setSelection(sel);
    sel.removeText();
    expect(leadingText.isAttached()).toBe(false);
    expect(trailingTokenText.isAttached()).toBe(false);
    expect($getRoot().getAllTextNodes()).toHaveLength(0);
    const selection = $assertRangeSelection($getSelection());
    expect(selection.isCollapsed()).toBe(true);
    expect(selection.anchor.key).toBe(paragraph.getKey());
    expect(selection.anchor.offset).toBe(0);
  }, {discrete: true});
});
```

```rust
#[test]
fn remove_text_across_a_token_node_collapses_into_the_paragraph() -> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let ((leading, token, paragraph), _commit) = editor.update(|tx| {
        let leading = tx.create_text("leading text")?;
        let token = tx.create_text("token text")?;
        tx.text(token)?.set_mode(TextMode::Token)?;
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(paragraph, &[leading.key(), token.key()])?;
        let root = tx.root();
        tx.clear(root)?;
        tx.append(root, &[paragraph.key()])?;
        Ok((leading, token, paragraph))
    })?;

    editor.update(|tx| {
        let token_end = tx.text_content_size(token);
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(leading, Utf16Offset(0)),
            Point::text(token, token_end),
        ))));
        tx.remove_text()?;

        assert!(!tx.is_attached(leading));
        assert!(!tx.is_attached(token));
        assert_eq!(tx.all_text_nodes(tx.root()).count(), 0);
        let selection = tx.range_selection()?;
        assert!(selection.is_collapsed());
        assert_eq!(selection.anchor, Point::element(paragraph, ChildIndex(0)));
        Ok(())
    })?;
    Ok(())
}
```

Notes:
- Node handles cross transactions as `Id`s, with no `getLatest()`. Removed nodes still
  answer `is_attached` (false) until GC at flush, as upstream.
- `$setSelection(sel); sel.removeText()` mutates a selection object the test holds. Rust
  installs the value, then operates on the active one.

### 18.6 What the examples show

- One upstream line maps to one Rust line, except where upstream's values hide state:
  `node.select()` returns a live object, and closures capture JS variables. Those become an
  explicit read-back (`range_selection()`) and `ExtensionState`.
- `?` appears on every operation upstream can throw on. Every Rust error is one upstream
  would throw, or a type error TS would catch at compile time.
- No test needs `Rc`, `RefCell`, a thread-local or a stored closure.

---

## 19. Awkward spots, chosen shapes, and intentional divergences

### 19.1 Where a literal port is awkward, and the shape chosen

| Upstream pattern | Why it does not port literally | Chosen shape |
| --- | --- | --- |
| Module-global active editor (`LexicalUpdates.ts:69`) + `$fn()` | Needs thread-locals; re-entrancy turns into RefCell panics | `Transaction` value; `Read` trait for reads |
| `this.getWritable()` inside node methods; `node.setX().setY()` chains | A method on the node cannot reach the map | Property handles `tx.text(k)?.set_x()?.set_y()?`; user node methods are free fns taking `&mut Transaction` |
| Subclass overrides + `super.method()` | No inheritance; a self-referential supertrait bound is a cycle (E0391) | `Parent` associated type on each kind trait (`ElementNode::Parent: ElementNode`, …); the shared hooks are written once (`common_node_hooks!`); trait defaults delegate to `Self::Parent`; `ParentOf<Node>` for generic code; `default_*` = base-class body |
| Overridden mutators (ListItem.append/insertAfter/remove, ListNode.splice, Root.*) | Mutating methods need `&mut tx`, so they cannot take `&mut self` | Associated fns `fn splice(tx, this: Id<Self>, …)` dispatched through the registry vtable |
| `instanceof` across subclasses (`$isParagraphNode` true for a replacement) | No runtime class chain | `RegisteredNode::ancestry` + `Read::is::<Node>` / `get::<Ancestor>` via `as_parent` |
| Node replacement `{replace, with, withKlass}` | `with` is a JS callback | `EditorBuilder::replace::<Original, Replacement>(fn(Original) -> Replacement)`, with the subtype checked at build |
| Live selection objects with `_selection` back-references, side-effecting `point.set`, identity checks `$getSelection() === this` | Aliasing mutable objects | Selections are values in transaction-owned slots (`SelectionSlot::{Active, Detached}`, §7.6); side effects go through `set_point_at`; identity is slot equality; live point reads via `tx.anchor_at(slot)` |
| Iterators that tolerate mutation between `next()` calls | A Rust iterator borrows the state | `StepwiseCursor::next(view)` takes a fresh view per step |
| Transforms and commands that close over plugin state | Captured closures | Plain `fn` items + `ExtensionState` staged in the transaction |
| Mutation/update listeners that call `editor.update` | Listeners are stored callbacks | `Plugin::after_commit` follow-up rounds (§14.2) |
| Side-effecting config callbacks (`ChangeHandler`) | Stored callbacks fired inside an update | Typed `PluginEvent`s on the `Commit` (§14.5) |
| `editor.update` inside an update (nested, queued) | Re-entrant closure queueing | `Transaction::queue_update(fn, options)`, drained at upstream's two drain points (§8); `flush()` + `Input::Batch` reproduce same-tick batching |
| `dispatchCommand` outside an update (one `$beginUpdate` per priority level) | One transaction per dispatch | `tx.flush()` between levels (§14.2) |
| `event.preventDefault()` in key/paste handlers | DOM event object | `KeyEvent`/`ClipboardPayload` data + `tx.prevent_default()` → `Effect::PreventDefault` |
| `instanceof` + package method (`MarkNode.getIDs` on a subclass) | Closed core vtable | `EditorBuilder::node_trait` + `Read::get_dyn` |
| `setTimeout` in `$updateTextNodeFromDOMContent` | The core is sans-IO | `Effect::ScheduleRemoveEmptyText` |
| `Selection.modify` (layout) mid-update | Synchronous callback into the browser | `ModifyTarget::View` supplied with the command |
| DOM-derived selection at `$beginUpdate` | Needs the DOM | `ViewSelection` input, model half in `selection_from_view` |
| Lazy NodeState parse that mutates on read | Reads are `&self` | Parse without caching on read (D-10) |
| JS numbers (one type) | serde_json distinguishes 2 and 2.0 | Integer core fields; `js_number` for user floats |
| `RegExp` in `getTextDirection` | No regex in core | Explicit UTF-16 range tables |

### 19.2 Intentional divergences (each needs a skip-list or fixture note in conformance)

| ID | Divergence | Upstream behaviour | Why |
| --- | --- | --- | --- |
| D-1 | Withdrawn in R1. Replaced by selection slots (§7.6), which keep upstream's rule: operate on *this* selection, adjust only the active one | — | — |
| D-2 | No microtask batching. Each commit is synchronous (`discrete` n/a). `onUpdate`/`$onUpdate` are code after `commit()`. Ported as upstream, so not divergent: nested-update deferral (`queue_update`), per-level flush in dispatch, tag carry-over after selection-only commits, accumulated-dirty flush (§7.1, §8, §14.2) | Updates in one tick share a pending state and commit in a microtask | sans-IO. `Input::Batch` and `flush()` reproduce batching where it matters (one history entry per keystroke) |
| D-3 | Element `text_format`/`text_style` sync from the first text child happens in the commit, only in `ViewAttached`. Root text is cached for every committed state | The reconciler writes them during reconcile, and only with a DOM | The view becomes read-only on the model. Headless keeps upstream's headless behaviour |
| D-4 | Mutations are always computed, headless included | Mutation listeners never fire headless | The model diff is the source; Loro projection and the nodeId plugin need it headless (ai-editing-worker) |
| D-5 | Keys come from a per-editor counter plus a generation (`KeySource::PerEditor`; `KeySource::Shared` reproduces the global counter for multi-editor fixtures). A rolled-back transaction does not rewind the counter. `set_editor_state` raises the counter past the state's `max_key` | Process-global counter, never rewound | Determinism per editor; equal numbering to upstream for single-editor fixtures |
| D-6 | A UTF-16 offset inside a surrogate pair is an error | JS splits pairs into lone surrogates | Rust `String` cannot hold lone surrogates; SCOPE: "surrogate pairs must never split" (Q6) |
| D-7 | `spliceText` with a negative offset is unsupported (`Utf16Offset` is unsigned); offsets past the end are `Error::Utf16OffsetOutOfRange`, never clamped | Negative offsets count from the end (computed with the inserted text's length, an upstream bug) | No call site in core or our packages uses it |
| D-8 | `ModifyTarget::ModelSegmentation` (feature) moves by grapheme/word without layout | Headless `modify` does not move | Servers may need deleteCharacter; default `NoView` equals upstream |
| D-9 | Transforms are registered at build. "Mark every existing node of the type dirty" is an explicit `mark_type_dirty`. There is no unregister | `registerNodeTransform` at any time, which marks the type dirty and returns an unregister fn | No callbacks stored at runtime (Q11) |
| D-10 | Reading NodeState does not move a key from unknown to known, so the order inside `"$"` can differ after reads | `getValue` caches on read | `&self` reads; deep-equal JSON is unaffected |
| D-11 | DEV-only invariants run in all builds: StateKeyCollision, `$getTextNodeOffset` (error mode), the `Point.set` kind check and the getNodes collapsed check (one map lookup per point write). StateKeyCollision is checked per node + declared layout, not upstream's per-type map grown at runtime (§6) | Checked only when `__DEV__` | Upstream conformance tests run with `__DEV__` on; a release-mode fuzz must see the same errors |
| D-12 | `parse_editor_state` returns Err on bad input | `_onError` + returns a half-built state | Result errors |
| D-13 | No `onError` callback and no automatic FULL_RECONCILE recovery; Err means the state is unchanged | Reset + re-render + onError | sans-IO; the host decides |
| D-14 | Withdrawn in R1: `setDetail('unmergable')` clears the detail, and the shim reproduces it (§2.3) | — | — |
| D-15 | Kept: `ElementFormat::has_format` uses `&` on non-flag values | Same | Faithful (listed so nobody "fixes" it) |
| D-16 | The composition key is part of the transaction and rolls back on error | `_compositionKey` is mutated in place and survives a failed update | One source of truth |
| D-17 | JS-defined node classes exist only in the shim (`ForeignNode`, SCOPE D2), hosted through the dev-only `foreign-nodes` feature (§4.4); a JS override of a non-hook method gets the base behaviour | Any JS class | Shipping builds never host callbacks |
| D-18 | Replacement mismatch errors (`$applyNodeReplacement failed…`) are compile- or build-time | Runtime invariants | Typed `fn(Original) -> Replacement` |
| D-19 | Withdrawn in R2 (R2-01): pruning by ancestor `Arc` identity was wrong, because ancestors are not cloned when a descendant changes. Full-reconcile mutations and diffs now compare the node maps entry by entry (§8.7, §11.2), as upstream visits every node; only HAMT-internal sharing may be skipped, which cannot change the result | — | — |
| D-20 | Parent-editor command propagation is n/a | Dispatch walks `_parentEditor` | Nested editors are separate values; the host forwards |
| D-21 | `$getState(node, cfg, 'direct')` is "read from an older view" | Reads a stale node instance | There are no stale instances |
| D-22 | Base keys absent on import read as the Rust default (0, None, "", Normal); export still omits them (`AbsentKeys`, §13.3) | The field holds `undefined`: export omits it, reads return `undefined` | Typed fields. Byte output is identical; only arithmetic on `undefined` and `=== null` checks could differ. M1 scans the dev corpus and Loro snapshot path for such JSON |
| D-24 | `Transaction::set_editor_state` seals the transaction: later writes return `Error::WriteAfterSetEditorState` (R2-02) | Later writes go into the stale, already-committed pending state (silently lost), or throw in DEV on its frozen node map (`LexicalUpdates.ts:510-517`) | The upstream effect is either nothing or an error; Rust makes it always an error. The installed state is committed as given, as upstream |
| D-25 | `NodeSelection.deleteNodes` relocates the selection only when it acts on `Active` (R2-26) | Also relocates when no selection is active and `this` is the previous selection (`LexicalSelection.ts:462-465`) | Rust has no identity for the previous selection object; no caller in core, packages or Macro deletes through the previous selection (grep, 2026-11-07). A fixture pins the Rust behaviour |
| D-23 | Opt-in `opaque_unknown_types`: an unregistered `type` imports as an opaque record that round-trips its JSON | `parseEditorState: type "x" + not found` | Loro/sync-server peers must not drop nodes written by newer clients during rollout (audit B Q11). Orchestrator ruling: ON for collaborative document sessions (S7 `EditorSurface`, its comment fork, the ai-editing-worker session); OFF for headless/server editors (lexical-service routes, S3's two registries), which keep upstream's error. Off unless the builder calls it |

---

## 20. Open questions

All twenty were ruled on in audit R1-A §7; R2 closed Q12 and gave Q8 an owner. Q21 is new in
R2 (the `Input` wire encoding). The "R1 status" column is what the spec now
says; the original question text is kept short.

| # | Question | R1 status |
| --- | --- | --- |
| Q1 | `Transaction::with_selection` vs a selection arena | **Closed: selection slots** (§7.6). `Transaction::with_selection` removed (`EditorState::with_selection`, upstream `clone(selection)`, stays) |
| Q2 | Does any element override `getTextContent`? | **Closed: no hook.** Upstream: no element subclass overrides it; Macro: all 27 overriders are decorators (grep, 2026-11-07) |
| Q3 | Custom commands | **Closed: `Command::Extension`** with typed `static CommandKey<P>` identity and a cloneable payload (§14.1) |
| Q4 | TableSelection | **Closed: core variant + `TableSelectionHooks`**, defined here (§9.1) |
| Q5 | Randomness | **Closed: seeded RNG state in ExtensionState** (§14.3), rolled back with the transaction |
| Q6 | Lone surrogates | **Closed: reject** (`Error::LoneSurrogate`, UTF-16 at the boundary, §15.1). Corpus scan at M1 |
| Q7 | Rewind the key counter on rollback? | **Closed: no** |
| Q8 | `"$"` order after reads (D-10) | **Conditional, owned (R2):** an acceptance check of WP-26 (exports), before M1: the lexical-service export paths are shown to read no undeclared `StateKey`. If they do, the default is to cache parsed values in the pending copy (never in a committed state) |
| Q9 | Default mode / EditorCore forcing ViewAttached | **Closed: no default, no forcing.** `EditorBuilder::new(mode)`; EditorCore uses the editor's mode. (The auditor proposed a required `CoreConfig.mode`; that would be a second source of the same value, so the mode lives only on the builder.) |
| Q10 | `model-segmentation` placement | **Closed: feature in core, off** |
| Q11 | Runtime enable/disable | **Closed: flags in ExtensionState** |
| Q12 | Core History vs Loro UndoManager | **Closed (R2):** collaborative surfaces use Loro's `UndoManager` (S7 §2.2; `CoreConfig.history = None`, Macro's Loro undo claims UNDO/REDO at CRITICAL); core `History` serves headless and non-collaborative editors and Tier A replay; `MergeTracker` is available alone (§12) |
| Q13 | Full CHILDREN list | **Closed: full list in v1**, bench-gated |
| Q14 | Style strings | **Closed: `Arc<str>`** (§3.1) |
| Q15 | Error codes | **Closed: Display + `Error::kind()`** (§16) |
| Q16 | Boundary reads for DOM point resolution | **Closed:** listed in §15.1 |
| Q17 | `get_mut::<Ancestor>` | **Closed: keep** |
| Q18 | `ReplaceTextFromView` | **Closed: at M5** |
| Q19 | MSRV | **Closed:** workspace toolchain 1.94.0 |
| Q20 | Commit by value | **Closed: by value** |
| Q21 | Wire encoding of `Input`/`Output` (S7's open requirement, audit R2-4 H8) | **Closed (R2, audit R2-3 F18):** `lexical_model` has no wire derives; hot calls are primitives, the diff is §11.3's flat layout, everything else is bebop in S7's `session.bop` (§11.4) |

---

## 21. Summary counts

- `index.ts` exports: 382 names. 249 map to Rust items, 84 stay view-side, 49 are n/a
  with a reason. The coverage check found no missing or extra names. The lexical_model-targeted
  exports of other packages (`@lexical/history` 9, `@lexical/file` 3, `@lexical/extension`)
  are mapped in §12, §13.6 and §14.4.
- Node methods: 185 rows (LexicalNode 58, ElementNode 56, TextNode 37, Decorator / Root /
  Paragraph / LineBreak / Tab / Artificial 34). There are 50 overridable hooks: NodeType 8
  (`import`, `import_json`, `update_from_json`, `after_clone`, `class_name`,
  `static_transform`, `default_node`, R2.1's `flag_probe`), the 9 common hooks (declared once by
  `common_node_hooks!`, expanded into each kind trait), ElementNode 18, TextNode 11,
  DecoratorNode 4. NodeType also has the `REQUIRED_STATE`, `HAS_LANGUAGE_FIELD`,
  `FLAGS_PER_INSTANCE` (R2.1) and `IS_MARKER` consts; each kind trait has `Parent` and the required `as_parent`/`as_parent_mut`.
- Selection members: 59 (Point 5, BaseSelection 11, RangeSelection 27, NodeSelection 16).
  Caret members: §10.2–10.5 (~60 rows).
- Invariants: 112 upstream sites → 52 caller-facing `Error` variants (row 66 is now
  `EndlessFollowUps`) + 9 `InternalError` + 3 `BuildError`, plus 26 Rust-only variants (28
  with feature `foreign-nodes`, R2.1).
- 25 divergence rows (D-1, D-14 and D-19 withdrawn, so 22 live), 21 questions (none open,
  Q8 conditional with an owner), 5 worked examples.

---


## R1 resolutions

Inputs: `audit-r1-A.md` (all 50 findings plus the Q and D rulings), the core-related items of
`audit-r1-B.md` (CR-1..CR-17, P3-2, C-5/A-1, R-4 and the others that land in
`lexical_model`) and of `audit-r1-D.md`. "Changed §x" names where the spec now says it.
S3 and S4 are read-only in this pass; rows marked "S3 follows" / "S4 follows" need a
matching edit there.

### Audit A findings

| ID | Resolution |
| --- | --- |
| A-F-01 | Changed §7.6 (new `SelectionSlot`/`DetachedSelectionId`, `detach_selection`, `take_detached`, `selection_at`, `range_at`, `set_point_at`, `_at` forms), §7.4 (adjustments touch only Active), §9.4 (identity = slot equality, `$splitNodeAtPoint` builds a Detached slot), §19.1; D-1 withdrawn. Slot table holds `Option<Selection>` (not only ranges) so `deleteNodes` on a detached NodeSelection works |
| A-F-02 | Changed §3.2 (`insert_new_after(tx, this, selection: SelectionSlot, restore)`, `collapse_at_start(tx, this, selection)`), §3.3 Paragraph, §3.4, §7.4. S3 §1a.0 follows (it currently uses `Option<&RangeSelection>` / `&mut RangeSelection`) |
| A-F-03 | Changed §7.1 (`NestedUpdateFn`, `queue_update`), §8 steps 0 and 3 (drain order, `skip_transforms`/tag merge), §16 row 67, §19.1, §4.3 member table |
| A-F-04 | Changed §14.2 (flush between levels for `Editor::dispatch`/EditorCore; never for `Transaction::dispatch`), §4.3 `dispatch` doc, §15.1 |
| A-F-05 | Changed §8.8 (tag carry-over rules), §4.3 (`carried_tags`, `transaction` starts from them), §15.1 step 1 |
| A-F-06 | Changed §7.1 `flush` (full accumulated dirty sets, no-op condition, counter reset) and `commit` (flush iff anything since last flush) |
| A-F-07 | Changed §8.2 steps 1–4 (element marks in leaf phase go to the current batch; master map on first pass; root moved only if present; `IndexMap::insert` overwrite-keep-position) |
| A-F-08 | Changed §3.1 (removed `text_size`), §5.4, §3.4 row 19, §8.6, §8.7 (Updated iff dirty and Arc differs; mutations before model caches; one-Updated-per-keystroke test), §7.2 (ancestors not cloned). Chose option (a), no element size cache, as upstream |
| A-F-09 | Changed §8.7 (full-reconcile mutations from the structural walk), §4.3 `set_editor_state`, D-19. **Corrected by R2-01:** no ancestor pruning; entry-by-entry map compare; D-19 withdrawn |
| A-F-10 | Changed §8.6 (leftmost Text descendant in pre-order, descends into elements, skips decorators; link-first fixture) |
| A-F-11 | Changed §13.3 (NodeState first, then base setters with virtual `set_indent`), §3.4 Element row 40 / Text row 18, §7.3 `apply_remote_fields`, §15 `NodeChange::Update` uses it |
| A-F-12 | Changed §3.2 (`NodeType::import` override returning any `NodeKey`; default = create with replacement + virtual `update_from_json`), §7.3 `import_node`, `update_from_json_with`, §13.1 `JsonImport`/`StateImportFilter`, §13.3 (replacement's `update_from_json` runs) |
| A-F-13 | Changed §3.2 (rule for hook bodies + ast-grep rule `rules/ast-grep/lexical-hook-self-call.yml`), `ElementView`/`TextView` dispatching helpers |
| A-F-14 | Changed §3.2 table (`TextBase`, `LineBreakBase`), `IS_MARKER`, per-level `REQUIRED_STATE`/`static_transform` (registry concatenates, no fn-pointer dedupe), §3.3, §8.2 |
| A-F-15 | Changed §4.2 (`transform_each(AnyTransformFn, TransformScope)`; name differs from the auditor's `transform_all` because B-F2b-13 needs a scope that excludes Root) |
| A-F-16 | Changed §14.1 (`Command::KeyDown`, `Command::Key { KeyCommand, Option<KeyEvent> }`, `Command::Paste(ClipboardPayload)`, `tx.prevent_default()`), §15 (`Input::KeyDown` with view-routed command, `Effect::PreventDefault`), §17 (16 rows moved from View to Rust; totals 249/84/49) |
| A-F-17 | Changed §15 (`selection: ViewSelection` on Command, KeyDown, TextFromView, Composition), §15.1 step 1b (fresh transaction only; Headless requires KeepModel), §4.2 EditorMode docs |
| A-F-18 | Changed §14.2 (`Plugin::commands() -> &[CommandRegistration]`, `CommandKind`), §4.2 `plugin(self, plugin)`. Returns a borrowed slice instead of `&'static`, so a plugin's config can choose priorities |
| A-F-19 | Changed §6 (`StateValue::js_equal`, Arc identity for objects/arrays, `StateKey` cached `default_value` + `with_is_equal`, export/equivalent/update_state use `is_equal`; no plain `Vec`/`Value` impls) |
| A-F-20 | Changed §7.6 (`anchor(slot)`/`focus(slot)` + porting rule), §9.1 Point doc |
| A-F-21 | Changed §0 deps (FxHasher), §2.1 (`NodeKey: Ord` = (generation, index)), §5.1, §5.2 `nodes_of_type` (key order; HAMT order never exposed). Chose fixed hasher + sort over `OrdMap` (keeps O(1)-ish lookups on the hot path) |
| A-F-22 | Changed §5.1 (fresh `OnceLock` per pending copy) |
| A-F-23 | Changed §9.1 (`TableSelection { table, anchor, focus, dirty }`, `TableSelectionHooks` with `StateRef`/`&mut Transaction`), §4.2 `table_selection_hooks`. `dirty` exists (needed by `editorStateHasDirtySelection`). S3 §1b.5 follows |
| A-F-24 | Changed §7.2 (`Transaction::set_editor_state` commits pending first, then installs the state), §11.1 `Commit::preceding`, §12 `undo_in`/`redo_in`, §15 (`Output::commits`, diff spans the chain, `ApplyError::committed`), §15.1. Differs from the auditor's two-transaction flow: one transaction with an internal early commit is what upstream does, and it keeps the outer flush (transforms on the history state). **Superseded by R2-02:** the early commit is the commit phase only, and the installed state is sealed; no transform runs on it |
| A-F-25 | Changed §15.1 ApplyRemote (two-phase remove-then-splice sequence, fuzzed against the Loro projection) |
| A-F-26 | Changed §7.2 `committed_state`, §7.6 `set_selection_format`/`style`/`toggle_selection_format` |
| A-F-27 | Changed §7.4 `default_splice` doc (cleanup only under an active RangeSelection; fixture per selection kind) |
| A-F-28 | Changed §8.4 (deep-children walk removes from `dirty_elements` only; leaf retention quirk ported with a test) |
| A-F-29 | Changed §3.1 (`AbsentKeys`), §13.2 (absent keys omitted), §13.3, new D-22. Did not wait for the corpus scan: the bit costs one byte per record and keeps bytes identical either way; the scan is an M1 task that only decides whether D-22's read-side difference matters |
| A-F-30 | Changed §8.1 (`PointNodeNotFound` before transforms and before SelectionLost), §16 row 17 |
| A-F-31 | Changed §4.2 `transform` (direct replacement, one level), §8.2, §11.1 `Commit::mutations_of` (transitive, not `Node` itself when replaced), §4.1 `resolve_replacements` |
| A-F-32 | Changed §7.3 `create_resolved`, §3.5 `default_data` (R2-43: now `NodeType::default_node`), §17 `$create` row, §16 `NoDefault` |
| A-F-33 | Changed §13.2 (element base keys from virtual getters; `indent` = `Read::indent`) |
| A-F-34 | Changed §7.5 `split_text` (parts are `create::<Text>` with replacement; copy format/style/detail/state, not mode; segmented self replaced) |
| A-F-35 | Rejected the per-type runtime map; listed under D-11 and §6. Reason: a per-type map that grows during reads needs interior mutability in `&EditorState` reads (or a staged copy in every read path) for a DEV-only check of a programming error; the declared-layout check at build plus the per-node check catch the realistic cases |
| A-F-36 | Changed §11.1 `Changes::mutations` (specified order; conformance compares per-class maps as sets) |
| A-F-37 | Changed §13.1 `to_js_json_string` (integer-like key hoisting, `js_number`) |
| A-F-38 | Changed §4.3, differently: kept `update` on `Error` and added `try_update<Value, Failure: From<Error>>`. Reason: a generic `Failure` on `update` leaves `?`-only closures (every example in §18) without an inferable error type |
| A-F-39 | Changed §11.1 (`Commit::mutations_of`; removed `Changes::mutations_of`), §4.3, §17 |
| A-F-40 | Changed §3.2 (`element_node_base!`/`decorator_node_base!`/`text_node_base!`), §1 layout |
| A-F-41 | Changed §4.2 `node_trait`, §5.2 `get_dyn`, §3.5 `parent_any`, §1 layout. **Corrected by R2-42/R2-51:** the stored projection is an erased closure over `&dyn Any`, and the vtable has `project`/`project_mut` chain walks |
| A-F-42 | Changed §7.2 (borrow pattern example, `update_node`) |
| A-F-43 | Changed §2.1 (each generic `Read` method is an `#[inline]` shim over a non-generic body). Chose the auditor's alternative so call sites keep passing `Id<_>` |
| A-F-44 | Changed §14.1 (`CommandKey<Payload>` static identity, `ExtensionCommand::new/payload`, `Arc` payload, `Command: Clone`) |
| A-F-45 | Changed §3.1 (`style`/`text_style: Arc<str>`, `data: Arc<dyn AnyNodeData>` cloned only on `get_mut`), §11.1 `encode_diff`. `TextBuffer` stays owned (typing writes it anyway) |
| A-F-46 | Changed §2.3 (`setDetail('unmergable')` clears; Rust `FromStr` rejects the misspelling; shim reproduces it), D-14 withdrawn |
| A-F-47 | Changed §4.3 (`reset_key_counter -> Result`, `KeyResetWithNodes`; `set_editor_state` raises the allocator), §5.1 `max_key`, D-5 |
| A-F-48 | Changed §12 (`isTextNodeUnchanged` compares `to_js_json_string`) |
| A-F-49 | Changed §2.2 `TextBuffer::slice` wording |
| A-F-50 | Changed §8 intro and §8.6 (mutations computed before model-cache writes; those writes are invisible to Changes and mutations) |

### Audit A rulings (§7 open questions, §8 divergences)

| ID | Resolution |
| --- | --- |
| A-Q1 | Applied: selection slots (§7.6) |
| A-Q2 | Applied: no hook; verified Macro's 27 `getTextContent` overrides are all decorators (§20) |
| A-Q3 | Applied: typed `CommandKey` (§14.1) |
| A-Q4 | Applied: hooks defined in S1 (§9.1) |
| A-Q5 | Applied: RNG state in ExtensionState (§14.3). S3 follows (move `Box<dyn IdGenerator>` into ExtensionState) |
| A-Q6 | Applied: reject + UTF-16 boundary + `Error::LoneSurrogate` (§15.1, §16) |
| A-Q7 | Applied (no rewind) |
| A-Q8 | Applied as conditional (§20) |
| A-Q9 | Applied with a different fix: `EditorMode` has no default and is set only by `EditorBuilder::new(mode)`; no `CoreConfig.mode` (that would be a second source of the same value); `CoreConfig` has no `Default` (§4.2, §15, §20) |
| A-Q10, A-Q11, A-Q13, A-Q17, A-Q18, A-Q20 | Applied as accepted (§20) |
| A-Q12 | Kept open until M2; the undo flow works either way (§15.1). Closed in R2 (§20) |
| A-Q14 | Applied: `Arc<str>` (§3.1) |
| A-Q15 | Applied: `Error::kind()` (§16) |
| A-Q16 | Applied: boundary read list (§15.1) |
| A-Q19 | Applied: toolchain 1.94.0 confirmed (§0) |
| A-D-1 | Applied: withdrawn (§19.2) |
| A-D-2 | Applied: conditions written into D-2 and ported (§7.1, §8, §14.2) |
| A-D-3, A-D-4, A-D-19 | Applied with F-10 / F-8 + F-9 (§8.6, §8.7, D-19 text) |
| A-D-5 | Applied with F-47 (D-5 text) |
| A-D-7 | Applied: past-the-end offsets error (D-7 text) |
| A-D-10 | Conditional with Q8 |
| A-D-11 | Applied: Point.set kind check and collapsed getNodes check now in all builds (D-11, §16 rows 18–19, §7.6) |
| A-D-14 | Applied: withdrawn, shim reproduces upstream (§2.3) |
| A-D-6, A-D-8, A-D-9, A-D-12, A-D-13, A-D-15..A-D-18, A-D-20, A-D-21 | Accepted, unchanged |
| A-D-22 (new) | Added (§19.2) |

### Audit B items that land in `lexical_model`

| ID | Resolution |
| --- | --- |
| B-CR-1 | Satisfied (§3.2 mutator hooks, §3.5 vtable); F-13 rule makes parent bodies dispatch virtually |
| B-CR-2 | Satisfied by `Parent`/`as_parent`/`as_parent_mut`, `is::<T>`, `get::<T>`, `get_mut::<T>`, `cast::<T>` (§2.1 note). S3 follows: rename `Extends`/`base`/`node_mut` to these |
| B-CR-3 | Satisfied; import ordering now specified (§3.2 `import`, §13.3: replacement's `update_from_json` runs) |
| B-CR-4 | Satisfied (§8.2 per-level static transforms; direct-replacement scope) |
| B-CR-5 | Satisfied by `adjust_export_json(&self, NodeView, &mut SerializedNode)` (S3's `export_json_fixup` is this name); framework base keys use virtual getters (§13.2) |
| B-CR-6 | Satisfied by the alternative: ExtensionState holds config (§14.3). Closures rejected (decision: no stored callbacks) |
| B-CR-7 | Changed §9.1, §4.2 (F-23) |
| B-CR-8 | Changed §7.2 `committed_state`; `previous_selection` already existed |
| B-CR-9 | Satisfied via slots (§9.4 note): detached `remove` no-op, `format_text_at(Detached)` |
| B-CR-10 | Satisfied (`is_simple_text`, §8.2–8.3) |
| B-CR-11 | Changed §3.2 `NodeType::import` may return another type (F-12) |
| B-CR-12 | Changed §13.1 `JsonImport`/`StateImportFilter`, §7.3 `update_from_json_with` (F-12) |
| B-CR-13 | Changed §13.1 `to_js_json_string` with integer-like key hoisting (F-37; B Q18) |
| B-CR-14 | Changed §4.2 `transform_each` (F-15) |
| B-CR-15 | Satisfied (`Commit` tags, `changes.dirty_leaves`, `prev.selection()`); tag set now follows carry-over (§8.8) |
| B-CR-16 (R-4, Q6) | Changed §3.2 `after_clone`, §3.1 clone points |
| B-CR-17 (P3-1, F2b-8) | No core change needed: one `Registry` per builder configuration, and states reject foreign registries; written down in §4.1. S3 defines the two builders |
| B-P3-2 (two import designs) | Core side changed: one mechanism, `NodeType::import` + `update_from_json_with(JsonImport { state: StateImportFilter, base_fields, own_fields })` (§3.2, §13.1). `StateImportFilter::{All, Only, None}` covers S3's four `ImportedState` variants (Full, IdOnly, IdAndPeer, None) and `base_fields: false` is `IMPORT_ELEMENT_DATA = false`. S3 follows: keep one `ImportPolicy` that lowers onto this, and one `SearchText` |
| B-C-5 / B-A-1 (hook signatures) | S1's §3.2 block is normative. Changed: `insert_new_after`/`collapse_at_start` take `SelectionSlot`; `reset_on_copy(tx, this, original)`. Names: `CopyDestination` (not `ExtractDestination`), `create_parent_element` (not `create_parent_element_node`), `adjust_export_json` (not `export_json_fixup`). `can_select_before` rejected as a core hook: only TableNode defines it and no core code calls it; reachable via `get_dyn`. S3 follows |
| B-F2a-7 | Changed §3.2 `reset_on_copy` gets `tx` + original key, so ListItemNode can call the parent-aware `getChecked()` |
| B-F2b-10 | Changed §8.3 (asymmetric `can_merge`, one merge per direction) |
| B-F2b-13 | Changed §4.2 `TransformScope::AllExceptRoot` |
| B-F2b-16 / B-A-4 | Changed §8.2 (transform order fully specified). S3 follows: cite §8.2 |
| B-P3-4 / B-A-5 (absent vs null) | Core base keys: changed §3.1/§13.3 (`AbsentKeys`, D-22). Per-node `Option` fields are S3's |
| B-A-6 (falsy strings) | No core change: `json::js_truthy` exists (§13.5); the per-call-site rule is S3's |
| B-Q11 (unknown node types) | Changed §4.2 `opaque_unknown_types` (opt-in), new D-23 |
| B-C-1 (clipboard) | Core side changed: `Command::Paste(ClipboardPayload)` (§14.1). The clipboard model half (`$insertGeneratedNodes`, `$generateJSONFromSelectedNodes`, …) is a package; S3 owns it |
| B-C-2 (plain-text) | No core change; §14.2 names `registerPlainText` as a lexical_rich_nodes Plugin. S3 owns it |
| B-C-6 (ClearEditor semantics) | Changed §14.1 `Command::ClearEditor` doc: `$onClear` belongs to the ClearEditor plugin (S3) and uses `queue_update` (F-3) |
| B-F2b-12 | No change: `serde_json::Map` with `preserve_order` is an `IndexMap`, whose equality is also order-insensitive, so §18.4's note stands |

### Audit D items that land in `lexical_model`

| ID | Resolution |
| --- | --- |
| D-C3 (hook list) | Changed §3.2: `canMergeWhenEmpty`, `canInsertAfter`, `insertAfter`, `isTextEntity`, `canHaveFormat` were already hooks; `resetOnCopyNodeFrom` now gets the original. The "also overridable" list (`isSimpleText`, `splitText`, `setTextContent`, `mergeWithSibling`, `select*`, `insertBefore`, `getTopLevelElement`) is rejected as hooks with the reason written in §3.2: no upstream package or Macro node overrides them. S4 follows (hosting tests per hook; drop `canBeTransformed`) |
| D-C7 (KeySource, deterministic key reset, flush name) | Changed §2.1 `KeySource::{PerEditor, Shared(SharedKeyCounter)}`, §4.2 `key_source`, §4.3 `reset_key_counter -> Result` (F-47), §7.1 (`flush` is the per-update boundary; S4's `end_update` should be renamed). S4 follows |
| D-D2 / KEY_* and PASTE classification | Changed §14.1, §15, §17 (F-16) |
| D-F6 (work counters) | Changed §0 feature `bench-counters`, §11.1 `Commit::work` |
| D-B9, D-G6 (entropy, clocks) | No new core API: the core reads no clock (`HistoryTime` is passed in) and randomness is ExtensionState RNG state (Q5, §14.3), so both are injectable |
| D-B4 (stale handles) | No core change: committed states are persistent and cheap to keep, so replay can resolve a stale handle against the state of its commit |
| D-D5 (compare Commit contents) | No core change: `Commit::changes`, `normalized` and `tags` are public; their order and quirks are now specified (§8.2, §8.4, §8.8, §11.1) |
| D-D1 (TextFromView differential) | No core change; `Input::TextFromView` now carries `selection` (F-17), which S4's command should include |

### Decisions that may need the user

- F-24 is resolved with one transaction that commits early inside `Transaction::set_editor_state`, which is upstream's flow but means a failed apply can leave one commit applied (`ApplyError::committed`).
- D-23 (`opaque_unknown_types`) is a new opt-in divergence driven by audit B's Q11 ruling.
  Ruled in the R1 consistency pass: on for collaborative document sessions, off for
  headless/server editors (§4.2, §19.2).
- F-35 rejected (per-type state-key collision map); one DEV-only upstream error is not reproduced.

### R1 consistency pass (S3/S4/S7/S8 against this revision)

S1 is the source of truth; the pass edited S3, S4, S7 and S8 to match it and changed S1 only
where an S3 core requirement was still open:

| Item | Change |
| --- | --- |
| S3 CR-19 | Added `Transaction::is_writable` (§7.2) |
| S3 CR-22 (new) | Added `Error::Invariant(&'static str)` for package/Macro invariants (§16 Rust-only table, counts). R2-44 made it `Cow<'static, str>` |
| D-23 ruling | §4.2 `opaque_unknown_types` doc and the §19.2 row: on for collaborative document sessions (keyed to the role, not `EditorMode`), off for headless/server editors |

Every other S3 CR (CR-1..CR-18, CR-20, CR-21) is satisfied by this revision as written; S3 §0.3
cites the section for each.

## R2 resolutions

Inputs: `audit-r2-1.md` (all 58 findings), the `lexical_model` items of `audit-r2-2.md`
(G-1, G-2, G-10..G-12, T1a rows targeted at `lexical_model`, Appendix B core families, §5
items 1-3), the S1 items of `audit-r2-4.md` (B2, H5, H8, M1, M5, M6, the platform notes), and
`audit-r2-3.md` F18 and F36. Other specs were read-only in this pass; "S3 follows" etc. marks a
matching edit there. Trait and lifetime shapes were compiled with rustc 1.94.0 in
`target/lexical-upstream-port/probe` (`cargo test`, `cargo check --target
wasm32-unknown-unknown`): the kind-trait inheritance with `common_node_hooks!`, `ParentOf`,
`Id::upcast`, `project`/`project_mut`, `get_mut::<Ancestor>`, the `node_trait` erasure through
ancestry, `StateRef` by-value borrows under `Read`, the const `StateKey` builders, the
`Send + Sync` assertions, `Plugin::after_commit`, and `PluginEvent`. The R1 form
`trait ElementNode: NodeType<Kind = ElementKind, Parent: ElementNode>` reproduces E0391.

### Audit R2-1 (fidelity)

| ID | Resolution |
| --- | --- |
| R2-01 | Applied. §8.7 and §11.2: full-reconcile mutations and diffs compare node maps entry by entry; `Children` candidates are derived from changed keys; one-keystroke-undo test. The optional `touched` set was not added: skipping HAMT-internal nodes the two `imbl` maps share is sound and gives the same proportionality where `imbl` allows it. D-19 withdrawn; A-F-09 annotated |
| R2-02 | Applied. §7.2 `Transaction::set_editor_state`: early commit is the commit phase only (no flush), the installed state is committed as given, the transaction is sealed; `Error::WriteAfterSetEditorState` (§16), D-24, A-F-24 annotated. Fixture: a root transform that appends a paragraph does not run on undo (§12, Macro has three root transforms) |
| R2-03 | Applied. §8.6: only elements present in `prev` and dirty (full reconcile: in both states) are synced; Enter-after-bold fixture |
| R2-04 | Applied. §6: `equivalent` rules (identity short-circuit, defaults for a missing side, unknown entries by primitive value or `Arc` identity); `unknown` is `IndexMap<String, Arc<serde_json::Value>>` |
| R2-05 | Applied, differently: §3.2 default `import` uses `default_node()` (constructor defaults, the replacement's `with` sees a default original), and falls back to `import_json` only for types whose constructor needs arguments, which is what such upstream `importJSON`s do |
| R2-06 | Applied. §3.4 TextNode row 11 and §13.3 (D-22 now names `=== 0`); no-merge fixture |
| R2-07 | Applied. §14.1 `InsertClipboardNodes { nodes, selection: SelectionSlot }`. S3 follows (`insert_generated_nodes`, `insert_clipboard_nodes_in_table`) |
| R2-08 | S1 side applied: the slot setters exist as `set_selection_style_at`/`toggle_selection_format_at` (§7.6). S3 follows (`patch_style_text`, `escape_formats_for_trigger` take `SelectionSlot`) |
| R2-09, R2-10, R2-11, R2-12, R2-13, R2-14, R2-16 | S3 only; no S1 change. S3 follows |
| R2-15 | S1's §3.2 signatures stay normative, and R2-38 changes their shape: S3 impls put `type Parent`, `as_parent*` and any common-hook override (`remove`, `insert_after`, …) in the kind-trait impl, and `NodeType` impls carry only `TYPE`, `Kind`, consts and the `NodeType` methods. Decorators have no `exclude_from_copy` (§3.2 now says so). S3 follows, including the doc-test crate that compiles every S3 `impl` block against S1 |
| R2-17 | Applied. §14.2 and §15.1 step 1b: a command with no listener opens no transaction and commits nothing; `Command` inputs apply the view selection lazily; §4.3 `dispatch` doc |
| R2-18 | D-25 not added: the rollback is already D-16. Added the Tier C masking rule to §8.8. S4 follows (comparator) |
| R2-19 | Applied. §9.4 `select_all(expand: Option<SelectionSlot>)`; handlers call `select_all(None)`. S3 follows (S3:514) |
| R2-20 | Applied. `NodeType::HAS_LANGUAGE_FIELD` (per level, ORed), `RegisteredNode::has_language_field`, `Read::has_language_field`, §9.4 `insertNodes` CASE 1-3. S3 sets it on CodeNode |
| R2-21 | Applied. `delete_word`/`delete_line` and `Command::DeleteWord`/`DeleteLine` take `character_target` (§9.4, §14.1) |
| R2-22 | Applied. §5.3 and §10.4: cursors are one step eager; `node_carets`/`siblings` take the construction view; fixture |
| R2-23 | Applied. `Commit::id: CommitId` (§11.1); `History` keeps `current_commit` and skips only on it (§12); `same_snapshot` doc corrected (§5.1); fixture |
| R2-24 | Applied. §12 merge rules: HISTORY_PUSH suppresses only the merge-tag and delay rules; tracker updates after every non-HISTORIC evaluation |
| R2-25 | Applied. §9.4 `insert_nodes_at_selection` uses `detach_previous_selection()` (new, §7.6) |
| R2-26 | Applied as ledger row D-25 (relocation only for `Active`) |
| R2-27 | Applied. §7.4 `default_remove` doc; whitelisted in the F-13 rule (§3.2) |
| R2-28 | Applied. §8.2 step 2 |
| R2-29 | Applied. §8.3 `normalize_range_selection` doc |
| R2-30 | Applied. §3.4 LexicalNode row 17 |
| R2-31..R2-37 | S3 only. S3 follows |
| R2-38 | Applied (blocker). §3.2 rewritten: `Parent`/`as_parent*` live on each kind trait; the nine shared hooks are declared once in `common_node_hooks!` and expanded into each kind trait; `KindOf<Node>::Parent` and `ParentOf<Node>` for generic code; `type Kind: NodeKindMarker + KindOf<Self>` makes `EditorBuilder::node`/`replace` need no `where` clause (§4.2); §0 claim corrected; §19.1, §21, §18.4 updated. The auditor's second option (keep `Parent` on `NodeType`, required kind methods filled by macros) was not chosen: users would have to restate every kind method |
| R2-39 | Applied. §5.2: `StateRef` inherent by-value methods return `'state` borrows and the `Read` defaults call them; `ElementView::data(self)`, `TextView::data(self)`, `TextPointCaretSlice::text_content<'state>` |
| R2-40 | Applied. `EditorState::is_empty_state`, `EditorState::root_text_content` (§5.1, §5.4, §4.3) |
| R2-41 | Applied. §0 thread-safety bullet (supertraits, compile-time assertions); §3.1 `AnyNodeData` |
| R2-42 | Applied. §4.2 `node_trait`: erased closure over `&dyn Any`, keyed by `(TypeId of Node, TypeId of Trait)`, looked up along the ancestry with `project` first (so abstract ancestors work); A-F-41 annotated |
| R2-43 | Applied, with a different macro: `NodeType::default_node()` (default `None`); `impl_default_node!()` writes it, because `default_node` is a `NodeType` method and the `*_node_base!` macros expand inside kind-trait impls. Built-ins return `Some` (§3.3); `create_resolved` uses it (§7.3) |
| R2-44 | Applied. `Error::Invariant(Cow<'static, str>)` + `invariant!` (§16) |
| R2-45 | Applied. §16 "Error types outside this crate". S3 follows (package `Error` enums; `UnregisteredNodeType { type_name }`) |
| R2-46 | Applied on the S1 side (§16: `CopyDestination` is the one definition; `lexical_html` re-exports it). S3 follows |
| R2-47 | No S1 change: `StateRef<'_>` is already the read type a transaction can produce (§5.2). S3 follows |
| R2-48 | Applied with H5: `Plugin::after_commit(&self, tx, commit)` and the follow-up rounds (§14.2), `Commit::following`/`follow_up_error`, `Editor::run_after_commit`, synthetic all-Created commit at `build()` (§4.2), `Error::EndlessFollowUps` (§16 row 66). S3 follows (NodeId/PeerId plugins implement the trait method instead of `after_commit(editor, commit)`) |
| R2-49 | Applied. `TextNode::selection_transform(tx, this)`; §8.1 |
| R2-50 | Applied. §6 implementation note |
| R2-51 | Applied. §3.5 `project_mut` |
| R2-52 | Applied. `TableSelection: Copy`, `Selection::as_table`/`is_table` (§9.1). S3 follows (`insert_nodes(self, tx, …)`) |
| R2-53 | First option rejected: amending "no stored callbacks" would reverse a user decision. Second option applied and generalized: typed `PluginEvent`s staged in the transaction and carried on `Commit::events` (§14.5), surfaced as `Effect::PluginEvent`. Pure `fn`-pointer configuration stays allowed. S3 follows (`AutoLinkChanged`) |
| R2-54 | Applied. `anchor_at`/`focus_at`, `set_selection_format_at`/`set_selection_style_at`/`toggle_selection_format_at`, plain Active forms, and the naming rule (§7.6) |
| R2-55 | Applied, as the struct option: `NodeKey::from_parts(KeyParts { generation, index })`, `NodeKey::parts` (§2.1) |
| R2-56 | Applied. The record is `NodeSlot` (§3.1, §5.1, §1) |
| R2-57 | Applied. `Arc<str>` on `RangeSelection::style`, `TextProps::style`, `ElementProps::style`/`text_style` |
| R2-58 | Applied. `Input`, `CompositionEvent`: `Clone, PartialEq, Debug`; `Output`: `Clone, Debug`; `Command: PartialEq` via `ExtensionCommand`'s identity `PartialEq`; `Error: Clone` (so `Output` and `Commit` stay `Clone`) |

### Audit R2-2 (completeness)

| ID | Resolution |
| --- | --- |
| G-1 | S1 side applied: §0 `/// s2:` rule, and an "S2:" line at the head of every section, covering the core families of Appendix B (CARET, CFG, CMD, EL, EVT, FMT, HDL, HIS, ID, JSON, LST, NODE, NRM, NS, SEL, TAG, TF, TX, UPD). §15.4 classifies every EVT id as model (with its Rust item) or view. S2 and S4 follow (`Src` column, recorder coverage, `lexical-coverage` reading `s2:`) |
| G-2 | S1 uses `SEL-nn` only for S2 §3A and states that §3D is `LSEL-nn` (§0). S2 follows (rename) |
| G-10, T1a | `@lexical/history` (9 rows) mapped in §12; `@lexical/file` (3 rows) in §13.6 (new `SerializedDocument`); `@lexical/extension` rows targeted at `lexical_model` mapped in §14.4 (builder and lookups → `EditorBuilder`, `extension`, new `try_extension`, `Registry::types`; built-in extensions → S3 §1a.17 owner). S2 follows (retarget those rows) |
| G-11 | S1 keeps `isCurrentlyReadOnlyMode` n/a (the types encode it). S4 follows: move `hand::lexical_gaps::read_only_mode_inside_read` to the shim's `view_gaps.test.ts` |
| G-12 | Q12 closed (§20); §12 cites re-derived against v0.45.0 (97/203/238/358/394/430/463/483/593/679/771); `dateNow` → `HistoryTime`, `delayOrSignal` → `History::set_config` |
| §5 item 1 (Q8) | Owner: WP-26 acceptance check (§20) |
| §5 item 2 (Q12) | Closed (§20) |
| §5 item 3 (`Input` encoding) | Closed as Q21 by F18 (§11.4) |

### Audit R2-3 (sync)

| ID | Resolution |
| --- | --- |
| F18 | Applied. §11.4: primitives for hot calls, the flat diff (§11.3 now spells out word conventions, the header and every opcode with its exact payload and word count, plus the `DiffOpcode` enum and `DIFF_NONE`), bebop for everything else in S7's `session.bop`; `lexical_model` has no wire derives; `ABI_MAJOR` and the mirrored `DIFF_FORMAT_VERSION`/`DiffOpcode` are generated from `session.bop` and asserted against `lexical_model` at compile time and in a test. S7 follows |
| F36 | Applied. `MergeTracker::new`/`classify` usable without `History` (§12) |

### Audit R2-4 (implementability)

| ID | Resolution |
| --- | --- |
| B2 | S1 side applied: feature `foreign-nodes` with `EditorBuilder::foreign_node(ForeignNodeType)`, `ForeignHooks`, `ForeignData`, `Read::foreign_data`, `BuildError::UnknownForeignParent` (§4.4), D-17 updated. Dev-only; a `cargo x deps` check keeps it out of shipping crates. S4 follows (`lexical_conformance_wasm`, §2.8) |
| H5 | Applied (see R2-48) |
| H8 | Q12 closed, Q8 owned, `Input` wire encoding closed (Q21, §11.4). The `record_timestamp` row is S3/S7's |
| M1 | Applied. §0 pinned dependency table, `preserve_order` unification note |
| M5 | Applied. §0 per-crate checks block (for the crate's `AGENTS.md`) |
| M6 | S1 side applied: §0 observability bullet (the core emits no spans; callers record `Commit` counts). S7 follows (the `editor.open` phases) |
| Crate graph / native-mobile | Applied. §0 platform bullet (wasm32 without a JS host, iOS/Android native, no clock, no randomness, CI target checks) |

### Changes other specs must make

This is the complete, final list after R2.1 (it replaces the R2 list; part B applies it). Each
item names the S1 section it follows.

- **S2.**
  - Rename §3D `SEL-*` to `LSEL-*` (G-2).
  - Retarget the `@lexical/extension` built-in extension rows to S3's owner (§14.4).
  - `NormalizeTripleClickSelectionExtension` (+ Config/Output): model `lexical_model`
    (`Transaction::fix_focus_overselection`), plugin S3 `lexical_rich_nodes`, triple-click
    tracking `web-view`. `ClickAfterLastBlockExtension` (+ Config/Output,
    `$defaultShouldInsertAfter`): model S3 `lexical_rich_nodes::click_after_last_block`, hit
    test `web-view` (§14.4).
- **S3.**
  - Kind-trait impl shape (R2-15/R2-38). §0.3 status citations for CR-1, CR-2 and CR-5 name
    the R2 locations: mutator hooks and `Parent`/`as_parent*` are on the kind traits
    (`common_node_hooks!`), not `NodeType`.
  - CR-23's text says "one follow-up transaction per plugin"; S1 runs one follow-up per round
    shared by every plugin (§14.2). Restate CR-23 to match.
  - `default_node` on node types with constructor defaults; `flag_probe` on every other
    registered type, or `FLAGS_PER_INSTANCE = true` with the state in its props (R2.1,
    §3.2). Audit each of the Macro and package types for per-instance flag answers (S12 Q3).
  - `HAS_LANGUAGE_FIELD` on CodeNode.
  - Slot-taking `patch_style_text`, `escape_formats_for_trigger`, `insert_generated_nodes`,
    `trim_text_content_from_anchor`; `select_all(None)`; `delete_word`/`delete_line`
    callers pass `character_target`.
  - NodeId and PeerId implement `Plugin::after_commit` (empty `commands()` where they have
    no commands); no `CommitHook` (§14.2 "One post-commit mechanism"). PeerId's remote rule
    (S11 §5.1) is part of its `after_commit`. `SetLocalPeer` is a PeerId extension command.
  - Autolink emits `AutoLinkChanged`; package `Error` enums wrap `lexical_model::Error`;
    `TableSelectionExt` by value; `StateRef` in callbacks; `CopyDestination` re-exported.
  - `insert_data_transfer_for_rich_text` reads `ClipboardPayload::html_nodes` where upstream
    calls `$generateNodesFromDOM` (§14.1).
  - New `lexical_rich_nodes::normalize_triple_click` plugin and
    `lexical_rich_nodes::click_after_last_block` (§14.4).
  - Plugins with `IS_IOS`/`IS_ANDROID`/`IS_APPLE` branches (rich-text, Macro's
    `native-ios-backspace`, `word-navigation`) read `tx.view_host()` (§7.2, §15).
  - The table observer's model handlers accept `ViewSelection::Table` (§9.2).
- **S4.**
  - Tier C masks the composition key after an `Err`; fixtures named in R2-01, R2-02, R2-03,
    R2-06, R2-22, R2-23, D-25; `read_only_mode_inside_read` moves to the shim;
    `lexical_conformance_wasm` enables `foreign-nodes`.
  - Drop the dependency on an S1 `wire` feature (§11.4: `lexical_model` has no wire
    derives). `CoreHandle::apply` decodes `Input` and encodes `Output` with S7's
    `session.bop` codec (the same as production); `CoreHandle::new` takes `CoreConfig`
    fields as primitives. Test `api_shape::input_output_derive_debug_clone_and_round_trip_postcard`
    becomes a bebop round trip in the S7 crate.
  - `EditorHandle` holds `Editor` plus `Option<PendingUpdate>` (§4.4), not
    `Option<Transaction>`; `begin_update` opens and suspends, `call` resumes and suspends,
    `commit` resumes and commits.
  - JS `registerCommand`/`registerNodeTransform`/`createState` after `createEditor` go
    through `register_foreign_listener`, `register_foreign_transform` and
    `ForeignStateConfig` (§4.4, S4 §2.4 items 5-7).
  - The two `blocked:no-rust-owner` matrix rows get the §14.4 owners.
  - New tests: the type table equals per-instance flags for every live node (the §8.5
    debug check), `BuildError::NoFlagProbe`, the listener table, the `SetViewSelection`
    elision (§15.1 step 4), `take_initial_output`, `export_json` (`children: []`) versus
    `export_node`, `ViewSelection::Table`, `fix_focus_overselection` against upstream's
    `NormalizeTripleClickSelectionExtension` tests, `MergeTracker::classify` without
    `has_current`, `PendingUpdate` staleness.
- **S7.**
  - Owns `session.bop` with `EditorInputMsg`, `ABI_MAJOR`, the mirrored
    `DIFF_FORMAT_VERSION`/`DiffOpcode`, and the compile-time assertion; builds `Input` from
    hot primitives with `text_from_utf16`; may use `MergeTracker` without `History`; records
    `Output::commits` (now including follow-ups) and handles `Effect::PluginEvent` and
    `Effect::FollowUpFailed`.
  - Sets the platform with `EditorBuilder::view_host` (`CoreConfig.platform` is gone);
    `ViewEngine::Native` for the FFI views.
  - Drains `EditorCore::take_initial_output` once after building and projects it before
    the first input (S11 §5.1).
  - `Effect::SetViewSelection { selection, format, style }` in the wire effects; the
    elision is EditorCore's (§15.1), so the session adds no rule of its own.
  - `typeTable()` exports `Registry::type_table()`, `listenerTable()` exports
    `Editor::listener_table()`; `nodesOfType` uses `Read::nodes_of_type_index` +
    `export_json`; `debugShouldPreventDefault` calls
    `Read::should_prevent_default_and_insert_text`.
  - `Paste` inputs carry `ClipboardPayload::html_nodes`; selection inputs may carry
    `ViewSelection::Table` and `SelectionChangeContext::triple_click`.
- **S8.** Builds sim editors with `view_host` instead of `CoreConfig.platform`; drains
  `take_initial_output` before the first step.
- **S11.**
  - §5.1: replace `CommitHook`/`EditorBuilder::commit_hook`/`commit_with_hooks` with
    `Plugin::after_commit`, `Editor::run_after_commit`, `Editor::take_initial_commits` and
    `EditorCore::take_initial_output`; adopt S1's round rules (one shared follow-up per
    round, rounds repeat until a no-op, 99-round guard) in place of "own transaction per
    hook, no recursion".
  - §7.1: `MergeActionGetter` is `MergeTracker` (`new(delay_ms, now)`,
    `classify(commit, now)`); the grouper keeps one.
  - §3.5: per-node fields come from `Read::export_json` (O(1)), minus `children`.
  - §11 summary: the S1 bullet reads as above; Q12 is already closed in S1 §20.
- **S12.**
  - §0.2 rows are satisfied: `Effect::SetViewSelection { format, style }`; `ViewHost` with
    `ViewEngine::Native` added, set on the builder (not `CoreConfig`);
    `ClipboardPayload::html_nodes`; `Registry::type_table()` (per-instance rows carry no
    flags); `Editor::listener_table()`. Restate the rows to these names.
  - §1.5/§1.7: the `SetViewSelection` elision is S1 §15.1's rule; drop the separate
    "omit while composing" rule (the elision covers it).
  - §1.12: table selections are `ViewSelection::Table`.
  - §1.14 normalize-triple-click and trailing-paragraph rows name the §14.4 owners.
  - §2.3: the runtime registration hook it asks S1 for exists (§4.4 since R2); runtime
    listeners, transforms, state configs and `PendingUpdate` back R5-R7.

## R2.1 consistency

Final pass, part A: every requirement S3, S4, S11 and S12 place on `lexical_model` checked
against R2 and folded in. Other specs were read-only; the list above is what part B applies.
New trait shapes were compiled in `target/lexical-upstream-port/probe` (rustc 1.94.0,
`cargo test`, `cargo check --target wasm32-unknown-unknown`): `FLAGS_PER_INSTANCE` +
`flag_probe` with the build-time type table over a scratch state (and the probe-less build
error), `PendingUpdate` suspend/resume with the staleness check, runtime `ForeignListener`
dispatch from inside a transaction, `ViewHost` on the builder and transaction, and `Send + Sync`
for `PendingUpdate` and `Registry`.

| Source | Requirement | R2.1 change |
| --- | --- | --- |
| S3 CR-1..CR-22 | still hold after R2 | Yes in substance. R2-38 moved `Parent`, `as_parent*` and the mutator hooks onto the kind traits, so S3's citations for CR-1, CR-2, CR-5 point at old locations (S3 follows) |
| S3 CR-23 | `Plugin::after_commit` follow-ups | Held (§14.2). S3's "per plugin" wording differs from S1's shared round; S3 restates |
| S3 CR-24..CR-31 | `Invariant` + `invariant!`, `TableSelection: Copy` + `as_table`, `InsertClipboardNodes { nodes, selection }`, `select_all(Option<SelectionSlot>)`, `HAS_LANGUAGE_FIELD`, `character_target`, `_at` setters + `Arc<str>` style, `Send + Sync` extension state | All held by R2 as written (§16, §9.1, §14.1, §9.4, §3.2, §7.6, §14.3); no change |
| S11 §5.1 `CommitHook` | post-commit hook for NodeId/PeerId, initial pass returned to the host | Reconciled into `Plugin::after_commit` (§14.2 "One post-commit mechanism"). Added `Editor::take_initial_commits`, `EditorCore::take_initial_output`; `initial_state` keeps its commits (§4.2, §4.3, §15) |
| S11 §7.1 `MergeActionGetter` | merge classification without stacks | Already `MergeTracker` (F36). `classify` drops `has_current` (only `isSameEditor`, always true) so it is S11's `action(commit, now)` (§12) |
| S11 §3.5 | per-node own fields, O(dirty) | `Read::export_json` (`node.exportJSON()`, `children: []`); §3.4 row 39 corrected (it named the recursive `export_node`) |
| S12 §0.2 `SetViewSelection` | carry format and style | `Effect::SetViewSelection { selection, format, style }` (§15) |
| S12 §0.2 `ViewHost` | OS-aware platform | `ViewHost { engine: ViewEngine, os: ViewOs }` replaces `ViewPlatform`; `ViewEngine::Native` added for the native views (no composition characters); set by `EditorBuilder::view_host`, read by `Editor::view_host`/`Transaction::view_host`, so plugins see it; `CoreConfig.platform` removed (one source); §17 `environment` rows remapped |
| S12 §0.2 `html_nodes` | view HTML import on paste | `ClipboardPayload::html_nodes: Option<Vec<SerializedNode>>` (§14.1) |
| S12 §0.2 type table | per-type flags for EVT-14/15 in JS | `Registry::type_table()`, `TypeTableRow`, `TypeFlags`, `RegisteredNode::flags`; `NodeType::FLAGS_PER_INSTANCE`, `NodeType::flag_probe`, `BuildError::NoFlagProbe`; a debug-build check in §8.5 compares live nodes with their row (§3.2, §4.1, §4.2, §8.5) |
| S12 §0.2 listener table | per-command Rust listener levels | `ListenerTable`, `PriorityLevels`, `Editor::listener_table()` (§14.2, §4.3) |
| S12 §1.5 | no `setBaseAndExtent` when the DOM already matches | `SetViewSelection` elision rule (§15.1 step 4); unobservable, so no divergence row |
| S12 §1.12 | table cell-range selection from the view | `ViewSelection::Table { table, anchor_cell, focus_cell }` (§9.2) |
| S12 §1.14, §0.2 S7 row | session read methods | `Read::nodes_of_type_index`, `Read::export_json`; `typeTable`/`listenerTable` above; `debugShouldPreventDefault` is the existing `Read::should_prevent_default_and_insert_text`; the Q16 reads become debug cross-checks (§15.1) |
| S12 §1.14 normalize-triple-click | triple-click flag on `selectionFromView` | `SelectionChangeContext::triple_click`, `Transaction::selection_change_context`, `Transaction::fix_focus_overselection` (§9.2) |
| S4 §2.8 / S12 §2.4 R5-R7 | JS-driven transactions across calls; JS listeners, transforms and NodeState after build | Feature `foreign-nodes`: `PendingUpdate` (`Transaction::suspend`, `Editor::resume`, `Error::StaleSuspendedUpdate`), `register_foreign_listener`/`unregister_foreign_listener` (refresh the listener table), `register_foreign_transform`, `ForeignStateConfig`/`ForeignStateCodec`, `set_foreign_state`, `Read::foreign_state`, `Error::UnknownForeignState` (§4.4, §5.2, §16) |
| S4 §2.8 `wire` feature | postcard `Input`/`Output` in the conformance crate | Not added: F18 keeps `lexical_model` free of wire derives. S4 uses S7's bebop codec (listed above) |
| S4 matrix `blocked:no-rust-owner` | `ClickAfterLastBlockExtension`, `NormalizeTripleClickSelectionExtension` | Both assigned (§14.4): triple click split model (`lexical_model`) / plugin (S3) / view; click-after-last-block split model (S3 `lexical_rich_nodes`) / view (DOM geometry). Neither is js-by-design |
| Counts | | §16 and §21 updated (`flag_probe`, `FLAGS_PER_INSTANCE`, two feature-gated errors, `NoFlagProbe`) |
