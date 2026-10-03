# iOS lifecycle and deep-link smoke tests

These tests cover the single-window scene manifest and the pinned Tao
cold-start URL fix. They complement, rather than replace, native touch/editor
and release testing.

## Portable configuration and assertion tests

From the repository root, with Python 3.11+ (stdlib only):

```sh
python3 -m unittest discover -s apps/web/tests/native/ios -p 'test_*.py' -v
```

Checks the source/generated scene manifests, XcodeGen declaration, iOS 15
minimum in Tauri/XcodeGen/Xcode, fork ownership/revision consistency, and the
smoke runner's duplicate/missing-event and resume assertions. No Xcode, account,
network, or simulator is needed for these checks. They also cover PID reuse,
including two process incarnations born within the same second.

## Live simulator smoke

Prerequisites:

- macOS, Xcode 27, and a **booted** iOS 27 simulator.
- An installed Macro **debug** app from this checkout, built with
  `--no-default-features` to disable automatic bundle updates. Keep its Vite
  server running. Use `just ios-dev` from `apps/web` to open Xcode and build/run
  the simulator destination. The app and both extensions require iOS 15+.
- The debug logs must include Tao's `emitting Opened` and Macro's
  `mobile window resumed` messages (the debug app's default log filter does).
  Missing logs fail the test; do not treat an instrumentation failure as a pass.

Save any drafts first: the test **terminates and relaunches Macro**. It does
not install/reinstall apps, boot/erase simulators, clear data, sign out, grant
permissions, send messages, or edit documents. Existing sessions are retained.
It briefly activates Safari to exercise background/foreground transitions.

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
/usr/bin/xcrun simctl list devices booted
python3 apps/web/tests/native/ios/smoke.py \
  --device <simulator-udid> --allow-restart
```

Use `--settle-seconds 20` on slower machines. The runner creates a private
(mode 0700) temporary evidence directory and prints its path. Screenshots can
contain real account data: keep them local and do not commit/upload them.

Each launch records its PID and Darwin process start time (microsecond precision).
Checkpoints recheck that identity before and after collecting evidence, reject
exiting/zombie processes, and restrict logs to that process's start time. This
prevents an older process with a reused PID from satisfying event counts.
The identity is included in `results.json`. The small Darwin helper runs under
isolated Xcode Python to avoid mixing Nix's Python/libffi with the system libraries;
it needs no extra packages.

Automated checks:

| Checkpoint | Expected events |
| --- | --- |
| Normal launch, no URL | Zero `Opened` events; process remains alive |
| Cold `macro://app/login` | Exactly one scene-connection `Opened`, with one URL |
| Warm `macro://app/welcome` | Same process; exactly one additional URL-context event |
| Background to Safari, return | Same process; exactly one additional resume event; no extra link events |
| Terminate and launch without URL | Zero link events in the new process; no stale link replay |

**Review the screenshots too.** Event counts do not prove frontend navigation
or rendering. Signed-out expectations are welcome → login → welcome; a later
ordinary launch must show welcome again. Signed-in runs should retain auth and
follow the app's authenticated redirects, never require signing in again or
replay the prior link. Do not force the signed-out screenshot expectations on
a signed-in account. Review `results.json` and the per-checkpoint logs alongside
the screenshots. A failed checkpoint still saves the collected evidence.

The runner verifies custom-scheme delivery using `devicectl --payload-url`, not
Apple's associated-domain routing. It intentionally avoids authenticated writes.
For iPad, dismiss the existing `Optimized for iPhone` notice manually if it
obscures screenshots; do not interpret it as a scene-lifecycle error.

## Release checks still required

- iOS 26 and physical iPhone/iPad regressions; iOS 27 simulator coverage alone
  does not establish parity with iOS 26.
- Android foreground/resume behavior after the Tao/Tauri upgrade.
- Signed HTTPS universal links from Safari/Mail, cold and warm. Simulator Tao
  unit tests cover `NSUserActivity` extraction/filtering, not domain association.
- Share-sheet/file import, notification taps, calls, and OAuth return flows.
- Default-feature production/OTA behavior, including pending-update application
  and retry on resume. The debug smoke build disables automatic updates.
- Editing, software-keyboard geometry, selections, and composer behavior. Read-only
  UI checks exercised dock taps, search entry/reset, document navigation/resume,
  and PDF rendering/scrolling, but did not edit or send user content.

## Separate finding: legacy document displays JSON

The existing onboarding document titled `Why use Macro?` displayed serialized
Lexical JSON as body text during read-only testing. Navigation remained responsive;
a second document was empty and therefore was not a rich-text rendering control.
This has **not** been attributed to this PR or to iOS/Tao. Investigate stored
content/migration and compare the same document on web/iOS 26 before changing
rendering or rewriting any document. Keep that investigation separate from the
scene lifecycle and cold-start fix.
