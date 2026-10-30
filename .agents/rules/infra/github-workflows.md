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
- Change a generated workflow (header `DO NOT EDIT`) by editing its source module,
  then run `cargo x workflows` and commit the regenerated YAML with it.
- A few older workflows are still hand-written YAML. When you change one
  substantially, port it to the generator instead of editing the YAML.

Check: `cargo x workflows --check` passes and no new `.github/workflows/*.yml`
lacks the generated header.
