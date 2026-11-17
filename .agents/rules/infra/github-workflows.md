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
- A few older workflows are still hand-written YAML. When you change one
  substantially, port it to the generator instead of editing the YAML.
- Pin each third-party action to one SHA (CS-39); an action used in several
  places gets one `*_SHA` const in `steps.rs`, its release tag in the doc.
- `check generated workflows` lints every workflow with actionlint (shellcheck
  on `run` scripts) and every workflow and composite action with zizmor. Fix a finding when the fix leaves
  what the job runs unchanged; otherwise allowlist it with its reason, one
  rule and file per entry: shellcheck in `.github/actionlint.yaml` `paths:`,
  zizmor in `.github/zizmor.yml`, and for composite actions inline
  `# zizmor: ignore[rule] reason`. New runner labels go in
  `.github/actionlint.yaml`.

Check: `cargo x workflows --check` passes, no new `.github/workflows/*.yml`
lacks the generated header, and `nix develop .#workflow-lint -c sh -c
'actionlint && zizmor --offline .github'` passes.
