# Android release tasks

Created in Macro from `docs/ANDROID_READINESS_AUDIT.md` on September 21, 2026 (source snapshot `1c26a7c4fe`).

All six tasks verified: **Priority: High · Assignee: Peter (peter@macro.com) · Personal tag: android · Status: Not Started**. No due dates set.

1. [Make the Android app build, authenticate, and open app links](https://macro.com/app/task/01a0c5bb-52fd-7c0d-b6c1-488945ec7dba)
2. [Deliver Android push notifications end to end](https://macro.com/app/task/01a0c5bb-b55b-701e-b160-0e9fe90374d5)
3. [Complete Android input, navigation, attachments, and sharing](https://macro.com/app/task/01a0c5bb-b65f-7115-b6c6-5ae1685cb749)
4. [Implement native Android voice and video calling](https://macro.com/app/task/01a0c5bb-b746-75f4-840f-32aea38f59ed)
5. [Make Android offline recovery and OTA updates reliable](https://macro.com/app/task/01a0c5bb-b846-7235-af24-2002ddaa6e85)
6. [Qualify and release the Android app on Google Play](https://macro.com/app/task/01a0c5bb-ba45-7ac5-96c0-f6298a298d47)

## 1. Make the Android app build, authenticate, and open app links

Deliver a reproducible Android app that launches, signs users in, connects their accounts, and opens Macro links correctly.

Scope:
- Add Android shared-library output and separate shared/iOS/Android plugin capabilities. Repair or replace the pinned auth plugin's missing Android implementation and the keyboard plugin's invalid Android scaffold.
- Provide repeatable Android development/release commands, environment setup, and Firebase configuration injection. Preserve iOS behavior.
- Implement Android browser/Custom Tabs authentication, callback correlation/cancellation, and one-time session-code redemption for supported SSO providers, Gmail/calendar consent, GitHub linking, and reauthentication.
- Preserve intended destination, onboarding state, and account isolation through callback, relaunch, logout, and account switching. Verify email-code login too.
- Reconcile HTTP/HTTPS WebView origins across navigation, protocol handling, cookies, browser storage, assets/workers, and relevant CORS rules.
- Replace the `com.tauri.dev` association entry with the correct package and signing certificates; verify cold/warm App Links on intended production/dev hosts.

Acceptance: a clean checkout produces an installable debug APK and release AAB; users can sign in, cancel/retry, connect accounts, relaunch authenticated, switch accounts, and follow entity links through an authentication detour. A signed release launches without missing-plugin errors. Coordinate final signing/distribution with task 6.

Starting points: `apps/web/tauri/src-tauri/{Cargo.toml,capabilities/mobile.json,tauri.conf.json,src/lib.rs,.well-known/assetlinks.json}`, `apps/web/src/features/auth/useSsoLogin.ts`, `apps/web/src/lib/core/email-link/index.ts`, and audit items 1, 2, 6.

## 2. Deliver Android push notifications end to end

Make real backend notifications reach Android, display once, open the correct entity, and stay consistent across devices/accounts.

Scope:
- Add Android payload construction, queue/worker delivery, and read/dismiss clearing. Notification ingress currently drops Android endpoints; the Android payload model is a placeholder.
- Implement the Android receive/tap/token-refresh bridge, including cold-start buffering and a real notification watcher. Normalize the plugin's permission response to the frontend contract.
- Configure notification channels/icons, pre/post Android 13 permission handling, foreground behavior, and deduplication with websocket/local notifications.
- Verify dev/prod Firebase/SNS alignment, token rotation, invalid-token cleanup, logout/unregistration, and account rebinding.
- Preserve notification IDs, user preferences, grouping, retry behavior, and permissions. Include correct SNS/FCM payload serialization and worker coverage.

Acceptance: channel/mention/email and other enabled notification types arrive from real backend events in foreground, background, and normal process-dead states; taps route correctly; denial/revocation, rotation, read/dismiss synchronization, and account switching work. Test Doze/OEM battery behavior separately from user force-stop.

Starting points: `crates/notification/src/domain/{service/ingress.rs,models/queue_message.rs,models/android.rs}`, `infra/stacks/notification-service/index.ts`, `apps/web/src/lib/tauri/PushNotification.tsx`, the pinned notifications plugin, and audit items 3–4. Depends on task 1's working app/authentication.

## 3. Complete Android input, navigation, attachments, and sharing

Make everyday composing and file workflows behave correctly on Android across messaging, email, documents, comments, and AI.

Scope:
- Implement native IME/window-inset events; prevent double keyboard-height subtraction; update safe areas on rotation, window resizing, and navigation-mode changes.
- Validate focus, caret visibility, selection, clipboard menus, toolbar/sheet positioning, and iOS-specific cursor-scroll behavior currently applied to all native mobile platforms.
- Integrate system/predictive Back with keyboard, overlays, nested navigation, and unsent drafts; register Android haptics and handle unsupported cases.
- Implement inbound SEND/SEND_MULTIPLE sharing for text, URLs, images, and files, with safe `content://` staging, multiple attachments, cleanup, cold starts, and authentication detours.
- Verify existing WebView file-input fallbacks before adding Photo Picker/Storage Access Framework adapters. Complete clipboard-image handling, authenticated/Blob downloads, save/export/open, and outgoing sharing where needed.
- Test Gboard/Samsung Keyboard, composition/non-Latin input, emoji/dictation, large files/cloud providers, TalkBack, large text, and supported tablet/foldable layouts. Remove TV advertising unless intentionally supported.

Acceptance: every supported composer remains usable through keyboard and orientation changes; Back preserves drafts; users can attach, paste, export, and share files in both directions without duplicate shares, missing files, or stale staging data.

Starting points: `apps/web/src/components/app/useAppSquishHandlers.ts`, `apps/web/src/lib/tauri/{TauriProvider.tsx,ShareTargetProvider.tsx}`, `apps/web/src/lib/core/mobile/`, `apps/web/src/lib/filesystem/download.ts`, `apps/web/tauri/src-tauri/src/share_target.rs`, and audit items 5, 8–10. Depends on task 1's app shell.

## 4. Implement native Android voice and video calling

Bring Android calls to iPhone parity, including incoming calls while backgrounded or locked and a reliable native media lifecycle.

Scope:
- Implement Android Telecom/Core-Telecom integration, call-state coordination, incoming-call FCM delivery, and ongoing-call foreground support.
- Support answer/decline/end actions and an Android media session integrated with the existing shared call state and backend.
- Cover microphone/camera permissions, audio focus, speaker/Bluetooth/headset routing, interruptions, camera switching, background audio, video, and picture-in-picture.
- Handle stale/cancelled rings, calls answered on another device, network reconnects, navigation, and resume without duplicate sessions.
- Extend backend call notification targeting beyond iOS VoIP endpoints. Reuse browser LiveKit code where appropriate without assuming it provides background-call behavior.

Acceptance: incoming/outgoing calls work with the app open, backgrounded, and the phone locked; audio routing, remote cancellation, reconnects, and supported video/PiP flows work on Pixel and Samsung hardware.

Starting points: `apps/web/src/features/channel/Call/`, `apps/web/tauri/callkit_plugin/` as the iOS parity reference, `crates/notification/src/domain/service/voip.rs`, and audit item 7. Coordinate with task 2 for FCM and task 1 for the app shell.

## 5. Make Android offline recovery and OTA updates reliable

Preserve work and account isolation through Android lifecycle events and safely deliver shared frontend updates to both mobile platforms.

Scope:
- Validate native cache persistence, queued/optimistic mutations, cached reads, drafts, pending uploads, session refresh, websocket resubscription, and missed-event replay after backgrounding and OS process death.
- Exercise airplane mode and Wi-Fi/cellular transitions; add native ConnectivityManager reachability if browser signals are insufficient.
- Review backup/restore exclusions for credentials and account-specific data; verify logout/account-switch cleanup.
- Define compatible native build numbering or platform-specific minimum/capability metadata for OTA. Prevent new shared JS bundles from invoking unavailable Android native features.
- Test native build detection, interrupted download/extraction, cache eviction, incompatible/revoked updates, embedded fallback, and update application on resume. Provide a working Play Store update destination.
- Measure launch/cache hydration, large documents/lists, memory pressure, and battery behavior on lower-end hardware.

Acceptance: acknowledged work survives lifecycle/network changes without duplication or cross-account leakage; an older installed Android release remains functional when a newer iOS/shared-JS release ships; failed or rejected updates recover cleanly.

Starting points: `apps/web/src/lib/core/mobile/native-network-status.ts`, `apps/web/src/lib/queries/client.ts`, `apps/web/tauri/{graphql_cache_plugin,macro_bundle_updater_plugin}`, `crates/native_app_service/src/domain/service.rs`, and audit items 11–12. Depends on task 1 and coordinates with tasks 2–4 for lifecycle testing.

## 6. Qualify and release the Android app on Google Play

Establish repeatable Play distribution and demonstrate full Android release readiness on actual devices.

Scope:
- Set up/verify Play application ownership, App Signing/upload-key handling, monotonic version codes, CI release AAB builds, minification/R8 behavior, symbols/source maps, and crash/ANR monitoring.
- Verify target API requirements and 16 KB page-size compatibility for all native libraries; update/configure the NDK/toolchain as needed.
- Choose and implement the Android billing approach: Play Billing, an applicable enrolled alternative program, or appropriate consumption-only purchase UI. Include backend entitlement/restore/refund handling if Play Billing is chosen.
- Finalize launcher/adaptive/monochrome icons, splash screen, listing/screenshots, support/store links, reviewer access, privacy/Data safety declarations, and both in-app and external account-deletion paths.
- Add Android-native smoke automation for launch, authentication, core product navigation, push/link routing, composition, attachments, and lifecycle recovery.
- Run the audit's device/build/lifecycle matrix: Pixel and Samsung, lower-memory device, minimum supported OS, Android 13/35/36, 16 KB devices/emulators, and tablet/foldable layouts if supported. Exercise debug, minified release, and Play-installed builds through clean install and upgrade.
- Record results and remaining defects; use internal testing, staged rollout, monitoring, and rollback procedures for launch.

Acceptance: the signed Play-installed app passes the agreed feature/device matrix; billing/privacy requirements are satisfied for intended markets; release builds are reproducible; monitoring and rollback are ready. Complete tasks 1–5 before declaring feature parity.

Starting points: `apps/web/tauri/src-tauri/gen/android/`, `nix/tauri-dev-shells.nix`, `.github/workflows/`, `apps/web/src/features/{settings,paywall}/`, `apps/web/tests/native/`, and audit item 13 plus its release test matrix.
