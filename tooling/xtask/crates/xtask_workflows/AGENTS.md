# xtask_workflows

## What it is

`cargo x workflows`: every GitHub Actions workflow and composite action in
`.github/`, written in Rust on the vendored `../gh_workflow` model and rendered
to YAML, plus the files derived from them (`checks.lock`,
`.github/actionlint.yaml`, the typed bindings in `src/workflows/actions.rs`).

## Start here

- `src/workflows.rs`: the `WORKFLOWS` list, generate and `--check`.
- `src/workflows/steps.rs`, `vars.rs`, `runners.rs`: shared steps, secrets and
  vars, runner labels.
- `src/workflows/composite.rs`: our composite actions (`ACTIONS`).
- `src/actions.rs`: `actions.lock`, `actions fetch`, and the generator of
  `src/workflows/actions.rs` (`<Owner><Repo>`, `Local<Name>`, `Call<Name>`).

## Recipes

- Add a workflow: a module in `src/workflows/`, an entry in `WORKFLOWS`, then
  `cargo x workflows`.
- Add a third-party action: a line in `actions.lock`, then
  `cargo x workflows actions fetch` and `cargo x workflows`.
- Change an action's or reusable workflow's inputs: run `cargo x workflows`
  once before callers use the new setter (bindings come from the rendered files).

## Checks

- `just check`, `just pr-privacy`
- `cargo test -p xtask_workflows -p gh_workflow`
- `cargo x workflows --check`; `cargo x workflows diff --base <rev>` for a change
  meant to keep behaviour (prints `no semantic changes`).
- `nix develop .#workflow-lint -c sh -c 'actionlint && zizmor --offline .github'`

## Gotchas

- Keep conformance replay and session-contract checks local. The existing Rust
  check job enforces vendor parity and deployed-server Loro feature isolation
  on their input paths, with 30 minutes when guarded and 20 otherwise.
  Server-upstream and differential suites remain local.
- Preserve native WASM builds before web session tests, decorator typechecking,
  and the native lazy-bundle guard in their existing owning jobs.
- Keep deployment/production access out of local conformance checks and scope
  any future-path exceptions to their exact filter group and spec.
- Run the resolved native editor feature-graph guard before lexical/session compilation; production closures exclude compatibility/foreign-node features while explicit compatibility web remains a positive control.
- Keep the web Typecheck job free of the removed standalone facade (`typecheck_excludes_the_deferred_lexical_facade`).
- Build agent-fold and the production document-session WASM before web unit-test shards; package tests must not depend on external artifact manifests.
- Clear prior result artifacts before accepting per-pipeline coverage evidence.
- Keep reusable-workflow permissions within the caller's permissions.
- Use `if_condition` for step conditions and `cond` for job conditions.
- Never edit `src/workflows/actions.rs` or anything under `.github/` it
  generates; `--check` fails.
- Long shell scripts go in `.sh` files via `include_str!`: rustfmt re-indents
  `\`-continued lines inside string literals on every run.
- `checks.lock` diffs are check renames GitHub or our gate scripts will notice.

## Related

- Rules: `.agents/rules/infra/github-workflows.md`
