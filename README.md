# Machine migration verification

Latest call lifecycle follow-up: [preserve an active call when another channel requests Join](call-active-guard/README.md) at commit `c36cf49c7`.

Three independent PRs, each targeting `main`, with the same browser scenarios run before and after its migration. The AFTER recordings and assertions were refreshed after the effect-removal review. Recordings use the local stack started with `--with-chrome`, local test accounts and fixtures, and a real local LiveKit server.

| Change | PR | Before / after video | After starts | Tests after |
| --- | --- | --- | --- | --- |
| Email target navigation | [#6665](https://github.com/macro-inc/macro/pull/6665) | [Play or download](email-before-after.mp4) | 00:15.33 | 202 |
| Incoming call ringing | [#6666](https://github.com/macro-inc/macro/pull/6666) | [Play or download](ringing-before-after.mp4) | 00:19.06 | 364 |
| Shared call lifecycle | [#6667](https://github.com/macro-inc/macro/pull/6667) | [Play or download](calls-before-after.mp4) | 00:39.52 | 398 |

The videos concatenate the original and changed implementations at normal speed, with BEFORE/AFTER labels. Initial loading silence is trimmed from the ringing recordings. The ringing video follows the surviving recipient tab and mixes the real chime audio from both recipient tabs. Assertions capture the two-tab election independently of the video.

## Revisions

The original implementation is commit `65cce71dad0ba3dc98c5636e84ea5fd90abe3a17`. It was merged into main while this work was underway. Each new branch was independently rebased onto main at `fb311529664c27e10c1ab4d3cd19a4a9ca928eb3`; the intervening main changes are unrelated to these lifecycles.

Exact PR heads, video hashes, durations and chapter boundaries are recorded in [manifest.json](manifest.json). The artifact branch contains only verification material; the implementation PRs contain no video binaries.

## Effect-removal and regression review

Email navigation now has one explicit effect bridging reactive route, query and DOM readiness into the machine, down from four across thread state/navigation. Target clearing and completion derive from request identity; cancellation runs before loading or mobile visibility gates. Thread cleanup runs directly at the target-change boundary.

The call coordinator has no `createEffect`. Native snapshot setters publish events directly; the bridge reconciles the current native snapshot when deferred joins or leaves settle. The ringing machine already has no effects.

The review found and fixed native ordering gaps: a replacement call could be dropped while an earlier leave finished, and an end/replacement could be dropped while the start transaction was pending or failed. Regression tests cover those interleavings, initial empty snapshots, updater semantics, unchanged identity, unsubscription, and synchronous no-token join completion.

All five QC reviews passed. The three final branches also merge cleanly together after separating overlapping guide additions. Their combined checkout passes **604 tests across 95 files** and the full frontend type-check. See [combined tests](test-results/combined-effects-tests.log), [combined type-check](test-results/combined-effects-types.log), and [manifest.json](manifest.json).

The per-branch counts in the table cover broader suites and overlap: email includes the entire email project; ringing and calls include channel, block-call, block-channel, and machine projects. They should not be summed.

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
- Email: 60 primitive tests and 202 tests across the full email project pass, including cancellation while queries are busy or a mobile view is inactive, thread changes, cache refreshes, and reopening the same target.
- Ringing: 18 coordination tests and 364 tests across the broader suite pass. New cases verify the original deadline across demotion/takeover and cleanup when a sound ends synchronously during scope setup.
- Calls: all 60 original call tests plus 25 lifecycle tests and 14 native integration tests pass; the broader suite passes 398 tests. Coverage includes duplicate intent, late completion, timeout retry, leave during recovery, suspension, native termination/restoration ordering, and cleanup.
- Full frontend type-check passes for the baseline, each final branch, and the combined checkout. All three branches pass `just check` (Biome, oxlint, ast-grep) and diff whitespace checks. The check logs retain warnings from untouched legacy code.
- All five quality reviews passed after the identified issues were fixed.

The relevant captured output is under [test-results](test-results). Web CI for the final heads checks Build, Biome, Typecheck, Test, and Cycles Import Check: [email](https://github.com/macro-inc/macro/actions/runs/35480215318), [ringing](https://github.com/macro-inc/macro/actions/runs/35480215268), and [calls](https://github.com/macro-inc/macro/actions/runs/35480277143). Local broad call tests use the repository configuration with an extra Vite filesystem allow path for the shared node_modules symlink; no test logic or expectations are overridden.

The assertions and videos are evidence of the listed scenarios, not a claim of exhaustive UI or device coverage.

Latest call cancellation and restoration proof: [review fixes and recordings](call-cancel-races/README.md).
