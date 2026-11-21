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

- `cargo test -p xtask_workflows -p gh_workflow`
- `cargo x workflows --check`; `cargo x workflows diff --base <rev>` for a change
  meant to keep behaviour (prints `no semantic changes`).
- `nix develop .#workflow-lint -c sh -c 'actionlint && zizmor --offline .github'`

## Gotchas

- Never edit `src/workflows/actions.rs` or anything under `.github/` it
  generates; `--check` fails.
- Long shell scripts go in `.sh` files via `include_str!`: rustfmt re-indents
  `\`-continued lines inside string literals on every run.
- `checks.lock` diffs are check renames GitHub or our gate scripts will notice.

## Related

- Rules: `.agents/rules/infra/github-workflows.md`
