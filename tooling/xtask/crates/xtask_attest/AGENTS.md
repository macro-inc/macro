# xtask_attest

## What it is

`cargo x attest`: runs `PR CI` jobs on a developer's machine and records each
pass as an `attested/<check>` commit status, so a requested `PR CI` run skips
those jobs.

## How it works

`run` builds the merge of `HEAD` with `main` in a checkout under
`~/.cache/macro-attest/`, reads `.github/attestable-checks.json` from that
merge, decides what `PR CI` would run (the caller's path filters, then each
workflow's `path-check`), runs each check's steps in the Nix dev shell, and
with `--post` posts `fp=<fingerprint> in=<digest> base=<sha>` for each pass.
With `--post` the base is the one in GitHub's merge commit for the open pull
request, and the local merge must be the same tree; `PR CI` accepts the status
for that base only.

## Start here

- `src/main.rs`: the order of decisions for one check, and what is posted.
- `src/runner.rs`: how a job's steps run, and what differs from a runner.
- `src/checkout.rs`: the merge checkout and why it is not a worktree.
- `src/github.rs`: what is asked of GitHub through `gh`.

## Scope

- Owns: running jobs locally, the path-filter emulation, the expression
  evaluator, the status that is posted.
- Not here: which jobs can be attested, their fingerprints, and what `PR CI`
  accepts → `xtask_workflows`' `attestation.rs` and `scripts/ci_gate.ts`.

## Checks

- `cargo test -p xtask_attest`
- After changing how steps run: `cargo x attest run conventions/ast-grep
  cloud-storage/graphql-schema-compat` on a commit (no `--post`).

## Gotchas

- Never guess: a context, function, action, shell or filter form the tool does
  not know is an error. A silent skip would attest a job that did not run.
- The inputs digest must stay byte-identical to `inputsDigest` in
  `accept_attested_checks.ts`; both tests pin the same value.
- Steps run `git fetch --depth` and write tracked files. The checkout is
  restored before every job, and takes its shallow boundary from the source.
- The checkout reads the source repository's objects through alternates:
  don't write refs or objects into the source from here.
- Run git through `checkout::in_repository`. A git hook exports `GIT_DIR`, and
  the checkout's forced restore would otherwise land in the developer's clone.

## Related

- Rules: `.agents/rules/infra/github-workflows.md` · Skills: `run-ci` ·
  Docs: `docs/development/ci.md`
