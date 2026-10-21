# utoipa-swagger-ui 9.0.2, patched

Upstream's build script writes `#[folder = "<absolute OUT_DIR>/…"]` into the
code it generates. rustc keeps that attribute literal in the crate's metadata,
and `--remap-path-prefix` does not rewrite string literals, so the compiled
crate differed in every checkout. Every service above it, and their test
binaries, then had a different kache key on each machine and in CI.

The only change: the build script writes `$OUT_DIR/…` and rust-embed's
`interpolate-folder-path` expands it at compile time. Drop this copy once
upstream emits a relative or interpolated folder.
