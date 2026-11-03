# Build SDK artifacts instead of committing them

Status: proposal; the build migration is not implemented.

Generate the Deno bundles, agent catalogs and public SDK reference during builds,
then embed or publish those outputs. Keep the SDK source, JSDoc, handwritten
guides, generator code and lockfiles in Git. Removing minification alone reduces
diff noise but leaves the regenerate-and-commit workflow in place.

## What causes the churn

At repository revision `78cb07918f0c46eb8fee77a1d4cdefa2c19a6333`:

| Committed output | Size | Producer and consumer |
| --- | --- | --- |
| `crates/code_execution/src/outbound/deno/sdk.mjs` | 380,123 bytes in 62 lines | Code-mode generator; embedded by `code_execution` |
| `crates/code_execution/src/outbound/deno/handlebars.mjs` | 88,862 bytes | Same generator and consumer |
| `crates/agent_code_mode/src/domain/documentation.json` | 1,230,391 bytes | TypeDoc packaging; embedded by `agent_code_mode` |
| `crates/agent_code_mode/src/domain/operations.json` | 38,325 bytes | SDK operation enumeration; embedded by `agent_code_mode` |
| `packages/sdk-docs/reference/**/*.md` | 5,480 files, 3,657,449 bytes | TypeDoc; checked-in copy of public reference |

The [code-mode generator](../../packages/code-mode-sdk/scripts/generate.ts)
enables all Bun minification and compares output bytes in `--check` mode. Its
[package guide](../../packages/code-mode-sdk/AGENTS.md) already warns that Bun
versions and stale standalone SDK dependencies change minified names. Unrelated
SDK edits can therefore touch the same long generated lines.

The [reference generator](../../packages/sdk-docs/scripts/generate.ts) renders
Markdown and HTML, then either copies Markdown into `reference/` or checks every
path and byte against that committed copy. Web CI runs both packages' stale-output
checks. A branch must regenerate after integrating upstream SDK changes, even
when its handwritten change is already correct.

The four latest commits inspected in [#8850](https://github.com/macro-inc/macro/pull/8850)
(`8e35749588`, `0a3578b29d5`, `68f4c09475`, `66ef7f6f42`) all change `sdk.mjs`.
They also contain integration changes; they are not four SDK-only commits. The
repeated bundle updates demonstrate the maintenance cost without establishing
that every update was caused by a toolchain mismatch.

## Recommended build contract

```text
SDK TypeScript + generated clients + JSDoc + locked dependencies
              + code-mode packaging + authored docs
                              |
                    pinned artifact build
                              |
              +---------------+----------------+
              |               |                |
       sdk/handlebars     documentation/    Markdown + HTML
          bundles        operations JSON      reference
              |               |                |
       code_execution   agent_code_mode    docs publishing
          OUT_DIR           OUT_DIR         ignored dist/
              +---------------+
                    Rust binaries
```

1. Refactor the existing generators to accept an explicit output directory and
   select runtime, catalog or all outputs. Preserve the existing bundler plugin
   that excludes local port discovery. Let each invocation own its temporary
   TypeDoc directory so parallel Cargo builds and docs tests cannot delete one
   another's output. Keep `renderSdkDocs` as the single renderer.
2. Add a cached Nix artifact derivation with pinned Bun and frozen dependencies.
   Its inputs include SDK source and generated clients, the two packaging/docs
   packages, authored docs, relevant manifests, both root and standalone SDK
   lockfiles, TypeScript configuration, and the toolchain pin. The SDK is outside
   the root workspace: installing only root dependencies is insufficient.
3. Add small build scripts to the two Rust consumers. In Nix builds, copy the
   required artifacts from an explicit immutable derivation path into each
   crate's `OUT_DIR`. For ordinary local Cargo builds, invoke the same generator
   for that crate's outputs using already-installed dependencies. Declare all
   source/configuration inputs and the selected artifact path for Cargo rebuilds;
   fail clearly on missing prerequisites or generator errors. Never install
   packages, fetch schemas or write into `src/` from `build.rs`.
4. Change Rust's `include_str!` calls to embed from `OUT_DIR`. The running service
   still needs only its binary and Deno; SDK loading remains offline and tied to
   the deployed revision. Preserve minification for shipped bundles. An optional
   readable local artifact can help debugging without becoming a Git input.
5. Make `sdk-docs` build and test only ignored `dist/docs/{markdown,html}`. Its
   Wrangler build already supports this. Point contract tests at fresh Markdown;
   remove the committed-reference comparison, retain link/signature/visibility
   assertions, and publish CI artifacts when reviewers need rendered output.

Cargo recommends writing generated files under `OUT_DIR` and declaring rebuild
inputs through `rerun-if-changed` and `rerun-if-env-changed`; see the
[Cargo build-script contract](https://doc.rust-lang.org/cargo/reference/build-scripts.html).
Do not pin a local shell to an old artifact path after SDK edits: ordinary local
builds must regenerate from the worktree, while the prebuilt path is for an
explicit build of an immutable source revision.

## Build integration that must land with removal

| Area | Required change |
| --- | --- |
| [Nix Rust builds](../../nix/cloud-storage.nix) | Supply the artifact derivation to full-workspace builds and deploy closures containing either consumer. The current Rust source filter excludes TypeScript, and pruned deploy sources contain only Cargo dependency closures. Keep artifact inputs separate from that filter and avoid invalidating unrelated service builds. Verify Crane dependency-only builds still work. |
| [Docker service build](../../docker/Dockerfile) and [context](../../.dockerignore) | Add a pinned artifact builder stage and make its required package sources available; the current context excludes all `packages/`. Pass its outputs into Cargo. Keep Bun and JavaScript build dependencies out of the final runtime image. |
| Local builds | Document the frozen root and standalone SDK installs, or provide equivalent dependencies through Nix. Cover direct Cargo checks/tests as well as the local-stack builder; no manual regeneration or tracked output should be needed after an SDK edit. |
| [Rust CI](../../tooling/xtask/crates/xtask_workflows/src/workflows/code_check_cloud_storage.rs) | Install/provide build prerequisites, update the asset check, and trigger affected Rust tests for SDK source, generator, documentation and dependency changes. The current top-level path gate does not include `packages/`. |
| [Test selection](../../tooling/xtask/crates/xtask_nextest_filter/determinator.toml) | Map artifact inputs to both Rust consumers and their reverse dependencies; opening the workflow gate alone does not select the relevant tests. |
| [Web CI](../../tooling/xtask/crates/xtask_workflows/src/workflows/web_app_check_main.rs) | Build fresh artifacts before documentation/catalog tests; remove comparisons against deleted outputs. Preserve generated OpenAPI/client checks. Edit workflow generators and regenerate YAML. |

Build only from the already-generated SDK clients in the checkout. The artifact
build must not regenerate OpenAPI by compiling Rust services: those services
depend on these artifacts, which would create a build cycle. Keep the existing
OpenAPI/client freshness gate as a separate check.

Once these paths pass from a clean checkout, remove the five output groups above
from Git and ignore any remaining local destinations. Update the SDK, SDK-docs,
code-mode, Rust consumer and infrastructure guides, the SDK README reference link,
and relevant generation instructions in the same implementation. Keep authored
Markdown, source comments, OpenAPI specs and generated TypeScript clients tracked;
their build contract is outside this migration.

## Alternatives

| Approach | Assessment |
| --- | --- |
| Generate during builds | Recommended. Removes these merge conflicts and lets CI validate artifacts built from the integrated source revision. Adds explicit JavaScript build dependencies to the affected Rust builds. |
| Commit unminified bundles | Useful temporary relief if the build migration must wait. `minify: false` removes identifier and whitespace compression, but bundler changes and the checked-in catalogs/reference still cause regeneration commits. |
| Git merge driver or always keep one side | Reject. Either a local-only driver must be configured everywhere, or a merge can select an SDK/catalog that disagrees with the source. Regeneration would still be necessary. |
| Hide generated files in PR diffs | Presentation only. `reference/**` already has `linguist-generated=true`; it does not change Git's merge behavior or CI checks. |

Bun exposes separate whitespace, identifier and syntax minification switches;
disabling all three is the simplest temporary readable output. See
[Bun's minification options](https://bun.sh/docs/bundler#minify). This changes diff
quality, not the source-of-truth problem.

## Acceptance criteria for the implementation

- A clean checkout with the documented prerequisites builds both Rust consumers,
  the agent-harness deployment artifact and the Docker image without tracked
  generated SDK outputs, and leaves `git status` clean.
- Editing an SDK method, a JSDoc comment, generator logic or a dependency lockfile
  rebuilds the affected runtime/catalog/reference without manual regeneration;
  repeated unchanged builds reuse artifacts.
- A branch that changes only SDK TypeScript selects the relevant Rust checks and
  real Deno execution tests. The generated documentation retains linked types,
  public runtime exports, and the existing discovery topic/size limits.
- Nix builds succeed with network access disabled after dependency fetching, on
  supported build hosts, and unrelated service artifacts retain their cache keys.
- Concurrent builds use isolated outputs; a failed generation cannot silently
  reuse a previous bundle or catalog.
- Merging independent SDK edits requires resolving source conflicts only; fresh
  artifacts are built and tested from the merged source.

This investigation inspected the producers, consumers, build filters, checks and
PR history. It did not implement or execute the proposed build pipeline; the
criteria above remain requirements for that implementation.
