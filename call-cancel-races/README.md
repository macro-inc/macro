# Native cancellation, restoration, and retry

PR [#6667](https://github.com/macro-inc/macro/pull/6667), commit `464a805f3d93e3a60c704029af7a8467d7df10de`, compared with `8e785ffe4dd00cd52350752907b057cbefa19711`.

Native cleanup can yield to a restored session or retry in the same channel. If a server leave was already sent, registration waits for it to settle. Automatic restoration checks that the original call still exists, renews membership without duplicating native media, and handles native/server UUID casing. Lookup refusal only tears down stale native state; it cannot delete a replacement call's membership.

## Before/after proof

[Recorded comparison](before-after.mp4), [server assertions](assertions.json).

| Scenario | Before | After |
| --- | --- | --- |
| Native restores before disconnect cleanup settles | Cleanup removes the restored membership | Restored member remains; no server leave sent |
| Retry during cancellation cleanup | Join rejects; cleanup removes membership | Retry joins successfully and keeps membership |
| Native restores after server leave starts | Lifecycle says active with zero members | Old leave settles, then membership is renewed |

Each scenario starts with one real server participant. All three baselines end with zero participants; all fixes end with one. The harness drives the production lifecycle and native bridge, with controlled transport promises and real local call APIs. It does not simulate a physical iOS device or prove atomic cancellation of a server request already in flight.

## Full call verification

[Two-participant LiveKit video](call-lifecycle.mp4), [assertions](call-assertions.json): timeout and retry, two connected participants, microphone mute/unmute, interrupted signaling and recovery, Messages/Call navigation, leaving one participant connected, then rejoining. All assertions pass with no browser page errors. Chrome uses a synthetic silent microphone.

The shared Chrome CDP connection timed out during this run. Verification used a temporary local Chrome against the same isolated backend and left the shared browser untouched.

## Checks

- Five initial reproduction cases fail before the fix; [before log](tests-before.log).
- [84 focused lifecycle/native/recovery tests pass](tests-after.log), including 17 added regressions.
- [433 tests across 61 files pass](tests.log): channel, block-call, block-channel, and machine.
- [Full frontend type-check](typecheck.log), [repository checks](check.log), and all five QC review roles pass.
- No new `createEffect` or switch statements.

[Exact revisions and video hashes](manifest.json). The [earlier cancellation proof](../call-cancel-cleanup/README.md) records removal of an orphaned member when there is no replacement or retry.
