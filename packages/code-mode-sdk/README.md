# Code-mode dependencies and documentation

This build package bundles the actual public `@macro-inc/sdk` and Handlebars for
Deno. It adds no tool-name proxy or alternate API. Nested namespaces, entity
handles, promises and async iterators retain the public SDK implementation.

The agent supplies a TypeScript ES module exporting
`async main(context: CodeContext)`, type-checked against `sdk-types.json` (the
SDK's declarations plus Handlebars') before it runs. The trusted bootstrap
provides authenticated `macro`, `session`, and `execution` handles plus
`token`, `hosts`, `sessionId` and `executionId`. Explicit imports from
`@macro-inc/sdk` and `handlebars` resolve to local build artifacts; no downloads
happen during a run, and Deno strips the types. SDK local portmap discovery is
removed from the bundle because service hosts are supplied by the harness.

The harness mints a Macro API JWT for the owner, lasting 60 seconds, after the
session's execution approval policy permits the run. Its signed agent identity comes from
the authenticated session. SDK messages use that agent as sender and record the
owner as `triggered_by`; other SDK endpoints retain normal user authentication.
External chat reads, sends and media uploads use the credential owner's own
provider connection. Owner API tokens can send, including signed agent-attributed tokens;
bot credentials never send. Pairing and account/access controls require the person's
bearer session.
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
hierarchy and an HTML site from one reflection model. The backend catalog is built from those Markdown pages: an index per entity
(classes, methods with signatures, and types, by symbol) and a reference per
symbol, each class split into its own methods, with links rewritten to the
symbols they name. Wire types an entity reaches are included as symbols; a name
two pages share is qualified by its service or entity (`storage.Message`).
Discovery uses at most 32 topics; agent and host setup share a topic, as do
native channels, external chats and WhatsApp. New SDK
services must also be registered in the generated operation-label catalog.
There is no separate declaration parser. Private, protected and internal members
are excluded. `DescribeCodeTools` provides the compact catalog, entity indexes and workflow
guides; `ReadCodeDocs` provides symbol references. See [documentation hosting](../sdk-docs/README.md). Jev
selects likely entity indexes before a code-mode turn, bounded by
one second and a context byte cap; failure leaves the compact catalog available.
There is no runtime documentation helper. See the
[agent playbook](../../crates/agent_code_mode/SKILL.md).

```sh
bun run --cwd packages/code-mode-sdk generate   # writes the assets to dist/
bun run --cwd packages/code-mode-sdk type-check
bun run --cwd packages/code-mode-sdk test
```

## JS tools

`js-tools.mjs` runs JS tools programs (`crates/code_execution`,
`Language::JsTools`) in `@opencode/codemode`'s interpreter, pinned to exactly
2.3.2 with the acorn it parses with. Its catalog, `js-tools.json`, has one
tool per spec operation the TypeScript SDK exposes and can send, at
`tools.<service>.<operationId>`: the spec name with `-` written `_`, then the
raw operationId, so the path is the permission registry's key. A service
that declares one operationId on two routes gets `<operationId>_2` for the
second. Each tool's input is its generated method's `{ path?, query?, body? }`;
its description starts with its registry group, action and label. Operations
on the SDK's `Excluded` lists (`packages/sdk/src/coverage/skipped.ts`), and
those a tool can't send or read (no TypeScript client, a required header, a
non-JSON body or response), are listed in `skipped` with the reason. `js-tools.fingerprint` is
`@opencode/codemode@<version>+<hash of the bundle and catalog>`.

`analyze(source, toolsByPath(catalog))` answers what a program may call, in
`macro_sdk_calls --json`'s shape (`ok` with operations, each with its route
and route rivals; `cannot_analyze` with located reasons; `diagnostics` for a
parse failure). Upstream's `scanTools` misses calls (an aliased `require`,
a parameter default beside a body `var`), so the analyzer has its own rules:

- module loading is refused: `import` in every form and `require` anywhere
  it is a reference or binding;
- `tools` is never bound or shadowed, and every reference is two static
  member accesses (`.name` or `["name"]`, optional chaining allowed) naming
  a catalog operation, called directly; its result is JSON;
- `search(...)` is free: it returns data and calls nothing;
- upstream's scan must agree: a parse only one parser accepts, or a path it
  finds that we don't, is refused.

That is sound because the interpreter has no global object, `eval`,
`Function` (it throws), `Proxy`, `Reflect`, getters or extensions: its only
way to an SDK call is the `tools` namespace, reached by name or loaded by
`require`/`import`. `makeRuntime` gives the interpreter every tool and a
`tool.before` hook that refuses any outside the analyzed set; the bootstrap
supplies the function that sends each call. `analyze.test.ts` runs every
corpus program in the real interpreter and checks it calls nothing the
analysis didn't report; `pins.test.ts` fails an upgrade that changes the
interpreter's globals or versions.

The generated `sdk.mjs`, `handlebars.mjs`, `documentation.json`,
`operations.json` (each SDK operation's label, method, path and whether it
writes), `hosts.json` (every service the SDK can reach, with its host in each
environment) and `sdk-types.json` (the SDK's declarations routine code is
type-checked against, with their fingerprint), `js-tools.mjs`,
`js-tools.json` and `js-tools.fingerprint` are build outputs, never
committed. `crates/code_mode_assets`
builds them when it compiles: local cargo runs `scripts/generate.ts` with bun,
and Nix builds and Rust CI use the `code-mode-assets` flake package through
`CODE_MODE_ASSETS_DIR`. See that crate's `AGENTS.md`.
Real Deno integration tests live in `crates/code_execution`; public SDK entity
behavior is tested under `packages/sdk/tests`.
