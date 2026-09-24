# Android readiness audit

Audited September 21, 2026, at commit `1c26a7c4fe`.

**Assessment: Android has a useful foundation, but it is not currently ready for a functional release.** The largest workstreams are native authentication, end-to-end push notifications, keyboard/input behavior, and calling. There are also source-level build blockers. A successful APK build alone would leave important product features unavailable.

Scope: parity with the current iPhone app, including sign-in/onboarding, messaging, email, documents, AI, attachments, notifications, calls, sharing, and updates. This is a source/configuration audit, including the exact cached dependency revisions and current Android/Play documentation. No Android build or device test was performed: `adb` was unavailable, the conventional local SDK directory was absent, and the repository's Android Nix shell is x86_64 Linux-only. Production Firebase, signing, Play Console, and deployed association files were not verified. Public association URLs could not be fetched through the web tool. Distinguish **confirmed gaps** below from **validation work**, which may not require new implementations.

## What can be reused

- The checked-in Android Gradle project already uses `com.macro.app.prod`, SDK/target 36, minimum SDK 24, Firebase Messaging, and custom-scheme/HTTP App Link intent filters. See [Android Gradle configuration](../apps/web/tauri/src-tauri/gen/android/app/build.gradle.kts) and [manifest](../apps/web/tauri/src-tauri/gen/android/app/src/main/AndroidManifest.xml).
- The shared Solid frontend recognizes Android, has mobile layouts, and already routes native HTTP/WebSocket traffic through Tauri. There is Android safe-area initialization.
- Native GraphQL caching and the bundle updater have cross-platform Rust implementations; the updater already reads Android's native build number.
- Device registration, Android device models, an SNS FCM transport, and dev/prod FCM infrastructure exist. **Delivery is incomplete**, as detailed below.
- Linux Android tooling and mobile browser spreadsheet tests exist. Neither constitutes an Android native release test suite.

Priorities: **P0** blocks a usable initial release; **P1** is required for full iPhone feature parity or a reliable production release. Size indicates relative scope, not a delivery estimate.

## Required work

### 1. Repair the Android build and plugin dependency graph — P0, medium

**Confirmed:** [app Cargo.toml](../apps/web/tauri/src-tauri/Cargo.toml) declares only `rlib` and `staticlib`; Android needs the shared library output (`cdylib`). The shared [mobile capability](../apps/web/tauri/src-tauri/capabilities/mobile.json) applies to Android but references edit-menu, pasteboard, photo-library, network-status, and call-kit permissions whose dependencies are restricted to iOS. The pinned Tauri build code validates these permissions against available plugin manifests.

More seriously, the pinned auth dependency (`macro-inc/tauri-plugins`, revision `6ddd6600e20436388f169e936b610fe93944b7b0`) has no Android implementation. Its [src/mobile.rs](https://github.com/macro-inc/tauri-plugins/blob/6ddd6600e20436388f169e936b610fe93944b7b0/packages/tauri-plugin-auth/src/mobile.rs) declares `handle` only under `cfg(target_os = "ios")`, then unconditionally constructs `Auth(handle)`. Its build script also references a nonexistent Android directory. This is a source-level Android build blocker, not just an unused feature.

The pinned virtual-keyboard dependency (`70e8e8325b5ff7d681ef5f3b996ac083d4fc5a01`) has an [Android example implementation](https://github.com/voxelbee/tauri-plugin-virtual-keyboard/blob/70e8e8325b5ff7d681ef5f3b996ac083d4fc5a01/android/src/main/java/ExamplePlugin.kt) whose Kotlin package is literally `com.plugin.virtual-keyboard`, with an invalid unescaped hyphen. It must be fixed/replaced; see item 5 for the missing behavior.

**Do:** add the required library output; separate shared and platform-specific capabilities; implement or replace incompatible plugins; build the actual pinned Tauri/Tao/HTTP/WebSocket/cache dependency graph. Provide repeatable Android prepare/dev/release commands, environment configuration, Firebase config injection, and a supported developer setup. Preserve iOS behavior while doing this.

**Done when:** a clean checkout produces an installable debug APK and a signed, minified release AAB; a Play-installed release launches without plugin initialization failures.

### 2. Implement Android authentication and connected-account handoff — P0, large

**Confirmed:** [useSsoLogin.ts](../apps/web/src/features/auth/useSsoLogin.ts) uses the native callback/session redemption flow only for iOS. Android falls through to browser navigation and sets `original_url` to the WebView's local origin. [The navigation plugin](../apps/web/tauri/navigation_plugin/src/lib.rs) opens external destinations in the system browser, where that local origin does not return the user to the app. The same iOS-only split appears in [Gmail linking](../apps/web/src/lib/core/email-link/index.ts) and [GitHub onboarding](../apps/web/src/features/auth/mobile-onboarding/OnboardingConnectAccounts.tsx).

**Do:** implement an Android browser/Custom Tabs authentication bridge with app callback delivery, cancellation, request correlation, and the existing one-time session-code exchange. Apply it consistently to every supported login provider, Gmail/calendar consent, account linking, and reauthentication. Reuse the backend session model; do not assume browser cookies automatically become native HTTP cookies. Keep intended destination/referral/onboarding state through the round trip and process recreation.

**Done when:** new and existing users can sign in, connect another inbox/GitHub account, grant calendar scopes, cancel/retry, relaunch while authenticated, log out, and switch accounts. Check email-code login as well as SSO and verify account-specific caches and push tokens are cleared/rebound.

### 3. Complete backend Android push delivery — P0, large

**Confirmed:** [notification ingress](../crates/notification/src/domain/service/ingress.rs), around lines 365 and 561, explicitly filters out `DeviceEndpoint::Android` for push delivery and push clearing. [NotificationChannel](../crates/notification/src/domain/models/queue_message.rs) has only iOS, email, and connection-gateway variants. [The Android payload model](../crates/notification/src/domain/models/android.rs) still has `new_temporary_empty` and `"Temporary placeholder"`; it is not a production message builder. Existing registration and [FCM infrastructure](../infra/stacks/notification-service/index.ts) do not connect this missing delivery path.

**Do:** add Android message construction, queue/worker handling, and dispatch. Preserve notification IDs, permissions, user preferences, grouping, read/dismiss synchronization, retry semantics, and invalid-token cleanup. Use a correct SNS/FCM payload contract, not the placeholder model. SNS supports an explicit [FCM HTTP v1 envelope](https://docs.aws.amazon.com/sns/latest/dg/sns-fcm-v1-payloads.html).

**Done when:** representative channel, mention, email, and other enabled notification types reach Android from real backend events; reading/dismissing on another client reconciles correctly. Include serialization and worker tests, not just device-registration tests.

### 4. Complete the Android push receiver and frontend contract — P0, large

**Confirmed:** the pinned notifications plugin's [Android implementation](https://github.com/macro-inc/tauri-plugins/blob/6ddd6600e20436388f169e936b610fe93944b7b0/packages/tauri-plugin-notifications/android/src/main/java/NotificationsPlugin.kt) initializes Firebase, requests permission, and fetches a token. It lacks the `watchNotifications` method called by [PushNotification.tsx](../apps/web/src/lib/tauri/PushNotification.tsx), and the audited app/plugin sources contain no custom `FirebaseMessagingService`, token refresh handler, or notification-tap intent bridge. Inherited Tauri `checkPermissions` returns a permission alias map (`postNotification`), while the Rust/JS contract expects a `status` field.

**Do:** normalize permission responses, handle pre/post Android 13 permission behavior, implement receive/tap/token-refresh handling, notification channels and icons, foreground behavior, and cold-start event buffering. Configure matching Firebase Android apps and supply ignored `google-services.json` files per environment. Validate SNS credentials/project alignment; their configuration references already exist.

The frontend currently suppresses local notifications once remote push reports granted. Until remote display works, that can leave users with neither path. Deliberately choose foreground display/deduplication behavior rather than copying iOS assumptions.

**Done when:** delivery and tap routing work in foreground, background, and normal process-dead states; permission denial/revocation, token rotation, account switch, and notification removal work. Test Doze and OEM battery management separately; user force-stop is a distinct OS state and should not be promised normal push delivery.

### 5. Implement Android keyboard, insets, and text-input behavior — P0, medium/large

**Confirmed:** [useAppSquishHandlers.ts](../apps/web/src/components/app/useAppSquishHandlers.ts) expects native `keyboardWillShow` / `keyboardWillHide` events on *both* mobile platforms. The pinned Android keyboard plugin implements only an example `ping` command. [TauriProvider.tsx](../apps/web/src/lib/tauri/TauriProvider.tsx) reads Android safe-area insets once on mount. The activity already enables edge-to-edge.

**Do:** provide Android IME/window-inset events, reconcile viewport resizing with keyboard height to avoid double subtraction, and update insets after rotation, navigation-mode changes, and window resizing. Test editor focus, caret visibility, bottom toolbars, sheets, scrolling, selection, clipboard menus, and keyboard dismissal. Review the iOS cursor-scroll plugin, currently enabled for all native mobile platforms in multiple editors, for Android behavior.

Test Gboard and Samsung Keyboard, composition/non-Latin input, dictation, emoji, multiline messages, and hardware keyboards. Edge-to-edge handling is a requirement for this target SDK, not optional cosmetic work; see [Android guidance](https://developer.android.com/develop/ui/views/layout/edge-to-edge).

**Done when:** channel, email, AI, comments, and document composers remain visible and retain correct text/selection through IME show/hide and rotation.

### 6. Fix App Links and unify the WebView origin — P0, medium

**Confirmed:** [assetlinks.json](../apps/web/tauri/src-tauri/.well-known/assetlinks.json) names `com.tauri.dev`; the application ID is `com.macro.app.prod`. Intent filters already exist for macro.com, dev.macro.com, and staging.macro.com, but the deployed association files were not verified. The native-app service's dynamic verification model currently supplies iOS association data only.

There is also a concrete configuration mismatch to resolve: [lib.rs](../apps/web/tauri/src-tauri/src/lib.rs) passes `https://tauri.localhost` to the custom protocol on Android, while its navigation allowlist includes only the HTTP form. [tauri.conf.json](../apps/web/tauri/src-tauri/tauri.conf.json) does not enable `useHttpsScheme` (false by default in the pinned Tauri code), and [backend CORS](../crates/macro_cors/src/lib.rs) includes HTTP, not HTTPS. This needs an actual device test to identify each failing request, but the inconsistent definitions are visible in source.

**Do:** choose the origin before launch and align protocol rewriting, navigation, browser API requirements, cookies, CORS where applicable, workers, and asset URLs. Changing the origin later changes browser-storage identity. Publish correct association files for the selected hosts and **Play App Signing** certificate, with separate debug/dev associations as needed. [Android's verification guidance](https://developer.android.com/training/app-links/verify-applinks) also covers the stricter multi-host behavior on older versions.

**Done when:** signed-release links open the correct entity on cold/warm launch, including logged-out users who must authenticate first; callback links and links from notifications are not dropped or duplicated.

### 7. Build native Android calling parity — P1, large

**Confirmed:** [CallKit setup](../apps/web/src/features/channel/Call/use-callkit.ts) is iOS-only; the native media session, audio routing, incoming-call coordination, and picture-in-picture implementation live in Swift under [callkit_plugin](../apps/web/tauri/callkit_plugin). [Backend VoIP dispatch](../crates/notification/src/domain/service/voip.rs) selects only `IosVoip` endpoints. Existing browser LiveKit calls are a reusable foreground path, not evidence of background or lock-screen calling support.

**Do:** implement the Android call lifecycle using an appropriate Telecom/Core-Telecom integration, incoming-call FCM delivery, ongoing-call foreground support, answer/decline/end actions, and an Android media session. Cover microphone/camera runtime permissions, audio focus, Bluetooth/speaker/headset routing, interruptions, reconnection, camera switching, background audio, and video/PiP parity. Handle stale/cancelled rings and calls answered on another device. [Core-Telecom](https://developer.android.com/develop/connectivity/telecom/voip-app/telecom) provides system call and foreground integration.

**Done when:** incoming and outgoing calls work with the app open, backgrounded, and the phone locked; calls survive navigation and network transitions without duplicate sessions. Treat this as a separate substantial project when planning capacity.

### 8. Add receiving shares from other Android apps — P1, medium

**Confirmed:** [share_target.rs](../apps/web/tauri/src-tauri/src/share_target.rs) selects the no-op implementation outside iOS. [ShareTargetProvider](../apps/web/src/lib/tauri/ShareTargetProvider.tsx) and [IosShareSheet](../apps/web/src/features/sharing/ios-share-sheet/IosShareSheet.tsx) explicitly exclude Android. The manifest has no SEND/SEND_MULTIPLE filters.

**Do:** support Android share intents for text, URLs, images, and files; stage `content://` resources while permission grants remain valid; handle multiple files, MIME types, size limits, cancellation, cleanup, cold start, and an authentication detour. Reuse the destination picker/upload logic after removing iOS-specific assumptions. Scope FileProvider paths to the data actually shared.

**Done when:** sharing from Photos, Files, a browser, and another messaging app opens Macro and successfully sends to the selected destination without replaying old shares.

### 9. Verify and complete attachments, clipboard, downloads, and outgoing sharing — P1, medium

**Confirmed:** photo-library and pasteboard native implementations are iOS-only. [nativePhotoLibrary.ts](../apps/web/src/lib/core/mobile/nativePhotoLibrary.ts) invokes its plugin on every Tauri platform, catches failure, and permits a file-input fallback; ordinary Android attachments are therefore **unverified, not proven absent**. [Clipboard image recovery](../apps/web/src/lib/core/mobile/mobileClipboardImageRecovery.ts) similarly attempts an unavailable native command. [downloadFile](../apps/web/src/lib/filesystem/download.ts) uses a browser Blob/anchor, and [imageActions](../apps/web/src/lib/core/util/imageActions.ts) relies on Web Share/browser behavior.

**Do:** exercise actual Android WebView file picking and cloud content providers. Implement native Photo Picker/Storage Access Framework and staging only where the existing path cannot meet requirements. Add reliable save/export/open/share adapters for Blob and authenticated downloads as necessary; do not assume desktop anchor downloads work. Validate camera capture if exposed, large files/video, progress, failures, cancellation, clipboard images, and image saving. Restrict permissions to the chosen flows; inspect the merged manifest rather than assuming the app manifest is the complete permission list.

**Done when:** attachments and exports work across chat, email, documents, and AI, including files originating from Downloads and cloud providers.

### 10. Integrate system Back, haptics, and Android UI behavior — P1, small/medium

**Confirmed:** the pinned Tauri Android activity has default WebView-history Back behavior. No app listener for its `back-button` API was found; application drawers, overlays, and split navigation need an explicit behavior review. [Haptic calls](../apps/web/src/lib/core/mobile/haptics.ts) run for Tauri, but [native plugin registration](../apps/web/tauri/src-tauri/src/lib.rs) places haptics inside the iOS-only block.

**Do:** define/test Back priority (IME, overlay/sheet, nested screen, top-level exit), gesture/predictive Back, and unsent-draft preservation; use the existing Tauri mechanism where sufficient. Register haptics on Android and handle unsupported/error cases. Verify notification prompts/settings wording, TalkBack, large text, contrast, touch targets, rotation, tablets/foldables, split-screen, and external keyboards. Decide supported form factors explicitly; the scaffold also advertises a TV launcher category that should be removed unless intentionally supported.

**Done when:** normal Android navigation never unexpectedly exits a compose flow or strands an overlay, and supported layouts remain usable at changed window/font sizes.

### 11. Prove offline, resume, and process-death reliability — P1, medium validation

**Existing foundation:** native cache, queued mutations, native HTTP/WebSockets, and resume handling. **Confirmed gap:** [native-network-status.ts](../apps/web/src/lib/core/mobile/native-network-status.ts) and [query online-state integration](../apps/web/src/lib/queries/client.ts) use native reachability only on iOS. Android falls back to browser connectivity behavior; this is not proof that Android offline mode is broken.

**Do:** test Android's default connectivity behavior first; add ConnectivityManager monitoring if needed. Validate session refresh, WebSocket resubscription, missed-event replay, optimistic writes, unsent drafts, pending uploads, cached reads, and cross-account isolation after background suspension and process death. Audit Android backup/restore exclusions for credentials and account-specific caches. Measure cold launch, cache hydration, long lists, large documents, memory pressure, and battery use on a lower-end device.

**Done when:** airplane mode, Wi-Fi/cellular transitions, screen lock, backgrounding, and OS process reclamation do not lose acknowledged work or leak the prior account's data.

### 12. Make OTA updates safe across two mobile platforms — P1, medium

**Existing foundation:** Android native version retrieval, bundle checksums, compatibility/revocation policies, and update state UI. **Confirmed design constraint:** [native_app_service](../crates/native_app_service/src/domain/service.rs) fetches one bundle manifest with one `min_native_build`; target-specific policy rules exist, but the minimum is shared. Android and iOS native build numbering/capabilities must not be assumed equivalent.

**Do:** use aligned compatibility numbering or platform-specific minimum/capability metadata; prevent a shared JS update from invoking unavailable Android plugins. Test native build-number detection, interrupted download/extraction, cache eviction, incompatible updates, revocation, embedded-bundle fallback, and resume/apply behavior. Give Android users a working Play Store update destination. Check release update controls, not only development mode.

**Done when:** an old installed Android release remains functional when a new iOS/JS release ships, and rejected/interrupted updates recover cleanly.

### 13. Establish Play distribution, billing behavior, and release operations — P1, medium; billing may be large

**Confirmed:** no Android signing/release workflow was found in the audited GitHub workflows, and no release signing configuration appears in the checked-in Gradle app. External signing/Play setup may exist. [Billing](../apps/web/src/features/settings/Billing.tsx) and [paywalls](../apps/web/src/features/paywall/PaywallComponent.tsx) launch Stripe checkout without an Android-specific branch. [MobileApp settings](../apps/web/src/features/settings/MobileApp.tsx) advertise only the Apple App Store. Account deletion already exists in [Account settings](../apps/web/src/features/settings/Account.tsx).

**Do:** establish application ownership, Play App Signing/upload-key handling, monotonic version codes, reproducible CI AAB builds, release R8 testing, native symbols/source maps, crash/ANR monitoring, internal testing, staged rollout, and rollback procedures. Verify final launcher/adaptive/monochrome icons, splash screen, store listing/screenshots, support links, environment separation, and reviewer account access.

Current [Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) call for API 36 for new phone apps/updates; the project already targets 36. Verify **16 KB page-size compatibility for every shipped native library**, including Rust/cache/media dependencies. The [Android tooling shell](../nix/tauri-dev-shells.nix) pins NDK 26.3; upgrade or explicitly configure and verify alignment rather than assuming compliance. See [Android's page-size guidance](https://developer.android.com/guide/practices/page-sizes).

Choose a billing strategy for the intended countries: Play Billing, an applicable enrolled alternative program, or a consumption-only Android app with appropriate purchase UI. Existing Stripe links are not automatically acceptable everywhere; [Google's policy](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en) distinguishes these cases. Play Billing would add entitlement synchronization, restoration, cancellation/refund handling, and backend purchase verification work.

Complete privacy/Data safety declarations against actual SDK/data behavior and verify the existing deletion flow plus an external deletion-request path. See [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) and [account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en). Recheck applicable policies at submission.

## Execution order and release gate

1. **Prove the shell:** fix build/plugin blockers; settle origin, signing/package identity, and developer tooling; install debug and release builds.
2. **Prove the daily-use loop:** sign in, connect inboxes, compose with the keyboard, upload files, navigate Back, receive/tap push, and relaunch without losing state.
3. **Complete parity:** native calls, inbound/outbound sharing, exports, clipboard, offline/process recovery, and OTA compatibility.
4. **Qualify the release:** billing decision, store setup, automated smoke coverage, real-device testing, observability, and staged Play rollout.

Build Android-native smoke coverage rather than treating mobile browser emulation as acceptance. Existing [native tests](../apps/web/tests/native/README.md) focus on Linux cache behavior, while the dedicated mobile smoke runner is [iOS-only](../apps/web/tests/native/ios/README.md).

| Test dimension | Minimum coverage |
| --- | --- |
| Devices | Pixel and Samsung physical phones; lower-memory device; supported minimum OS; Android 13 notification permissions; API 35/36; 16 KB emulator/device; tablet/foldable if supported |
| Build | Debug, signed minified release, and Play-installed AAB; clean install and upgrade |
| Core product | Search/inbox, channels/threads, email compose/reply, tasks, calendar, document/PDF/spreadsheet surfaces offered on mobile, AI streaming/tools, attachments, settings |
| Lifecycle | Foreground, background, locked, cold launch, OS process death, rotation/window resize, offline/reconnect |
| Native integrations | Authentication and OAuth return, push receipt/tap/clear, incoming/outgoing calls, file pick/save/share, clipboard, Back, keyboard/insets |
| Isolation/recovery | Logout/account switch, expired session, revoked permissions, token rotation, interrupted uploads, incompatible/interrupted OTA |

No application code was changed for this audit. Build failures are inferred from inspected source/configuration, not reproduced compiler output. No unit/integration suites or `just check` were run because this change is documentation-only; Android device validation remains the main missing evidence.
