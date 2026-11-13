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
- Bump the client: change `PINNED_VERSION`, and the version the server pins in
  `/worker/releases`, together.

## Checks

- `nix shell nixpkgs#shellcheck -c shellcheck -x tooling/gitai/gitai-enroll`
- Run it with a scratch `HOME` against a local stub server (README "Test enrolment").

## Gotchas

- Bash 3.2 (stock macOS): no associative arrays, `mapfile` or `${var,,}`, and
  guard empty array expansions.
- Secrets reach curl only through `--config -` on stdin and reach config.json
  only through `jq --rawfile /dev/stdin`, never through argv; `change` prints
  its arguments under `--dry-run`.
- `api_base_url` must be set before any credential is written.
- The read API, credential endpoints and metric names are fixed by
  gitai-service; keep the skill and the dashboard in step with it.
