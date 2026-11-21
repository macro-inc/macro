# xtask_attest

## What it is

`cargo x attest`: runs `PR CI` checks in the working tree, records each result
for the git tree it ran on, and posts the passes that apply to a pull request
as `attested/<check>` commit statuses, so a requested `PR CI` run skips those
jobs.

## How it works

`run` reads `.github/attestable-checks.json` from `HEAD`, runs each check's
scripts in the Nix dev shell, and writes a receipt keyed by the check's
fingerprint and `HEAD`'s tree. `post` asks GitHub for the pull request's merge
commit and posts `fp=<fingerprint> tree=<tree>` for every receipt recorded for
that commit's tree.

## Start here

- `src/main.rs`: `list`, `run` and `post`, and what `post` decides per check.
- `src/tree.rs`: the tree a pass is recorded for.
- `src/runner.rs`: how a script runs: directory, environment, dev shell.
- `src/receipts.rs`: where results are kept between `run` and `post`.
- `src/github.rs`: what is asked of GitHub through `gh`.

## Scope

- Owns: running a check's scripts, the receipts, what is posted.
- Not here: which jobs can be attested, their scripts and fingerprints, and
  what `PR CI` accepts → `xtask_workflows`' `attestation.rs` and
  `scripts/ci_gate.ts`.

## Checks

- `cargo test -p xtask_attest`
- After changing how scripts run: `cargo x attest run conventions/ast-grep
  infra/check --again` on a clean tree.

## Gotchas

- This is not a GitHub Actions runner and must not become one. The generator
  refuses a check whose steps need a condition, an expression or an action;
  fix the step or move the job to `NOT_ATTESTABLE`, never teach the tool.
- A pass is for the whole tree. Don't key it to the paths that trigger a job:
  they are not everything the job reads.
- A receipt is for committed files: `run` records nothing when the working
  tree has uncommitted changes, or when the check itself changed a file.
- Steps use the caller's `TMPDIR`, and the tool never removes it. A dev
  shell's environment makes a temporary directory every time a shell starts
  and never removes it, which runs a shared `/tmp` out of inodes, so the tool
  appends lines that remove it and point every shell at the one directory.
  Don't give steps a directory the tool deletes: a server a step starts
  (sccache) outlives the run and serves every build on the machine from it.
- Run git through `git::in_repository`. A git hook exports `GIT_DIR`, and git
  would otherwise act on the repository the hook names.

## Related

- Rules: `.agents/rules/infra/github-workflows.md` · Skills: `run-ci` ·
  Docs: `docs/development/ci.md`
