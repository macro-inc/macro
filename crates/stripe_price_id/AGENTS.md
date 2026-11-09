# stripe_price_id

## What it is

The shared validated Stripe price identifier for billing domain contracts.

## Scope

- Owns: the `^price_[A-Za-z0-9_]{1,64}$` shape invariant, string conversion, optional serde and schema support.
- Not here: Stripe API calls, price lookup, or subscription policy.

## Boundaries

- Serde is enabled by default; `schema` enables utoipa string schemas and `sqlx` enables validated PostgreSQL text encoding/decoding.
- Use transparent serialization and constructor-based deserialization; serde rejects combining `transparent` with its `try_from` container attribute.
- Meant for billing domains that configure prices or change subscription items by price.
- Reject identifiers without a 1–64 character ASCII alphanumeric or underscore suffix after `price_`.

## Checks

- `cargo test -p stripe_price_id --all-features`
- `cargo check -p stripe_price_id --no-default-features`
- Run `cargo x deps` after changing Cargo dependencies.
