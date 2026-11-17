# bundle_identity

## What it is

Native app OTA updates. The identity of a JavaScript bundle (`BundleBuild`),
derived from the commit it was built from, and the `bundle-manifest.json` wire
type. The update server, the native updater plugin, the native build script and
the `bundle-stamp` tool all read and write manifests through it.

## How it works

`BundleBuild = commit_time_secs * 1000`, from `SourceCommit::bundle_build` only.
An app's embedded bundle and the OTA bundle of the same commit therefore compare
equal, and an older commit's bundle never outranks a newer one however late it
was built. `BuiltAt` (build time) tells rebuilds apart and never orders updates.

## Scope

- Owns: the encoding, the manifest wire format and its validation.
- Not here: writing manifests into a build → `tooling/bundle_stamp`; update
  decisions → `crates/native_app_service`, `apps/web/tauri/macro_bundle_updater_plugin`.

## Boundaries

- Used by: `native_app_service`, `bundle_stamp`, and (by path, from the Tauri
  workspace) `macro_bundle_updater_plugin` and `src-tauri/build.rs`.

## Checks

- `cargo test -p bundle_identity`
- Tauri side: `nix develop .#tauri-linux --command cargo test --manifest-path apps/web/tauri/Cargo.toml -p macro_bundle_updater_plugin`

## Gotchas

- Changing the encoding or the manifest wire format needs a native release:
  apps in the field compare their numbers with the server's. This crate is
  outside the iOS/Android native-gate hash, so the golden and deployed-reader
  tests in `src/test.rs` are what guard it.
- No `workspace-hack` dependency and only dependencies already in both Tauri
  lockfiles (`.config/hakari.toml` excludes it).
