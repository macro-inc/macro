# Preserve an active call when another channel requests Join

PR [#6667](https://github.com/macro-inc/macro/pull/6667), commit `c36cf49c76b09116fa2b7746b3ab4180cf38e114`, compared with `afb7020f0a991fa3e142af0e175d1be1a11a805a`.

Joining a different channel while already connected now rejects before requesting a token or replacing the active lifecycle. The requested channel opens its Call tab and shows the leave-current-call guidance. The existing call keeps its connection, participant view, controls, and disconnect watcher. The view exposes the guidance for the other channel without hiding the active call's overlay, including when the current session is native.

## Browser proof

[Before/after recording](before-after.mp4), [assertions](assertions.json), [final two-pane screenshot](controls.png).

The comparison imports the production lifecycle before and after the fix and uses real local call APIs and LiveKit connections. Before the fix, requesting another channel's token returns CONFLICT, disconnects the original transport, and removes its watcher. After the fix, the original transport stays connected and there is no second token request, disconnect, watcher removal, or server leave.

The final section uses the actual app in two channel panes. It joins the first call, clicks Join in the other channel, asserts the guidance is visible there, and checks the first call's Leave control remains available. No token request goes to the second channel. [Browser page errors](browser-checks.json) are empty.

Verification uses an owned local Chrome and the existing isolated backend. Initial module requests intermittently failed with Chrome's `ERR_NETWORK_CHANGED`; the harness reloads before performing the scenarios. The comparison drives a real LiveKit transport. Chrome uses a synthetic microphone with optional noise suppression disabled; this does not test a physical microphone or iOS device. Earlier [full call and native event recordings](../call-cancel-races/README.md) cover the other lifecycle paths.

## Regression checks

- [Two new lifecycle regressions fail before the guard](tests-before.log), covering a joined call and an adopted native session.
- [The view regression fails before error scoping](view-before.log): a conflict in another channel hides the active overlay's controls.
- [88 focused tests pass](tests-after.log), including the new lifecycle and view tests.
- [443 call/channel/machine tests pass across 62 files](tests.log).
- [Full frontend type-check](typecheck.log), [repository checks](check.log), and all five QC review roles pass.

The fix adds no `createEffect` or switch statements. [Exact revisions and video hash](manifest.json).
