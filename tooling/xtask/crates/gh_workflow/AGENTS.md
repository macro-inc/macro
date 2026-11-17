# gh_workflow

## What it is

The typed model of a GitHub Actions workflow that `xtask_workflows` builds and
serializes into `.github/workflows`. Vendored from
[tailcallhq/gh-workflow](https://github.com/tailcallhq/gh-workflow) 0.8.1
(commit `ef51106c4c4152f595dc6d18295d78a5ca3c54f9`, Apache-2.0, see `NOTICE`).
We own it now: change it here instead of patching rendered YAML in
`xtask_workflows`.

## Start here

- `src/workflow.rs`: `Workflow`, `Jobs`, and serialization.
- `src/job.rs`, `src/step.rs`, `src/event.rs`: jobs, steps, and triggers.
- `src/expr.rs`: expressions: the AST, `parse`, the canonical spelling, and
  `check`. `expr/typed.rs` builds them with types; `expr/scope.rs` is
  GitHub's context availability table.
- `src/action.rs`: `CompositeAction`, rendered as an `action.yml` with the
  same checks against the contexts an action's steps can read.
- `src/references.rs`: the job/step reference checks every rendered
  workflow (needs, outputs, step ids, cycles) and composite action (shell on
  `run` steps, step order) passes.
- `src/yaml.rs`: our YAML emitter; its fixed style is what every generated
  workflow looks like.

## Scope

- Owns: the workflow data model and its YAML output.
- Not here: our workflows, runners, and shared steps → `../xtask_workflows`.

## Boundaries

- Used by: `xtask_workflows` only.

## Checks

- `cargo test -p gh_workflow -p xtask_workflows`
- `cargo x workflows --check`; a change meant to keep output identical must also
  print `no semantic changes` from `cargo x workflows diff`.

## Gotchas

- Keep `LICENSE` and `NOTICE`; Apache-2.0 requires them for the derived code.
- Every serialized field must be a real GitHub key; anything else renders YAML
  GitHub rejects.
- Rendering a workflow parses every `${{ }}` (and bare `if:`), fails on an
  unknown context or function or one its key doesn't offer, and re-spells it
  canonically, so raw text and the typed builders render the same bytes.
- A change to `src/yaml.rs` rewrites every workflow file: it must keep
  `strings_read_back_unchanged` passing and `cargo x workflows diff` empty.

## Related

- Rules: `.agents/rules/infra/github-workflows.md`
