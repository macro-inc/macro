# Code-mode SDK bundle

## Scope

Packages the public Macro SDK and Handlebars for restricted Deno execution and
builds the agent documentation catalog. Canonical TypeDoc rendering and the
HTML worker belong to `packages/sdk-docs`.

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
  directory except tasks, task templates and time tracking (`time`), which
  share the tasks topic.
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

- The outputs are never committed. A new file the generator reads must be added
  to `GENERATOR_INPUTS` in `crates/code_mode_assets/build.rs` and to
  `codeModeAssetsSrc` in `nix/cloud-storage.nix`.
