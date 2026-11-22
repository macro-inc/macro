# Code-mode SDK bundle

## Scope

Packages the public Macro SDK and Handlebars for restricted Deno execution,
builds the agent documentation catalog, and bundles the JS tools interpreter
(`@opencode/codemode`) with its operation catalog and may-call analyzer.
Canonical TypeDoc rendering and the HTML worker belong to `packages/sdk-docs`.

## Start here

- `scripts/generate.ts`: builds the Deno bundles and backend documentation into
  the directory it is given; `crates/code_mode_assets` runs it at build time.
- `scripts/typedoc.ts`: index each entity and split linked Markdown into
  per-symbol references (classes, methods, types). Index fields retain lazy
  accessor call signatures and return types (`content(): Promise<string>`).
  Keep each index under 16 KiB using concise source TSDoc first sentences;
  preserve the [SDK's operating constraints](../sdk/AGENTS.md#gotchas) there and
  retain other details in following paragraphs. A discriminated union over
  the 16 KiB reference size, such as `EditOp`, lists its members, each read as
  `EditOp.<discriminator>`.
- `scripts/catalog.ts`: the entity directories agents discover, one topic per
  directory except tasks and task templates, which share the tasks topic.
  Jev routes the catalog in parallel 32-question calls, so its size is not capped.
- Each entity's description is its one `@routing` sentence ("Use when …; not
  …") and its `guide` every `@agent` block, both from the SDK's TSDoc and
  collected by `packages/sdk-docs/src/render.ts`. Generation fails for an
  entity without exactly one `@routing` sentence, or a tag outside every
  entity. Agents route on the sentence; the guide is how that area works,
  inlined into unrouted prompts and loaded with the entity on routed turns.
- `src/index.ts`: public SDK exports used by programs.
- `sdk-types.json` holds the SDK's declarations, which every program is
  type-checked against, and Handlebars' (`handlebars`), kept out of the
  fingerprint routines record. `@agent` examples of whole programs are fenced
  `typescript` and typed with `CodeContext`; `crates/agent_code_mode` checks
  each one.
- `crmEmailPrivacy` documents `macro.crm.emailPrivacy` separately from CRM records so both entity indexes stay within the 16 KiB bound; this changes neither the public namespace nor endpoint authorization.
- `src/js-tools/`: JS tools programs (README, "JS tools"). `catalog.ts`
  builds `js-tools.json` from the specs, the generated SDK and the permission
  registry; `analyze.ts` is the may-call analysis the permissions gate and
  every run use; `runtime.ts` gives the interpreter one tool per operation
  and refuses unanalyzed calls; `index.ts` is `js-tools.mjs`'s entry.
- The bundled SDK adds its hand-assigned display verb to each generated call
  when code mode enables the verb header in the bootstrap.
- Keep `generate.ts`'s `postReads` in step with
  `agent_correlation::scope::POST_READS`; the harness tests compare both catalogs,
  including rule validation and count previews. Policy activation remains a
  sharing write.

## Tool contracts

- External chat sends/uploads use only the credential owner's connection and accept their session or own API token (including signed agent attribution); bots never send. Pairing and account/access controls require the person's session.

## Checks

- Run root `just check` for formatting; CodeMode uses `apps/web/biome.jsonc`, while the standalone SDK has its own formatter.

- `bun run type-check` and `bun run test` (generates into ignored `dist/` first).
- `cargo test -p code_execution -- --include-ignored` runs the bundle in Deno.

Run from this directory after installing the root workspace and the standalone
`packages/sdk` dependencies with `bun install --frozen-lockfile`, as CI does;
the generator refuses to run without `packages/sdk/node_modules`.

## Gotchas

- The analyzer is sound only for what `@opencode/codemode` 2.3.2 has: no
  global object, `eval`, `Proxy`, `Reflect` or getters, and `require` as the
  one global that loads others. Upgrade it by bumping the exact version, then
  read the `interpreter-support.md` diff: every new global or binding form
  needs an analyzer rule before `pins.test.ts` is updated. Add a program to
  the corpus in `analyze.test.ts` for each new way to reach `tools`; each
  runs in the real interpreter, which must call nothing outside an `ok`
  answer.
- Our modules import Effect as `codemode-effect` (an alias of the version
  codemode pins), never `effect`, which is the web app's version; the bundle
  resolves both to codemode's copy. The web app pins its own `effect`
  exactly, so codemode's doesn't replace it in `bun.lock`.
- A new operation in the specs needs its registry line
  (`crates/agent_permission_registry`) or generation fails, unless the
  catalog skips it: one on the SDK's `Excluded` lists, or one a tool can't
  send or read, goes in `skipped` and has no registry line
  (`catalog.test.ts` pins both).

- The outputs are never committed. A new file the generator reads must be added
  to `GENERATOR_INPUTS` in `crates/code_mode_assets/build.rs` and to
  `codeModeAssetsSrc` in `nix/cloud-storage.nix`.
