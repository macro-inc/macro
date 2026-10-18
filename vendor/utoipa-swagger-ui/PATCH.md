# ZIP security compatibility patch

This is the crates.io `utoipa-swagger-ui` 9.0.2 source with two compatibility
changes: its normalized manifest updates ZIP 3.0 → 9.0.5 and effective minimum
Rust 1.75 → 1.88; the build script uses `ZipFile::is_dir()` instead of checking
`name()` for a trailing slash, because ZIP 9 makes name decoding fallible.
`Cargo.toml.orig` records the unmodified upstream manifest. Library source and
public APIs are unchanged. Two trailing spaces in the upstream README are removed.

- Source: https://crates.io/crates/utoipa-swagger-ui/9.0.2
- Archive SHA-256: `d047458f1b5b65237c2f6dc6db136945667f40a7668627b3490b9513a3d43a55`
- Upstream revision: `85952757ee50632be4b84e6580f16530397808d1`
- Security fixes: ZIP >=9 addresses RUSTSEC-2026-0367, 0368 and 0369.
- Both upstream license files are preserved.

The workspace still uses Utoipa 5. The latest published Swagger UI 10.0.1
requires Utoipa 6 and still depends on vulnerable ZIP 8.6, so upgrading that
parent does not solve the current advisory without a wider API migration.
This patch keeps the current public API while resolving ZIP to patched 9.0.5.

Remove the patch when a compatible upstream release uses a patched ZIP.
The Nix pruned-source builder includes `vendor/` so deploys use the same patch.
Validate with `cargo test --lib --manifest-path vendor/utoipa-swagger-ui/Cargo.toml --features axum,vendored,tokio/rt-multi-thread`, the
upload extraction regressions, `cargo x deps --check`, and `cargo deny check`.
