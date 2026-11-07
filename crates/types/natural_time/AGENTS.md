# natural_time

## What it is

Reads English date and time phrases ("next friday at 3", "end of month",
"nov 5-7", "in 2 hours") into calendar dates for task due dates, reminders and
calendar events, without a model. The reading rules are the crate docs in
`src/lib.rs`; they are the spec.

## How it works

`grammar::normalize` lowercases and strips punctuation, `grammar::items` splits
the phrase into order-free items (a day, a span, a clock, a range separator),
`Phrase::from_items` combines them into the sides of a range, and `resolve`
places that on the calendar at the caller's local wall time, taking the part a
`Pick` names: the start, the end, or the span.

## Start here

- `src/lib.rs`: the public API and the reading rules.
- `src/test.rs`: the phrase tables; every rule has cases here.

## Scope

- Owns: parsing date phrases and which date each one means for a `Pick`.
- Not here: time zones and instants (callers convert the local wall time),
  finding a date phrase inside longer text (the extraction model picks it).

## Boundaries

- Depends on: `chrono`, `nom`, `strsim` (typo distance) and `thiserror` only.
- Used by: nothing yet; built for `crates/ai/universal_input` extraction and the
  web app's date fields (through wasm).

## Recipes

- Add a word or abbreviation: `src/words.rs`, plus a case in `src/test.rs`.
- Add a phrase shape: an item parser in `src/grammar.rs` (order matters: put
  longer readings first in `element`), then a table case.
- Change a rule: update the list in `src/lib.rs` and the affected table cases.

## Checks

- `cargo test -p natural_time`
- `cargo build -p natural_time --target wasm32-unknown-unknown`

## Gotchas

- Never read the clock inside the crate; `read` takes `now`, so tests stay
  fixed and the browser can pass its own wall time.
- It must stay wasm-safe: it is excluded from `workspace-hack` in
  `.config/hakari.toml`, so don't add dependencies that don't build for
  `wasm32-unknown-unknown`.
- `in 2 hours` is `Moment::After` (elapsed), not a wall time, so callers add it
  to the current instant and stay right across daylight saving changes.
