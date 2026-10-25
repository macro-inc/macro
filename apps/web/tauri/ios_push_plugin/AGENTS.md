# iOS push notifications

## What it is

The local iOS replacement for `macro-inc/tauri-plugins`' notifications crate.
It preserves the `notifications` command namespace and APNs registration API,
and owns durable notification-tap delivery across cold launches/WebView reloads.

## Start here

- `ios/Sources/NotificationsPlugin.swift`: APNs delegate, JS bridge, native cover.
- `store/Sources/PendingPushStore/PendingPushStore.swift`: atomic pending intent,
  expiration, duplicate suppression, account changes, and matching acknowledgment.
- `src/ios.rs`: Tauri command arguments; the frontend bridge is
  `../../src/lib/tauri/notification-launch.ts`.

## Boundaries

- Persist only notification ID, recipient ID and navigation metadata; never notification bodies.
- Keep store access and UI operations on the main thread. Sending to a Tauri
  channel does not acknowledge delivery; only a matching frontend ack consumes it.
- Keep only the latest tap; old callbacks and acknowledgments cannot replace or
  clear it. Expire unacknowledged intents after 24 hours.
- Let the authenticated frontend validate the payload recipient and access.
  `configure_recipient` clears stale intents on logout/account changes.
- A neutral view covers the WebView while inactive and during notification
  navigation. Auth/error screens use `release_notification_cover` without
  consuming the intent. A hidden bootstrap must never wait for foregrounding.
  Failed tap delivery releases the cover only after frontend bootstrap; keep
  the intent available for a replacement listener.
- Gate new frontend commands on `__MACRO_IOS_NOTIFICATION_LAUNCH__`; older native
  binaries retain the existing push behavior when receiving an OTA web bundle.
  Pass `launchAware: true` when watching. Older web bundles omit that flag and
  retain legacy delivery without a native cover or required acknowledgment.

## Checks

- `swift test --package-path apps/web/tauri/ios_push_plugin/store` (Foundation only).
- `nix develop .#tauri-linux --command cargo check --manifest-path apps/web/tauri/Cargo.toml -p tauri-plugin-notifications` validates host plugin registration/build metadata.
- A full iOS simulator build validates the Swift/UIKit bridge and iOS Rust
  commands; exercise warm resume, terminated launch, WebContent eviction, rapid
  successive taps, offline/auth failures, and ordinary icon resume on a device.

## Related

- [iOS release guide](../../docs/ios-releases.md): native builds and OTA compatibility.
