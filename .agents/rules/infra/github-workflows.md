---
description: "GitHub Actions workflows are written in Rust with the xtask_workflows generator, never as hand-written YAML."
paths:
  - ".github/workflows/**"
  - "tooling/xtask/crates/xtask_workflows/**"
globs: ".github/workflows/**,tooling/xtask/crates/xtask_workflows/**"
alwaysApply: false
---

# Write workflows in Rust with `cargo x workflows`

Workflow YAML is generated from Rust so jobs share typed runners, secrets, and
steps; hand-edited YAML drifts and fails CI's `cargo x workflows --check`.

- A new workflow is a module in `tooling/xtask/crates/xtask_workflows/src/workflows/`
  registered in `WORKFLOWS` (`workflows.rs`). Reuse `runners`, `vars`, and
  `steps` instead of inlining labels, env, or step definitions.
- The workflow model is our vendored `tooling/xtask/crates/gh_workflow`. When it
  can't express something, extend it there instead of patching rendered YAML.
- Build expressions with `gh_workflow::expr::typed` (`github()`, `needs()`,
  `steps()`, `input()`, ...). Rendering rejects any expression, raw or typed,
  that reads a context its key doesn't offer (e.g. `secrets` in a step `if:`).
- Never put an expression inside a `run` script or `actions/github-script`
  `script`: GitHub pastes it in as code. Set it in the step's `env` and read
  `"$NAME"` (shell) or `process.env.NAME` (JS); rendering rejects `${{` there.
- Give each job and step that anything refers to a `JobHandle` / `StepHandle`
  const next to its definition, with its outputs as `JobOutput<T>` /
  `StepOutput<T>` fields (`Flag` for `'true'`/`'false'` outputs). Use the handle
  for `add_job`, `needs`, `.id(..)`, declaring outputs and reading them, so a
  wrong name fails to compile. Rendering still fails when a job reads `needs.X`
  without listing X, reads an output X doesn't declare, or reads a step that
  hasn't run yet.
- Composite actions are modules in `workflows/composite/`, registered in
  `composite::ACTIONS`; `cargo x workflows` writes their `action.yml`. Call one
  through its generated `Local<Name>` type, and a reusable workflow through its
  generated `Call<Name>` type (both in `src/workflows/actions.rs`).
- Change a generated workflow (header `DO NOT EDIT`) by editing its source module,
  then run `cargo x workflows` and commit the regenerated YAML with it.
- `cargo x workflows` also writes `tooling/xtask/crates/xtask_workflows/checks.lock`:
  every check name, the required statuses (`CI gate`, `cla`), and the job names
  scripts read. A diff there is a rename GitHub or a script will notice; keep the
  required ones byte-identical.
- A change meant to be formatting-only (emitter, key order, expression spelling)
  must print `no semantic changes` from `cargo x workflows diff --base <rev>`.
- New CI scripts are Rust or TypeScript, never Python. A step with no checkout embeds
  its script with `include_str!` and runs it on the hosted image's Node.
- Every job `PR CI` runs is in one of two lists in `attestation.rs`: `CHECKS`,
  with the steps that are the check, or `NOT_ATTESTABLE`, with the reason. A
  new job goes in one of them or the tests fail. List it in `CHECKS` only when
  a machine can run it from a working tree: its check steps are plain scripts
  (no `if`, no expression in the script, no action) that leave tracked files
  alone, it needs no secrets, service containers or other operating system, no
  other job needs it, and the commit's files alone decide its verdict: not a
  ref such as `main`, the merge commit's parents, or anything fetched. A step you add
  to a listed job goes in its `steps`, or in `RUNNER_STEPS` when it only
  keeps a runner's caches. A listed job ends its condition with
  `attestation::not_attested(<id>)`, and its workflow declares the input with
  `attestation::takes_attestations`; generation fails when either is missing.
- Pin each third-party action to one SHA (CS-39) in
  `tooling/xtask/crates/xtask_workflows/actions.lock`, then run
  `cargo x workflows actions fetch` and `cargo x workflows`: use the action
  through its generated type in `src/workflows/actions.rs` (inputs are setters,
  outputs `StepOutput`s), never `Step::uses`.
- `check generated workflows` lints every workflow with actionlint (shellcheck
  on `run` scripts) and every workflow and composite action with zizmor. Fix a
  finding when the fix leaves what the job runs unchanged; otherwise allowlist
  it with its reason, one rule and file per entry: shellcheck in the
  `SHELLCHECK_IGNORES` table in `src/workflows/actionlint.rs` (which generates
  `.github/actionlint.yaml`), a zizmor finding on one step with
  `Step::zizmor_ignore` on that step, and any other zizmor finding in
  `.github/zizmor.yml`. A new runner label goes in `runners.rs`; the
  generated config picks it up from the workflows' `runs-on`.

Check: `cargo x workflows --check` passes, no `.github/workflows/*.yml` lacks
the generated header, `nix develop .#workflow-lint -c sh -c
'actionlint && zizmor --offline .github'` passes, and the
`rust-workflows-*` ast-grep rules report nothing.
