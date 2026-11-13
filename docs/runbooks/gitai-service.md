# gitai-service: first deploy and pilot

gitai-service is Macro's server for the open-source git-ai client, on the product
gateway at `/gitai`. Code: `services/gitai_service`, `crates/gitai`; stack:
`infra/stacks/gitai-service`. The client enrolment script and agent skill live in
`tooling/gitai/`, the dashboard in `infra/stacks/observability`. Agents never run
these steps; a person does.

## Before the first deploy

Do these in order.

1. **Doppler project.** Deploy `infra/stacks/doppler-projects` (it has one stack,
   `prod`, which creates the `gitai-service` project with `dev` and `prd` configs
   and their Secrets Manager sync).
2. **Doppler values**, in `gitai-service` `dev` and `prd`:
   - `GITAI_SHARED_KEY`: a new random secret per config (`openssl rand -base64 48`).
     It mints device credentials and never goes on a laptop.
   - `GITHUB_TOKEN`: a token that reads public repositories only (a fine-grained
     token with "Public repositories (read-only)" and no other permissions, or a
     classic token with no scopes). The service starts without it, but then squash
     lookups share 60 unauthenticated GitHub requests an hour with everything
     behind the VPC's NAT address, and `GET /v1/blame` answers 501. Treat it as
     required for real use.
   - `GITAI_EVENTS_BUCKET`, `GITAI_SESSIONS_BUCKET` and `GITAI_TABLE` are written
     by the stack itself on its first deploy (Pulumi `doppler.Secret`); don't
     create them by hand.
   - Add `GITAI_SHARED_KEY` and `GITHUB_TOKEN` to `local/lcl_personal` too.
3. **Pulumi Doppler token.** The stack writes those three names into Doppler, so it
   needs a Doppler token that can write the `gitai-service` project:
   `cd infra/stacks/gitai-service && pulumi config set --secret doppler:dopplerToken <token> -s dev`,
   and the same with `-s prod`. This edits `Pulumi.dev.yaml` and `Pulumi.prod.yaml`;
   commit both files and merge them (CI deploys from the repo).
4. **First deploy.** Remove `"bootstrap_pending"` from `gitai-service` in
   `.github/services-config.json` and merge; the next push to `main` deploys dev
   (or dispatch `deploy-service-generic.yml` with `gitai-service` and `dev`).
   Prod follows the next release. Buckets, KMS keys and the table are `protect`ed
   in prod.
5. **The Doppler config check until prod deploys.** `GITAI_EVENTS_BUCKET`,
   `GITAI_SESSIONS_BUCKET` and `GITAI_TABLE` reach `prd` only with the first prod
   deploy. Until then, a PR that changes `services/gitai_service/src/config.rs`
   or `doppler_config.rs` fails the `doppler-config` check against `prd`; hold such
   changes until prod has deployed.
6. **Check dev.** `curl https://dev-gateway.macro.com/gitai/health` returns 200.
   Mint a test credential with the dev shared key (`POST /gitai/v1/credentials`),
   point a scratch client with its own `HOME` at dev, make a commit in a clone of
   `macro-inc/macro`, and confirm objects land in `gitai-events-dev`.
7. **Dashboard.** After the dashboard change merges, run the Deploy Observability
   workflow; the "AI authorship" folder appears in Grafana after that deploy.

## Pilot on one machine

1. Prune the machine's local backlog first: stop the daemon (`git-ai bg shutdown`)
   and move `~/.git-ai/internal/metrics-db` aside, so events queued before
   enrolment (including other repos' transcripts held locally) are not uploaded.
   Never run `git-ai flush-metrics-db`: it bypasses `allow_repositories`.
2. Run `doppler run -p gitai-service -c prd -- tooling/gitai/gitai-enroll`. On a
   machine whose `~/.git-ai/config.json` is managed by Home Manager, it prints the
   non-secret keys to put in that config and stops; apply them, re-run, and it
   mints a credential into `~/.git-ai/api-key.env`, read as `GIT_AI_API_KEY`
   (add it to the daemon's environment as the script prints).
3. Check: the script's `GET /v1/whoami` returns your email, and after a commit
   `git-ai whoami` shows no undelivered events.

## Team rollout

After a week of clean data:

1. Give each engineer read access to Doppler `gitai-service` / `prd` (the enrol
   script reads `GITAI_SHARED_KEY` from it).
2. Each engineer runs `gitai-enroll` as above.
3. Tell the team what is recorded (per-person AI usage, cost and redacted
   transcripts, kept 180 days), who can read it, and how to ask for deletion.

## Operating

- List and revoke credentials with the shared key: `tooling/gitai/README.md`.
- Delete a session's transcripts with an S3 prefix delete in
  `gitai-sessions-<stack>` (`sessions/tool=<tool>/sid=<id>/`); transcripts expire
  after 180 days on their own.
