# Loro internal 1.16.2

The pristine import copied the retained source, build and test files under
loro-internal byte-for-byte from the crates.io archive
with SHA-256 8d5806b65ee68c3ae7891959dd968898860dab74fbf6498b312de9b548dce5ec.
Exact omitted paths, lengths and upstream hashes are listed in
loro-internal-provenance.json. The upstream benchmark payload and non-Rust helper
inputs and nonessential encoding documentation are omitted; they are not required by the library/integration tests.
The benchmark targets require the omitted upstream data and are not supported.
The workspace patch changes its source location only; versions and normal/build
dependencies remain pinned by the workspace lock. Preserve the retained upstream bytes
in the pristine import commit so subsequent patches are independently reviewable.
No operation-storage writer feature or format is enabled by this patch.

The subsequent local patches skip repeated final leaf cursor assignments in
`src/container/richtext/tracker.rs` and remove an unused `HasIdSpan` import from
`src/encoding.rs` so workspace builds pass with warnings denied. The provenance
file records the pristine import hashes, rather than these patched postimages.

Validate normal/build dependency closure against the original lock, then run
the consuming sync-service tests and the crate library/integration tests.
The published examples have an unresolved bench_utils dependency, so use
--lib --tests for standalone tests. Keep any locally adjusted test manifest
separate from production source and bind it to exact source/dependency hashes.
