# Lexical markdown

Portable Lexical v0.45.0 import/export engine. Call conversion inside a model
transaction for import, or pass a committed/pending read view for export.
`Transformers` preserves each category's registration order. Block exports start
fresh format stacks; inline match exports share stacks and protect outer tags.
`MarkdownOptions` defaults to upstream list indentation 4. Macro callers pass
`list_indent: 2`; zero is rejected before modifying the document.

`matcher` re-exports the shared rich-node Match/Matcher/RegexMatcher API. Global
scans keep UTF-16 positions and original-input anchors. Parsing uses upstream
regexes plus the specified JavaScript whitespace, delimiter and escape scans.
No browser, I/O, runtime, tokenizer or application policy is included.

Literal tests port conversion, normalization, hard-break, nested delimiter,
selection slicing and custom-callback assertions from upstream model tests.
The supplementary fixed corpus runs all 18 live expression statics against Node
and the delimiter selector against the unmodified upstream TypeScript function.
`build.rs` inventories source statics so an added expression cannot silently
escape that comparison. Known lone-surrogate input/capture cases retain explicit
S3 R-5 ledger entries; captures decode to U+FFFD at the Rust string boundary.

Regenerate with Node 24 and the pinned upstream source checkout:

```sh
node crates/client/lexical/lexical_markdown/tests/record-regex.mjs /path/to/lexical
```

The corpus includes every markdown-string argument in the recorded Tier A
markdown fixtures plus the S4 case-folding, Unicode and punctuation probes.
Future Macro-specific transformer statics belong to their owning package's
inventory. Lexical code is MIT licensed; see LICENSE-LEXICAL.

The source governs a callback ambiguity: text-match replace returning no text
still permits recursion into surrounding split nodes and final unescaping.
Only an absent replacement callback prevents matching. A multiline hook returning
`imported: false` ignores its returned line index and falls through to the current
block. These distinctions follow upstream's actual result-object/control flow.

See AGENTS.md for commands and boundaries.

The standard transformer group includes headings, quotes, ordered/unordered lists,
fenced code, links and the nine upstream inline formats. Checklist is opt-in.
Code blocks preserve their fence state, grow colliding fences and export code
highlight children as raw text. Selection export uses the shared rich-node slice
helper, including token/segmented-text behavior. Inline format declarations use
`TextFormatType`, keeping ordered single-format toggles distinct from bitmasks.
Ordered-list starts outside the model's `i32` range return a typed error.

The oracle records 1,134 comparisons over 63 UTF-8 inputs, 63 upstream delimiter
selections and 36 actual V8-only lone-surrogate input runs. The latter and two
split-surrogate captures are explicitly ledgered under R-5.

## Shortcuts

Build the transformer registry once and call `check_dependencies` when attaching
it. The host passes `ShortcutTrigger::from_commit(&commit, is_composing)` after
an insertion. `markdown_shortcut_anchor` is a cheap precheck on the committed
state. Open a follow-up transaction only for an eligible anchor, call
`markdown_shortcuts`, and commit with `UpdateTag::HistoryPush` only on `Ok(true)`.
Drop a false result uncommitted: a declined callback may have split pending text.
No listener schedules nested updates, so idle shortcut passes cannot accumulate
a cascade counter. A literal 1,000-keystroke test pins that behavior.

`markdown_shortcuts_on_enter` returns whether the low-priority Enter handler
consumed the input. The host prevents the default action on true. Shift+Enter,
code parents and multiline transformers requiring a terminator are skipped.
The insertion and Enter passes emit debug tracing spans without recording text.
Trigger facts borrow the model's `TagSet` and public `DirtyLeaves` collection,
so `from_commit` does not allocate replacement sets.

## Upstream conversion table

`tests/conversions.rs` checks the original 111-row upstream data matrix as exact
markdown-import JSON, HTML-import JSON to markdown export, and absent-selection
assertions. Node 24 runs pinned Lexical 0.45.0 and the custom callbacks extracted
from the original test source; it first verifies the original HTML and markdown
assertions. Expected JSON is never derived from Rust. The source checksum and
all row flags are retained. The pinned file expands to 109 imports, 109 selection
checks and 85 exports: 303 executions, superseding the spec's stale 301 count.
No rows or duplicate cases are discarded. Pipe-table expressions only keep
normalization from joining rows; upstream has no standard TABLE transformer.

Regenerate with independently installed, exact 0.45.0 lexical, headless,
markdown, rich-text, list, link, code/code-core and html packages plus jsdom
29.1.1 in an oracle directory:

```sh
node crates/client/lexical/lexical_markdown/tests/record-conversions.mjs /path/to/lexical /path/to/oracle
cargo test -p lexical_markdown --test conversions -j4
```
