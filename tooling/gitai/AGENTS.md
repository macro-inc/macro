# gitai client tooling

## What it is

The engineer-side half of gitai-service (Macro's server for the open-source
git-ai client): the `gitai-enroll` script and the `gitai-why` agent skill it
installs. `README.md` is the human guide: enrolment steps, credentials, testing.

## Start here

- `gitai-enroll`: the steps, in the order the README lists them.
- `gitai-why/SKILL.md`: copied verbatim to `~/.claude/skills/` and `~/.codex/skills/`.

## Recipes

- Change the PR instruction line: edit `INSTRUCTION` in `gitai-enroll`; re-runs
  replace the block between the `gitai-enroll` markers.
- Bump the client: change `PINNED_VERSION` and `ACCEPTED_VERSIONS`, and the
  version the server pins in `/worker/releases`, together.

## Checks

- `nix shell nixpkgs#shellcheck -c shellcheck -x tooling/gitai/gitai-enroll`
- Run it with a scratch `HOME` against a local stub server (README "Test enrolment").

## Gotchas

- Bash 3.2 (stock macOS): no associative arrays, `mapfile` or `${var,,}`, and
  guard empty array expansions.
- Secrets reach curl only through `--config -` on stdin and reach config.json
  only through `jq --rawfile /dev/stdin` or `printf` redirection, never through argv; `change` prints
  its arguments under `--dry-run`.
- Never run `git-ai flush-metrics-db`: it uploads queued events without the
  `allow_repositories` gate.
- Every setting the script makes (`api_base_url`, `notes_backend.kind
  git_notes`, the allowlist, telemetry and update switches) must be in place
  before any credential is written. In managed mode (read-only or symlinked
  config.json) the script cannot set them, so `managed_missing_settings` checks
  each one and it refuses to mint until all pass; the credential goes only to
  `~/.git-ai/api-key.env`, which git-ai never reads by itself. Add a new setting
  to that check too.
- The server lowercases emails; compare emails case-insensitively.
- The read API, credential endpoints and metric names are fixed by
  gitai-service; keep the skill and the dashboard in step with it.
- Dashboard counters: wrap every `increase()` in the first-sample correction the
  README's Dashboard section describes, or new series undercount.
