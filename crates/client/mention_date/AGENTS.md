# Mention date labels

## What it is

Portable ISO date labeling shared by mention_utils and Macro editor imports.

## Boundaries

- Label the calendar fields as written, without converting the timestamp zone.
- Keep this client crate free of workspace-hack and host clock access.
- Reuse this function instead of duplicating the calendar validation.
- Parse with the byte cursor, not a regex crate: `regex` costs about 160 KB brotli in the document session WASM.

## Checks

- `cargo test -p macro_document_model -j4` exercises imported date mentions.
- `cargo check -p mention_date --target wasm32-unknown-unknown -j4`
- `cargo x deps --check`, `cargo shear`, `just check`
