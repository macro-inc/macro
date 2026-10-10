# Macro Native for iPhone

A native iPhone client for Macro. SwiftUI and UIKit own workspace navigation,
channels, messaging, calendar, email, tasks, Macro AI chats, and agent conversations. Documents,
spreadsheets, complex settings, and live calls use authenticated
web surfaces inside the app. See the [native operating guide](../../docs/AGENT_GUIDE/native-ios.md)
for navigation and verification workflows.

## Requirements

- Xcode 26 or later, with an iOS SDK and an iPhone simulator installed.
- iOS 17 or later on a physical iPhone.
- For device installation: a connected, unlocked, trusted iPhone with Developer
  Mode enabled, and an Apple development account in Xcode that can sign for the
  configured team. Developer Mode is in Settings → Privacy & Security.

There are no package manager dependencies. Open `MacroNative.xcodeproj` and select
the shared **MacroNative** scheme. The project uses Xcode synchronized folders:
Swift files added to `Sources/`, `Tests/`, and `UITests/` are picked up automatically.

## Build and run

From the repository root:

```sh
apps/ios/scripts/ios.sh run
apps/ios/scripts/ios.sh test
```

Pass a simulator UUID as the second argument to select a particular simulator.
The test scheme includes `MacroNativeTests` and `MacroNativeUITests`. Build output
and test results are under the ignored `apps/ios/.build/` directory. Physical
device builds use `apps/ios/.build-device/` so they can coexist with simulator builds.
The helper uses ad-hoc signing for simulator builds to preserve Keychain access
for real sign-in and saved sessions.

The default UI tests launch with `--ui-testing` and use in-process fixtures. They
never authenticate, send real email/messages, or mutate real calendar events. Workspace
tests add `--workspace-testing` to start on Notifications; messaging tests start on
Channels. Separate live sign-in and account audit tests require explicit opt-in
and otherwise skip; they use the real account and must stay within the user's
authorized scope.
To explore the complete fixture workspace:

```sh
xcrun simctl launch booted com.macro.app.native --demo
```

Quit the app first if it is already running. Normal launches restore the saved
session. Production is the default for a new sign-in; the environment menu also
offers development. Sessions are
stored in Keychain, and account-scoped message/draft caches use iOS file protection
and are excluded from backups. Sign-out removes the local account cache.

## Messaging behavior

- Native, reusable message cells and a UIKit multiline composer; typing does not
  rerender the message history.
- Immediate optimistic sends with client-generated UUIDv7 IDs, server-acknowledged
  reconciliation, and same-ID retry after an interrupted request.
- Live websocket updates, reconnect backoff, and history recovery on foreground.
- Cached channel history and drafts, earlier-page loading, and scroll-position
  preservation while reading incoming messages.
- Native `@` mention picker for people, channels, `@here`, dates, and workspace
  entities including documents, email, tasks, folders, and agents. Cached candidates
  appear immediately; recent items and paginated search fill the blended list.
  Styled tokens preserve Macro references across drafting and sending.
- Native attachments, a complete long-press action drawer, owned-message editing,
  owned/bot-message deletion, and inline threaded replies. Swipe left to reply;
  thread drafts, attachments, optimistic delivery, and retry remain independent.
  Collapsed threads show three replies; expansion is remembered per account.
  Missing reply tails load beyond the server's initial three-message preview.

## Native workspace

- Notifications Signal/Noise, Files, folders, Tasks, Agents, and Calls use native lists,
  filters, search, and a persistent bottom dock. Document and folder creation,
  rename, favorites, and inbox Done use the existing workspace APIs.
- Calendar has month event grids, timed week/day views, global search results,
  remembered linked-calendar filters, event details, guest responses, and native
  create/edit/delete sheets. All-day events
  use calendar dates; timed events preserve their time zone. Recurring edits
  expose occurrence/series scope. Connecting a calendar opens the web workspace.
- Email has native inbox views, account filters, conversation reading, and
  compose/reply/draft actions. Email bodies render within the native reader.
- Agent sessions have native transcripts, tool groups, queued prompts, attachments,
  inline images, model selection, permission responses, and send/retry/stop controls.
- Home/Search Ask AI creates a Cognition chat on explicit Send. Channel Ask Macro
  opens a new chat with channel context and waits for Send before submitting.
  Their transcripts, model selection, attachments, streamed text,
  and tool responses stay native; existing Macro AI chats open in the same reader.
- New supports blank documents, snippets, canvases, spreadsheets, folders, and code;
  native Automation and Reminder forms use the existing schedule APIs. Choosing
  fields does not create a schedule until the user submits it.
- Settings has native profile names and appearance, plus authenticated links to
  account, team, tags, billing, API key, and integration management.
- New Task uses the production floating glass composer, native properties, media,
  Create More, saved drafts, and an expand action that creates and opens the task.
- Task details expose completion, the five task statuses, properties, and rename.
  Task notes open the document editor inside the app.
- Calls have native history/details with summaries, participants, and transcripts;
  live channel calls use the existing web call experience.

Tests cover the HTTP contracts, authentication, send failure/retry races, duplicate
events, stale edits, pagination, cache isolation, calendar time zones and recurring
edits, email/workspace mutations, and native UI interactions. Latency tests measure
large message-history loads, warm channel opening, optimistic sending, and incoming
bursts. The tests use fixtures; testing a signed-in live account is a separate
verification step.

## Install on an iPhone

```sh
apps/ios/scripts/ios.sh devices
apps/ios/scripts/ios.sh install <physical-device-identifier>
```

The helper builds with automatic provisioning, installs the app, and launches it.
It requires the iPhone to be available to Xcode; an unavailable paired device must
be connected and unlocked first. If prompted by iOS, trust the developer profile
in Settings → General → VPN & Device Management.

The bundle identifier is `com.macro.app.native`, the display name is **Macro
Native**, and the signing team is `TY74Q77JBD` (the existing Macro iOS team). This
keeps the native client alongside the existing Macro app. Select another team in
Xcode's Signing & Capabilities if using a different development account.

## Scope

This app targets iPhone in portrait orientation. It uses the existing Macro
backend; an authenticated account reads and writes real workspace data. UI tests
use the app's isolated demo mode.

Background push notifications, extensions, and native document editors are not
part of this build. The app does not register the existing
`macro` URL scheme; `macronative` is reserved for this client.
