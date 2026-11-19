# xtask_attest

## What it is

`cargo x attest`: runs `PR CI` checks in the working tree, records each result
for the files the check read, and posts the passes that apply to a pull
request as `attested/<check>` commit statuses, so a requested `PR CI` run
skips those jobs.

## How it works

`run` reads `.github/attestable-checks.json` from `HEAD`, runs each check's
scripts in the Nix dev shell, and writes a receipt keyed by the check's
fingerprint and the hash of its inputs in `HEAD`. `post` asks GitHub for the
pull request's merge commit, hashes each check's inputs there, and posts
`fp=<fingerprint> src=<hash>` for every receipt that matches.

## Start here

- `src/main.rs`: `list`, `run` and `post`, and what `post` decides per check.
- `src/inputs.rs`: the hash a pass is recorded for.
- `src/runner.rs`: how a script runs: directory, environment, dev shell.
- `src/receipts.rs`: where results are kept between `run` and `post`.
- `src/github.rs`: what is asked of GitHub through `gh`.

## Scope

- Owns: running a check's scripts, the receipts, the inputs hash, what is
  posted.
- Not here: which jobs can be attested, their scripts, inputs and
  fingerprints, and what `PR CI` accepts → `xtask_workflows`' `attestation.rs`
  and `scripts/ci_gate.ts`.

## Checks

- `cargo test -p xtask_attest`
- After changing how scripts run: `cargo x attest run conventions/ast-grep
  infra/check` on a clean tree.

## Gotchas

- This is not a GitHub Actions runner and must not become one. The generator
  refuses a check whose steps need a condition, an expression or an action;
  fix the step or move the job to `NOT_ATTESTABLE`, never teach the tool.
- The inputs hash must stay byte-identical to `inputsHash` in `ci_gate.ts`;
  both tests pin the same value.
- A receipt is for committed files: `run` records nothing when a check's
  inputs have uncommitted changes, or when the check itself changed them.
- Run git through `git::in_repository`. A git hook exports `GIT_DIR`, and git
  would otherwise act on the repository the hook names.

## Related

- Rules: `.agents/rules/infra/github-workflows.md` · Skills: `run-ci` ·
  Docs: `docs/development/ci.md`
