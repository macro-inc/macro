# GIF menu and insertion controls

## Current canonical package

This fixture now imports the canonical ordinary document-session package built
by `just build-document-session-wasm` in `apps/web`. It does not load a private
`wasm/` or `wasm-root-id/` directory. Before a new run, build that package, run
`bun scripts/check-decorator-browser-wasm.ts`, then typecheck with
`bun ../../node_modules/typescript-native/bin/tsc --noEmit --skipLibCheck --project tsconfig.decorator-browser-tests.json`.
The current Playwright config requires the real outputs, checks their declaration
against the generated consumer ABI, and records their actual hashes in metadata.
A missing output or mismatched declaration fails; there is no stub or skip.

## Archived build evidence

Earlier manifests, seal-specific descriptions and captured evidence describe
the archived builds, not this canonical target. Reproduce those runs only with
their archived fixture source and matching artifacts. They do not qualify a new
canonical-package run, and the typecheck change supplies no new browser result.

The fixture uses the existing Source wrapper, floating GIF menu, Klipy parser,
animated-byte uploader and static-file provider. Service responses and upload PUT
receivers are browser-boundary fixture facts. IDs for created fixture nodes are
assigned through actual `$setId` transforms before publication, including split
text and paragraph nodes. Compare the complete raw captures across Source host
changes without rewriting the captured model or DOM.

The native consume-error control uses the existing image insertion command to
pin the Port boundary before the GIF command is in a matched package. A real
view commit listener throws after the file is already referenced by the model.
The original error and committed model remain visible while the old post-consume
hook misses the event. Native upload ownership requires the actual per-entry
commit observer before cleanup can safely discard an uploaded file.

Source's NodeSelection path reports inserted after constructing an unattached
image, so the uploaded file remains unreferenced. Keep this orphaned upload leak
and false inserted result in both engines until they are fixed together.

Source controls in `plugins/gif/ownership.test.ts` pin that outcome, the whole-item
mid-text list split and following-item caret, and the special empty-paragraph
path. Native GIF mounting and insertion require its actual host and a matching
shared native seal. No application registry installation is included here.

The delayed-completion control wraps a real Source commit and defers only its
result. Opening a newer picker before that result resolves must preserve the new
menu and focus; it does not stand in for native commit evidence.
