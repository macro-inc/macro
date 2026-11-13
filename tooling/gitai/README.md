# gitai: client tooling for gitai-service

gitai-service is Macro's own server for the open-source [git-ai](https://github.com/git-ai-project/git-ai) client. It records which agent sessions wrote code in `github.com/macro-inc/macro`, what they cost, and their redacted transcripts. This folder holds what runs on an engineer's machine:

| File | What it is |
| --- | --- |
| `gitai-enroll` | Sets up git-ai on this machine and mints its device credential. |
| `gitai-why/SKILL.md` | Agent skill: answers "why was this written", "which session wrote this", "what did this PR cost" from the read API. |
| `../../infra/stacks/observability/nixos/gitai-dashboard.json` | The Grafana "AI authorship" dashboard (folder "AI authorship"). |

## Enrol a machine

You need read access to the Doppler project `gitai-service` (`prd`). From a checkout of this repo:

```sh
doppler run -p gitai-service -c prd -- tooling/gitai/gitai-enroll
```

It shows a plan and asks before changing anything (`--yes` skips the question, `--dry-run` prints the plan only). In order, it:

1. Installs git-ai 1.7.6 from the project's GitHub release into `~/.git-ai/bin`, checked against the release's `SHA256SUMS`. If `git-ai --version` already reports 1.7.6 or 1.7.7 (a Nix-managed install, say), it uses that one and leaves it alone. 1.7.7 has no GitHub release; it is 1.7.6 plus a version bump, which is why both count as pinned.
2. Sets `api_base_url` to `https://gateway.macro.com/gitai`, before any credential exists, so nothing is ever sent to the vendor.
3. Sets `telemetry_oss` off, `disable_auto_updates` and `disable_version_checks` on, `notes_backend.kind` to `git_notes` (with an `api_key` and no notes backend set, git-ai would send notes to the server and stop writing `refs/notes/ai`), and `allow_repositories` to `https://github.com/macro-inc/macro` (the client matches that against both HTTPS and SSH remotes). On machines without git in a standard location (NixOS) it also sets `git_path`.
4. Mints a device credential: `POST /v1/credentials {email, hostname}` with the shared key, using your `git config user.email` and `uname -n`. The credential goes into `~/.git-ai/config.json` as `api_key` (file mode 600).
5. Runs `git-ai install`, which hooks every agent it detects (Claude Code, Codex, ...) and restarts the daemon, then installs the upstream login-start unit (a systemd user unit on Linux, a LaunchAgent on macOS) so the daemon runs from login.
6. Installs the `gitai-why` skill to `~/.claude/skills/` and `~/.codex/skills/`, and adds one instruction line, between `gitai-enroll` marker comments, to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`: after opening a PR on `macro-inc/macro`, append `git-ai: https://gateway.macro.com/gitai/v1/prs/macro-inc/macro/<n>` to its description.
7. Checks the credential with the server (`GET /v1/whoami`; a revoked one stops the script and asks for `--rotate`), then prints `git-ai whoami`, which reads only local state.

Re-running is safe: it re-applies the settings and keeps the existing credential. `--rotate` mints a new one and revokes this machine's old ones (same email, compared case-insensitively because the server stores it lowercased, and same hostname); it warns if it found none to revoke.

The shared key never touches disk, a log or a command line: the script removes it from the environment at start and hands it to curl as a config file on stdin. Every program it starts (git-ai, its daemon, the login-start installer) gets a minimal environment, so none of the Doppler secrets live on in the daemon.

Environment overrides, for testing: `GITAI_BASE_URL` (plain `http` only for localhost) and `GITAI_CLIENT_VERSION` (installs and accepts only that version).

### Nix-managed machines

If `~/.git-ai/config.json` is a symlink or read-only (a Home Manager file in the Nix store, say), the script switches to managed mode, because a credential must never land in the world-readable store:

- It changes no git-ai settings, hooks or login start; those stay with your Nix config.
- It mints the credential into `~/.git-ai/api-key.env` (`GIT_AI_API_KEY=...`, mode 600). git-ai reads `GIT_AI_API_KEY` from its environment ahead of `api_key`; it has no other place for a key outside `config.json`.
- It checks every non-secret key it would set (`api_base_url`, `telemetry_oss` off, `disable_auto_updates`, `disable_version_checks`, `notes_backend.kind` `git_notes`, `allow_repositories` containing `https://github.com/macro-inc/macro`, and `git_path` where needed). If any is missing or wrong, it names them, prints the exact keys for `config.json` and stops without minting.

Then put those keys in the Home Manager config and switch, so the base URL is in place before the key is used. Export the key file to everything that runs git-ai, agents included: `set -a; . ~/.git-ai/api-key.env; set +a` in your shell rc, and `EnvironmentFile=%h/.git-ai/api-key.env` for systemd user units. Restart the daemon (`git-ai bg shutdown`; it starts again on next use) from a shell that has the key, then re-run the script: it keeps the credential and prints `git-ai whoami`.

## Credentials

Each credential is bound to one email and hostname and never expires. With the shared key:

```sh
doppler run -p gitai-service -c prd -- sh -c \
  'printf "header = \"X-API-Key: %s\"\n" "$GITAI_SHARED_KEY" | curl -sS --config - https://gateway.macro.com/gitai/v1/credentials' | jq
```

That lists `id`, `email`, `hostname`, `created_at`, `last_used_at` and `revoked_at`. To revoke one (its next request gets 401):

```sh
doppler run -p gitai-service -c prd -- sh -c \
  'printf "header = \"X-API-Key: %s\"\n" "$GITAI_SHARED_KEY" | curl -sS --config - -X DELETE https://gateway.macro.com/gitai/v1/credentials/<id>'
```

To replace a machine's credential, run `gitai-enroll --rotate` on it. When someone leaves, revoke every credential with their email.

## Test enrolment without touching your machine

Never run it against your real `HOME`. Use a scratch home, a short `TMPDIR` (the daemon's socket path must fit in 108 bytes) and a local stand-in for the server that answers `POST /v1/credentials` with `201 {"id", "credential": "gitai_...", "email", "hostname", "created_at"}`, `GET /v1/credentials` (for `--rotate`) and `GET /v1/whoami` with `200 {"id", "email", "hostname"}`, or the local gitai-service itself (`GITAI_BASE_URL=http://localhost:30937/gitai`, shared key `local-gitai-shared-key`). To test managed mode, make `~/.git-ai/config.json` in the scratch home a symlink to a read-only file:

```sh
scratch=$(mktemp -d)
mkdir -p "$scratch/home" && git config -f "$scratch/home/.gitconfig" user.email test@example.com
env -i HOME="$scratch/home" PATH="$PATH" TMPDIR=/tmp XDG_CONFIG_HOME="$scratch/home/.config" \
  GITAI_BASE_URL=http://127.0.0.1:8787/gitai GITAI_SHARED_KEY=test-key \
  tooling/gitai/gitai-enroll --yes
HOME="$scratch/home" git-ai bg shutdown
```

`env -i` matters: `XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` from your shell would point the run at your real config. On Linux the login-start step calls `systemctl --user`; put a stub `systemctl` first on `PATH` to keep it out of your user manager.

## Dashboard

`infra/stacks/observability/nixos/gitai-dashboard.json` is plain JSON, provisioned by `gitai-dashboard.nix` into the "AI authorship" folder; it can also be imported by hand. Its panels read gitai-service's OTLP counters (`gitai_*_total`, filtered on `service_name="gitai-service"` and the `deployment_environment` variable). Edit the JSON directly; it ships with the next Deploy Observability run.

The counters are cumulative and low-rate, and a plain `increase()` drops a series' first sample: a new author, model or repo, or the first event after a task restart, is already above zero when Prometheus first sees it. Each counting panel (all but the per-second rates under Ingest health) therefore adds `min_over_time(...) unless ... offset` (the first value of series that did not exist at the start of the window) to `increase()`. Keep that shape when you add a panel, and check a new or changed panel against a known count in dev before trusting it: make a few commits in `macro-inc/macro` from an enrolled scratch machine, then compare the Commits stat for that author with the number you made. Expect it slightly high, not low; `increase()` extrapolates to the window edges.
