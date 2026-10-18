# Vendored Swagger UI

This is third-party upstream source with a temporary ZIP compatibility/security
patch. Read `PATCH.md` before changing it. Preserve upstream source, both
licenses, and the recorded archive checksum; do not apply repository-wide
formatting or structural refactors to this copy.

The crate is excluded from workspace membership and patched at the root.
Standalone tests leave an ignored `Cargo.lock`; the workspace `Cargo.lock`
pins production dependencies.
Keep `vendor/` in the Nix pruned-source inputs. Remove the patch when a Utoipa-5
compatible upstream release has patched ZIP support.

## Checks

- `cargo test --lib --manifest-path vendor/utoipa-swagger-ui/Cargo.toml --features axum,vendored,tokio/rt-multi-thread`
- `cargo x deps --check`
- `cargo deny check`
