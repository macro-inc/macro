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

See AGENTS.md for commands and boundaries. Shortcuts registration belongs to
WP-23; the engine exposes the callback contracts it will consume.

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
