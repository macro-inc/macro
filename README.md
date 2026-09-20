# Machine migration verification

Three independent PRs, each targeting `main`, with the same browser scenarios run before and after its migration. Recordings use the local stack started with `--with-chrome`, local test accounts and fixtures, and a real local LiveKit server.

| Change | PR | Before / after video | After starts | Tests after |
| --- | --- | --- | --- | --- |
| Email target navigation | [#6665](https://github.com/macro-inc/macro/pull/6665) | [Play or download](email-before-after.mp4) | 00:15.33 | 56 |
| Incoming call ringing | [#6666](https://github.com/macro-inc/macro/pull/6666) | [Play or download](ringing-before-after.mp4) | 00:19.06 | 16 |
| Shared call lifecycle | [#6667](https://github.com/macro-inc/macro/pull/6667) | [Play or download](calls-before-after.mp4) | 00:39.52 | 85 |

The videos concatenate the original and changed implementations at normal speed, with BEFORE/AFTER labels. Initial loading silence is trimmed from the ringing recordings. The ringing video follows the surviving recipient tab and mixes the real chime audio from both recipient tabs. Assertions capture the two-tab election independently of the video.

## Revisions

The original implementation is commit `65cce71dad0ba3dc98c5636e84ea5fd90abe3a17`. It was merged into main while this work was underway. Each new branch was independently rebased onto main at `fb311529664c27e10c1ab4d3cd19a4a9ca928eb3`; the intervening main changes are unrelated to these lifecycles.

Exact PR heads, video hashes, durations and chapter boundaries are recorded in [manifest.json](manifest.json). The artifact branch contains only verification material; the implementation PRs contain no video binaries.

## Browser scenarios

### Email

Open the same thread by a recent message deep link, then by an older message deep link requiring pagination. Both implementations load, expand and reveal the requested messages. The target bounding boxes match exactly: recent message 75 at `(288, 286, 920, 214)` and older message 1 at `(288, 186, 920, 214)` in the original browser viewport. See [before](assertions/email-before.json) and [after](assertions/email-after.json).

Exploratory testing also found an existing middle-of-thread scroll jump: message 60 expands but ends above the viewport at y = -420 on both implementations. This migration preserves the existing scroll geometry and does not fix that issue. The passing video demonstrates messages 75 and 1; it is not evidence that every possible target already scrolls correctly.

### Incoming call ringing

Start a real call with another local user. Open two recipient tabs and verify that only the elected tab repeats its chime. Close that tab and verify the survivor takes over. Answer from the survivor and verify that ringing stops. Both users then leave. The count stays at three chimes after answering on both implementations. See [before](assertions/ringing-before.json) and [after](assertions/ringing-after.json).

An initial chime can occur in both tabs before the election converges; that behavior also exists in the baseline. The machine migration preserves the election protocol.

### Shared call lifecycle

Run this sequence against both implementations:

1. A peer starts a real local LiveKit call.
2. Hold the tested user's first join request to exercise the actual 15-second timeout; verify that Try again becomes available.
3. Retry successfully and abort the obsolete held request. Verify two ACTIVE participants using LiveKit's server API.
4. Mute and unmute using the app controls.
5. Disable the tested user's network, close its LiveKit signaling socket, and restore the network after two seconds. Verify a new signaling connection and two ACTIVE participants.
6. Switch from Call to Messages and back, preserving the session across a new call-tab hook mount.
7. Leave and verify only the peer remains. Rejoin and verify two ACTIVE participants again. Leave and clean up the peer.

See [before](assertions/calls-before.json) and [after](assertions/calls-after.json). Both have three join attempts, successful microphone toggles, successful recovery, and the expected participant membership after each phase.

These are Chrome browser checks with a synthetic silent microphone because the browser container has no physical input device. They verify the real connection and lifecycle, not physical audio quality or a native iOS device. Native snapshot, suspension, and termination handling are covered by unit tests. The Reconnect Gmail toast comes from the local fixture accounts, which have no real Gmail credentials.

No JavaScript page errors were captured in any of the six passing runs.

## Automated checks

- Baseline: 69 existing tests pass across the call suite and email state/navigation suites. The three email target characterization tests also pass against the original implementation, and all 14 original ringing tests pass.
- Email: 56 primitive tests pass after migration, including cancellation, retargeting, stale completion, failed positioning, and highlight cleanup cases.
- Ringing: 16 tests pass after migration, including heartbeat stability and reentrant cleanup followed by takeover.
- Calls: all 60 existing call tests plus 25 lifecycle tests pass after migration. New cases cover duplicate intent, late completion, timeout retry, leave during recovery, suspension, native termination, and cleanup.
- Full frontend type-check passes for the baseline and each final branch. Changed-file Biome checks and diff whitespace checks pass.
- All five quality reviews passed after the identified issues were fixed.

The relevant captured output is under [test-results](test-results). The complete web CI jobs—Build, Biome Check, Typecheck, Test, and Cycles Import Check—all succeeded for [email](https://github.com/macro-inc/macro/actions/runs/35477342708), [ringing](https://github.com/macro-inc/macro/actions/runs/35477345057), and [calls](https://github.com/macro-inc/macro/actions/runs/35477348653).

The assertions and videos are evidence of the listed scenarios, not a claim of exhaustive UI or device coverage.
