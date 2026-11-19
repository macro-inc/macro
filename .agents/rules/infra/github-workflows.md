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
- New CI scripts are Rust or TypeScript, never Python. A step with no checkout embeds
  its script with `include_str!` and runs it on the hosted image's Node.
- Every job `PR CI` runs is in one of two lists in `attestation.rs`: `CHECKS`,
  with the steps that are the check, or `NOT_ATTESTABLE`, with the reason. A
  new job goes in one of them or the tests fail. List it in `CHECKS` only when
  a machine can run it from a working tree: its check steps are plain scripts
  (no `if`, no expression in the script, no action) that leave tracked files
  alone, it needs no secrets, service containers or other operating system, no
  other job needs it, and the tree alone decides its verdict. A step you add
  to a listed job goes in its `steps`, or in `RUNNER_STEPS` when it only
  keeps a runner's caches.
- A few older workflows are still hand-written YAML. When you change one
  substantially, port it to the generator instead of editing the YAML.

Check: `cargo x workflows --check` passes and no new `.github/workflows/*.yml`
lacks the generated header.
