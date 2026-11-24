# email_utils

## What it is

Part of the Email feature: shared email text handling — HTML sanitization,
reply-quote stripping, body parsing, contact name normalization, and
sender/generic-address checks.

## Start here

- `src/sanitizer.rs`: `sanitize_email_html`, `sanitize_authored_html`,
  `sanitize_html_fragment` — every HTML body that reaches
  `body_html_sanitized` must pass through one of these.
- `src/body_replyless.rs` + `src/body_replyless/`: strips quoted reply chains
  from HTML and plaintext bodies; `reply_snippet` is the Outlook snippet that
  ingest and `backfill_outlook_snippets` both derive from them.
- `src/body_parsed.rs`: the parsed-body representation used across callers,
  and `html_to_undecorated_text` for one-line previews (no emphasis marks).

## Scope

- Owns: provider-neutral email text transforms with no I/O.
- Not here: provider API calls → `email_api_client`; DB storage →
  `email_db_client`; domain logic → `crates/email`.

## Boundaries

- Depends on: `ammonia`, `scraper`, `html2text` (no Macro crates).
- Used by: `crates/email`, `crates/email_db_client`, `crates/email_api_client`,
  `crates/graphql_email`, `crates/google_token`, `crates/models_email`,
  `services/calendar_service`, `services/email_service`.

## Recipes

- Add a sanitizer rule: `src/sanitizer.rs` (ammonia allowlist/`Builder`) →
  `src/sanitizer/test.rs`.
- Add a reply-stripping heuristic: `src/body_replyless/html_parser.rs` or
  `plaintext_parser.rs` → `src/body_replyless/test.rs`.

## Checks

- `cargo test -p email_utils`.

## Gotchas

- Enable `scraper`'s `deterministic` feature: thread reads recompute replyless
  HTML, and shuffled attributes rebuild otherwise unchanged email bodies.
- Outlook mobile and Outlook on the web start the quoted thread at `<hr>` plus
  `div#divRplyFwdMsg` (plaintext: a line of underscores, then `From:`). Cut
  there. A later `border-top` "From:" block is a nested quote.
- "On [date] [sender] wrote:" can share an element, or a text node, with the
  reply in some clients. Cut at the text node, never the shared element, and
  never return an empty reply: an empty cut falls through to the next
  splitter. Gmail writes a narrow no-break space before AM/PM.
- Sanitization is security-sensitive (XSS via email HTML): any allowlist
  change needs a test proving the previously-dangerous input is now stripped,
  not just that benign input survives.
- Sanitized HTML is only safe as the sanitizer wrote it. Code that changes it
  afterwards (trimming, rewriting URLs, cutting the quoted thread) must write
  it back with the parser's serializer (`scraper`'s `html()`/`inner_html()`)
  or `lol_html`. Code that assembles it by hand must escape every text node
  and attribute value it writes: they hold decoded text, so `&lt;b&gt;`
  comes back as a tag. Never run a regex or string replacement over the
  result: `scraper` leaves `<` and `>` unescaped inside attribute values. The
  same goes for removing text from a `<style>` element: what is left must not
  be able to form `</style>`.
- HTML-to-text conversion (`body_parsed.rs`) is bounded in memory on every
  axis, because one message that exhausted it ran the email workers out of
  memory. It reads at most `MAX_HTML_BYTES` and renders in raw mode (table
  cells stacked in reading order, never laid out in padded columns) at
  `TEXT_WIDTH`, wider than any line can be, so no text wraps. It first
  parses with `bounded_html::parse_document_for_text` (scripting off, as
  html2text parses, and `MAX_TEXT_NODES`, since html2text takes 1.3 to 1.9 KB
  a node) and refuses a body that clips: html2text parses with html5ever too,
  so a byte cap alone let 13 KB build a million nodes. html2text then
  converts that tree's serialization, never the body: it parses with a newer
  html5ever whose rules differ (inside `<select>`), so a check of the body
  alone could be passed by markup the two read differently. Calendar
  descriptions reach it as received. It also refuses a body whose tables
  exceed `MAX_TABLE_CELLS` (rows times widest row, since html2text copies a
  table's column widths into every row) or whose quotes, lists,
  definitions and headings prefix a line with more than `MAX_INDENT`
  columns (each prefixes every line inside it; an ordered list as wide as
  its largest number). The cell count is exact only because the same walk
  drops every cell's `rowspan` and `colspan`, which raw mode does not need
  but html2text turns into filler cells and columns. Keep all of it when
  changing the conversion; `tests/text_conversion_memory.rs` measures the
  peak.
- Parse email HTML with `bounded_html`, never `Html::parse_document` or
  `parse_fragment` on a body as received. html5ever's memory follows the nodes
  and attributes it builds, not the bytes it reads: it rebuilds every
  still-active formatting element (`<b>`, `<font>`) inside each new
  paragraph, attributes included, so 13 KB once built a million nodes. Most
  tags scan its stack of open elements, and each new formatting element is
  compared with every open one of the same name, so deep nesting costs time
  squared. A byte or tag count bounds none of this. `bounded_html` wraps
  scraper's tree sink, feeds the body a tag at a time and stops at the first
  limit a change would pass: `MAX_HTML_NODES` (attributes count a quarter
  node each, a text node only when it is new), `MAX_HTML_TEXT_BYTES` (text,
  attributes and comments as a serialization writes them, escapes and each
  rebuilt element's attributes included),
  `MAX_ELEMENT_ATTRIBUTES`, `MAX_FORMATTING_DEPTH` (at most three copies of
  an identical tag count, as html5ever keeps no more) and `MAX_HTML_DEPTH`,
  reporting `clipped`. Each limit has a case in
  `tests/text_conversion_memory.rs`. `sanitize_email_html` then cleans what
  was parsed and ends it with `CLIPPED_NOTICE` (English only), since the
  reader shows only sanitized HTML and the `.eml` download keeps the whole
  message. Ammonia parses that serialization again: the byte limit bounds
  its size, and the formatting limit its comparisons. `extract_reply_html`
  keeps a clipped body whole, as it does one with no reply separator. Code
  that parses a body as received again (rather than the sanitized HTML) goes
  through `bounded_html` too, in other crates as well: `parse_document`,
  `parse_fragment` and `BoundedHtml` are public, and `email_api_client`'s
  Outlook calendar `conference_body::split` refuses a clipped event body
  rather than write it back cut short. Work on the bounded tree, never a
  second parse of the raw body: another parser or scripting mode
  (`<noscript>`) can build a different tree. html5ever also checks each
  attribute name in a tag against every earlier one before anything reaches
  the tree; a tag with 150,000 attributes takes about 20 s, which is
  accepted.
- Walk a parsed message with a loop, not recursion: nesting depth is the
  sender's choice, and a deep enough message overflows the stack. Reply
  stripping still recurses once per level (`get_previous_html_recursively`),
  so its own depth check must run before it: moving a node (misnested
  formatting) can nest it deeper than the parse inserted it.
- `bounded_html`'s sink moves children itself in `reparent_children`.
  Scraper's own implementation uses ego-tree's `reparent_from_id_append`,
  which (in ego-tree 0.6.3) gives only the first and last moved child its new
  parent, so a later move of any other one dropped it from the tree: plain
  `Html::parse_document` loses `lost` in `<b><div>a<p><div>lost</b>`. Keep
  the override until ego-tree fixes it.

## Related

- Rules: `.agents/rules/rust/security.md`
