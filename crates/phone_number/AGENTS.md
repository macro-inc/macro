# phone_number

## What it is

Shared by Calls and CRM: one validated type for telephone numbers in E.164
form, so a number typed by a person and one sent by a provider compare equal.

## Scope

- Owns: parsing and normalizing numbers written with their country code.
- Not here: storing numbers → the owning domain (`crates/crm`, `crates/call`).

## Boundaries

- Depends on: `serde` only.
- Used by: `crm` (contact phones), `call` (readable guest numbers).

## Checks

- `cargo test -p phone_number`

## Gotchas

- National numbers without a country code are rejected, never guessed from a
  region: the same digits are different people in different countries.
