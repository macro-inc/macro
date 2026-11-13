# gitai-service: first deploy and pilot

gitai-service is Macro's server for the open-source git-ai client, on the product
gateway at `/gitai`. Code: `services/gitai_service`, `crates/gitai`; stack:
`infra/stacks/gitai-service`; client tooling (`gitai-enroll`, the agent skill) and the dashboard
ship separately in `tooling/gitai/` and `infra/stacks/observability`. Agents never run
these steps; a person does.

## Before the first deploy

1. **Doppler values.** In project `gitai-service`, configs `dev` and `prd`:
   - `GITAI_SHARED_KEY`: a new random secret per config, e.g. `openssl rand -base64 48`.
     It mints device credentials and never goes on a laptop.
   - `GITHUB_TOKEN` (optional): a token that reads public repositories only: a fine-grained PAT with
     "Public repositories (read-only)" and no other permissions, or a classic PAT with no
     scopes. Without it, commit and PR lookups run unauthenticated (60 GitHub requests an
     hour) and `GET /v1/blame` answers 501 `blame_needs_github_token`.
   - `GITAI_EVENTS_BUCKET`, `GITAI_SESSIONS_BUCKET`, `GITAI_TABLE` are written by the
     stack itself (Pulumi `doppler.Secret`); don't create them by hand.
   - Add the same keys to `local/lcl_personal` if it isn't already done.
2. **Doppler project.** Deploy `infra/stacks/doppler-projects` (dev and prod) so the
   `gitai-service` project and its Secrets Manager sync exist.
3. **Pulumi Doppler token.** The stack writes the infra-produced names into Doppler,
   so each stack needs `doppler:dopplerToken` as secure config:
   `cd infra/stacks/gitai-service && pulumi config set --secret doppler:dopplerToken <token> -s dev`
   (and `-s prod`), with a Doppler token that can write the `gitai-service` project.
4. **First deploy.** Remove `"bootstrap_pending"` from `gitai-service` in
   `.github/services-config.json` and merge; the next push to `main` deploys dev.
   (Or dispatch `deploy-service-generic.yml` with `gitai-service` / `dev`.)
   Prod follows the next release. Stateful resources (buckets, KMS keys, table) are
   `protect`ed in prod.
5. **Check dev.** `curl https://dev-gateway.macro.com/gitai/health` → 200. Mint a
   test credential with the dev shared key (`POST /gitai/v1/credentials`), point a
   scratch client at dev (see `tooling/gitai/README.md`), confirm objects land.
6. **Dashboard.** The "AI authorship" dashboard is provisioned by the observability
   host; it appears after the next `infra/stacks/observability` deploy.

## Pilot (Eric on big-pickle)

1. Prune the local backlog first: stop the daemon, then delete or move
   `~/.git-ai/internal/metrics-db` so 22 days of queued events (about 4 GB, including
   other repos' transcripts held locally) are not uploaded. Never run
   `git-ai flush-metrics-db`: it bypasses `allow_repositories`.
2. big-pickle's `~/.git-ai/config.json` is Home Manager managed. Run
   `doppler run -p gitai-service -c prd -- tooling/gitai/gitai-enroll`; it prints the
   non-secret keys for Home Manager (`api_base_url`, `telemetry_oss`,
   `disable_auto_updates`, `disable_version_checks`, `notes_backend.kind = git_notes`,
   `allow_repositories`) and stops. Apply them with `nixos-rebuild`, re-run, and it
   mints a credential into `~/.git-ai/api-key.env` (read as `GIT_AI_API_KEY`; add it
   to the daemon's environment as it prints).
3. Check: `GET /gitai/v1/whoami` returns your email; after a commit in a scratch
   branch, `git-ai whoami` shows no undelivered events.
4. Team rollout after a week of clean data: each engineer runs `gitai-enroll`.

## Operating

- List and revoke credentials with the shared key: see `tooling/gitai/README.md`.
- Delete a person's or session's transcripts with an S3 prefix delete in
  `gitai-sessions-<stack>` (`sessions/tool=<tool>/sid=<id>/`); transcripts expire after 180 days.
