# computer_id

## What it is

Shared computer UUID identity, independent of the runtime and harness domains.

## Start here

- `src/lib.rs`: serde-transparent `ComputerId`, parsing and optional SQLx/schema traits.

## Scope

- Owns: computer identity only.
- Not here: registration or lifecycle policy.

## Boundaries

- Depends on: serde, uuid, thiserror; optional sqlx and utoipa.
- Used by: runtime and harness consumers, which take this type without a domain dependency.

## Checks

- `cargo test -p computer_id --all-features`
