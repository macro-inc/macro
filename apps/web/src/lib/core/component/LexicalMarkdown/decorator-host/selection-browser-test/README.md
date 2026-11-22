# Selection and static decorator binding proofs

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

This isolated fixture covers GroupMention, UnknownMention, ThemeMention and
ConnectApp. It uses their actual Source factories/components/providers and the
production native EditorSession, SessionPort and EditorView. Only their narrow
selection capability changes; ordinary Source calls retain the original context.
The shared native adapter obtains the actual initialized component registry;
rows only project typed props. One real view-backed selection context is bound
to its acknowledged generation and disposed by the view owner.

baseline.browser.e2e.ts compares OFF model and DOM bytes against immutable
pre-refactor captures. import-matched.browser.e2e.ts imports the identical saved
Source JSON before either renderer observes decorators, then compares literal
model and DOM. selection.browser.e2e.ts selects and clears actual model nodes in
both engines. Chromium, Firefox and WebKit have separate captures; nothing is
normalized. The earlier HTML/fresh-factory cohorts remain separate and open.

Provide FAST_DECORATOR_BASELINE with the existing pre-refactor capture directory,
FAST_DECORATOR_PHASE=after and the three explicit browser executables when
running playwright.config.ts. The ignored wasm directory requires all five
hash-verified files from the sealed native-click-guard-fc9a5f1ae6 artifact. This
fixture refuses missing or mismatched artifact hashes before collection. It
neither builds nor promotes an artifact. It installs only the
fixture-owned views; it is not the complete application decorator registry.

static-six.browser.e2e.ts additionally covers Watermark, Await, AgentContext,
ReplyTarget, AccountManagerRequest and CursorSystemNotification. See
../static-views.md for exact render/interaction scope and open gates. Supply
FAST_DECORATOR_STATIC_BASELINE for the original Watermark/Await/AgentContext
captures and FAST_DECORATOR_BASELINE for the other three immutable Source
captures. The control compares fresh Source bytes before running its matched
Source/native import cohort. The existing selection-only cases remain separate.
