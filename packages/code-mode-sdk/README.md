# Code-mode dependencies and documentation

This build package bundles the actual public `@macro-inc/sdk` and Handlebars for
Deno. It adds no tool-name proxy or alternate API. Nested namespaces, entity
handles, promises and async iterators retain the public SDK implementation.

The agent supplies a JavaScript ES module exporting `async main(context)`. The
trusted bootstrap provides authenticated `macro`, `session`, and `execution`
handles plus `token`, `hosts`, `sessionId` and `executionId`. Explicit imports from
`@macro-inc/sdk` and `handlebars` resolve to local build artifacts; no downloads
or TypeScript compilation happen during a run. SDK local portmap discovery is
removed from the bundle because service hosts are supplied by the harness.

The harness mints a normal user token lasting 60 seconds after the session's
execution approval policy permits the run.
Deno permits network access only to configured Macro service hosts and denies
filesystem writes, arbitrary imports, subprocesses, environment access and FFI.
User API authorization and metering apply. Tokens expire; process exit does not
revoke them. Source and final results are journaled, credentials are not.
Individual HTTP calls are no longer represented as synthetic tool receipts.

`main` returns `{data}` with an optional `reviews` array. Reviews are persisted through
`execution.reviews.create`; the UI reads actual session-scoped records and stays
interactive after execution. A review is an optional human workflow, not a
security barrier against direct SDK writes.

The independent `@macro-inc/sdk-docs` package uses TypeDoc and its Markdown plugin to generate the canonical public SDK Markdown
hierarchy and an HTML site from one reflection model. Backend entity sections
and namespace overviews use those Markdown pages. Compact overviews include
linked local option types and enums; full sections also include linked wire types.
There is no separate declaration parser. Private, protected and internal members
are excluded. `DescribeCodeTools` provides the compact catalog, generated API
documentation and workflow guides. See [documentation hosting](../sdk-docs/README.md). Jev
selects likely sections before a code-mode turn, bounded by
one second and a context byte cap; failure leaves the compact catalog available.
There is no runtime documentation helper. See the
[agent playbook](../../crates/agent_code_mode/SKILL.md).

```sh
bun run --cwd packages/code-mode-sdk generate
bun run --cwd packages/code-mode-sdk check:generated
bun run --cwd packages/code-mode-sdk type-check
bun run --cwd packages/code-mode-sdk test
```

Commit the generated `sdk.mjs`, `handlebars.mjs` and backend documentation JSON.
Real Deno integration tests live in `crates/code_execution`; public SDK entity
behavior is tested under `packages/sdk/tests`.
