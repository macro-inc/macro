# Call lifecycle review fixes

PR [#6667](https://github.com/macro-inc/macro/pull/6667), implementation commit `314ce36928004d2a8d676edf009cded7954eeef3`.

The native bridge now distinguishes an absent initial snapshot from the end of an observed native session. Disconnecting clears ownership, and confirmed native ends cancel pending joins and recovery. Adopting a live session clears stale errors. Failed joins preserve CONFLICT errors with instructions to leave the existing call. Join, Call Again, and Leave UI handlers catch rejected promises.

No new createEffect or switch statements were added; branching uses ts-pattern.

## Browser recordings

- [Call lifecycle](call-lifecycle.mp4): real local LiveKit, actual 15-second timeout/retry, microphone toggle, signaling interruption/recovery, Messages/Call switching, leave and rejoin. [Server participant assertions](call-assertions.json).
- [Error handling](error-handling.mp4): inject HTTP 409 and 500 into Join/Try again, then a failed leave request and a rejected Call Again action. The conflict guidance is visible and no unhandled promise rejection occurs. [Assertions](error-assertions.json).

The local stack uses --with-chrome and fixture accounts. The Chrome microphone is a synthetic silent track. Native ordering is unit-tested; this does not claim verification on a physical iOS device. The Gmail reconnection toast is from fixture accounts without Gmail credentials.

## Automated checks

- All 410 tests across the channel, block-call, block-channel and machine projects pass, including 50 focused lifecycle/native tests.
- The five exact reproduction cases from the review failed before the fix and now pass: [before](reproductions-before.log), [after](reproductions-after.log).
- Full frontend type-check and just check pass. Legacy warnings remain in untouched code. [Tests](tests.log), [types](typecheck.log), [repository checks](check.log).
- All five QC roles pass: code review, simplification, consistency, robustness and scope.
- No JavaScript page errors in the four recorded browser contexts.

Exact revision and video hashes are in [manifest.json](manifest.json). The original before/after migration videos and earlier combined-branch validation remain in the [parent report](../README.md).
