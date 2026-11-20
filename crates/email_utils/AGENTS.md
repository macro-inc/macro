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
  `TEXT_WIDTH`, wider than any line can be, so no text wraps. It refuses a
  body whose tables exceed `MAX_TABLE_CELLS` (rows times widest row, since
  html2text copies a table's column widths into every row) or whose quotes,
  lists, definitions and headings prefix a line with more than `MAX_INDENT`
  columns (each prefixes every line inside it; an ordered list as wide as
  its largest number). The cell count is exact only because the same walk
  drops every cell's `rowspan` and `colspan`, which raw mode does not need
  but html2text turns into filler cells and columns. Keep all of it when
  changing the conversion; `tests/text_conversion_memory.rs` measures the
  peak.
- Walk a parsed message with a loop, not recursion: nesting depth is the
  sender's choice, and a deep enough message overflows the stack.

## Related

- Rules: `.agents/rules/rust/security.md`
