# iOS file exports

## What it is

The shared file download controls use this optional iOS bridge to open UIKit's
save picker or share sheet after loading authenticated file bytes.

## Boundaries

- Owns bounded temporary-file staging and native chooser lifecycle; receives
  bytes already authorized by existing web service clients, never arbitrary paths.
- `src/lib.rs` registers the Swift package; `build.rs` generates IPC permissions.
- `ios/Sources/FileExportPlugin.swift` owns the serial staging queue and the
  main-thread picker. All completion/cancellation paths settle once.
- `src/lib/core/mobile/nativeFileExport.ts` (relative to `apps/web`) sends
  256 KiB chunks, checks cancellation, and discards staging in `finally`.

## Checks

- From the repo root: `nix develop .#tauri-linux --command cargo test
  --manifest-path apps/web/tauri/Cargo.toml -p tauri-plugin-file-export`.
- The host check covers Rust registration only. Build the iOS app on macOS and
  exercise save, share, cancellation, background/foreground, and iPad popovers.
- Run the `iosFiles.test.ts` and `createFileDownload.test.ts` suites in `apps/web`.

## Gotchas

- `available` is an optional capability probe; older installed binaries reject
  it and retain Web Share. Do not remove that compatibility before raising the
  native build floor through the iOS release workflow.
- Native exports cap each file at 500 MB and four staged transfers, matching
  Android's bounded transfer design. Successful shared files survive 24 hours
  for asynchronous recipients; other completed/cancelled staging is removed.
  Incomplete transfers expire after five idle minutes on the next export, so
  WebContent reloads cannot permanently exhaust the staging slots.
- Native changes need an App Store binary to reach devices. This additive bridge
  leaves the existing native/web contract working, so the PR can use
  `skip-ios-update`; shipping the picker still requires a later authorized release.
