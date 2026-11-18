# shown_text

## What it is

Checks for text an AI session writes for a person to read after reading
untrusted data such as their mail: one plain line, and no email address, phone
number or street address. Used by routine suggestions and suggestions.

## Checks

- `cargo test -p shown_text`

## Gotchas

- Tests build synthetic addresses and numbers with `format!`, so the PII
  scanner doesn't flag them.
