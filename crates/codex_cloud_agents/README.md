# Codex cloud OAuth probe and ACP server

For the standalone Zed agent, see **[Codex Cloud in Zed](ACP.md)**.

Our own Rust binary, `codex-cloud-probe`, implementing ChatGPT device-code OAuth
directly over HTTP. It does not invoke Codex/OpenCode or read their credentials.
Only the explicit `launch` command starts cloud work. This implements the initial
authentication, task creation and snapshot probes in the
[feasibility plan](../../docs/CODEX_CLOUD_ACP_PLAN.md).

## Run

From the repository root, build once:

```sh
nix develop --command cargo build -p codex_cloud_agents --bin codex-cloud-probe
```

Then log in:

```sh
./target/debug/codex-cloud-probe \
  --state-dir "$HOME/.local/state/macro-codex-probe" login
```

Open the printed OpenAI URL and enter the one-time code. Keep the command running
until it prints `Connected.` It waits at most 15 minutes; Ctrl-C stops local
waiting without saving a partial login. Device login may need enabling in
ChatGPT security settings or workspace permissions.

Check safe metadata and make a read-only cloud request:

```sh
./target/debug/codex-cloud-probe \
  --state-dir "$HOME/.local/state/macro-codex-probe" status

./target/debug/codex-cloud-probe \
  --state-dir "$HOME/.local/state/macro-codex-probe" environments
```

`status` reads local state only. `environments` calls the source-observed Codex
cloud endpoint, prints only IDs/labels, and refreshes an expiring token first.
An empty environment list or a provider rejection is useful feasibility evidence;
successful OAuth alone does not prove cloud entitlement.

Live evidence (2026-09-15): the account holder completed device login with this
binary. An authenticated environment request succeeded and returned `[]`.
After a repository environment was configured, discovery returned its ID and label.
Our binary successfully submitted a read-only task and observed `in_progress` via
authenticated task-detail reads. Initial running snapshots contained no output items.
Task completion and streaming remain under investigation; remote cancellation,
follow-up and ACP remain unverified.

## Launch and observe a test task

Create a Codex cloud environment for a test repository in the connected ChatGPT
workspace, then run `environments` again. Save a small test prompt in a UTF-8 file,
for example asking Codex to describe the repository without changing files.
Substitute the returned environment ID, an existing branch, and your prompt path:

```sh
./target/debug/codex-cloud-probe \
  --state-dir "$HOME/.local/state/macro-codex-probe" launch \
  --environment ENVIRONMENT_ID --branch main --prompt-file /tmp/codex-probe.txt
```

This submits one task using the connected account. Keep the returned `task_id`
and web URL. Creation is never automatically retried: if the outcome is ambiguous,
check Codex web before submitting again to avoid duplicate work.

```sh
./target/debug/codex-cloud-probe \
  --state-dir "$HOME/.local/state/macro-codex-probe" inspect TASK_ID

./target/debug/codex-cloud-probe \
  --state-dir "$HOME/.local/state/macro-codex-probe" watch TASK_ID \
  --samples 120 --interval-seconds 5 > /tmp/codex-probe-observations.ndjson
```

`watch` polls task details and writes timestamped JSON lines, including repeated
snapshots. It stops on a known terminal assistant status, the sample limit, or
Ctrl-C. Stopping observation does not cancel remote execution. This measures
whether intermediate text becomes visible; it is not a streaming transport or
complete conversation history. Snapshots expose current-turn text, item kinds,
and diff presence. Treat observation files as repository/conversation data.
The command holds the credential lock while watching; stop it before running
another command against that state directory. Do not share `credentials.json`.

## JSON storage

The explicit directory is created with mode `0700`. `credentials.json` uses
`0600` and atomic replacement. It contains:

```json
{
  "version": 1,
  "access_token": "<secret>",
  "refresh_token": "<secret>",
  "expires_at": 1234567890,
  "account_id": "<ChatGPT account ID>"
}
```

This is local plaintext JSON, not encrypted SaaS credential storage. Use a
dedicated directory outside the repository. Existing broadly readable directories
or credential files are rejected instead of silently changing their permissions.
A `.lock` file prevents concurrent probe commands from racing token refresh or
logout. Symlinks at the state directory/file are rejected. The directory and its
parents must be under your control; this is not a multi-user server vault.

Token values and provider error bodies are never printed. `account_id` is metadata
extracted from the HTTPS token exchange response; JWT claims are not independently
verified and must not be used as Macro identity proof. The ID token is discarded.
Refresh cannot silently change the stored account.

To remove this probe's credentials:

```sh
./target/debug/codex-cloud-probe \
  --state-dir "$HOME/.local/state/macro-codex-probe" logout
```

This does not revoke credentials at OpenAI or stop remote tasks. Run it before
logging into another account. Storage currently supports Unix permissions only.

## Protocol and tests

Uses Codex's shared OAuth client ID, not a custom registered Macro client. The
device flow follows the supplied Codex/OpenCode implementations:

1. `POST auth.openai.com/api/accounts/deviceauth/usercode`.
2. Display `auth.openai.com/codex/device` and the user code.
3. Poll `/api/accounts/deviceauth/token`; 403/404 mean pending as in the source.
4. Exchange the returned code/verifier at `/oauth/token`.
5. Store credentials in our JSON format. No dependency on either checkout.

Polling respects the supplied interval plus three seconds, with a local deadline.
Unexpected statuses fail without automatic retries. Requests have timeouts and
bounded response sizes; redirects are disabled. Production origins are fixed.
Tests use loopback HTTP mocks; no public endpoint override is exposed.

Reference revisions inspected: Codex `2fdcdeaf0e219eea34c710e01de2ee0571ddeeb5`,
OpenCode `e03db9bc6908f75c9334d8aa997deeaac81c0298`.

```sh
nix develop --command env -u SQLX_OFFLINE cargo test -p codex_cloud_agents
nix develop --command just check
```

Tests cover actual HTTP request shapes, pending/success/error responses,
expiry/cancellation of local login, account-preserving refresh, omission of a new
refresh token, response-size limits, error-body suppression, safe environment
projection, atomic JSON replacement, permissions, symlink rejection and locking.
Task tests cover the source-observed creation payload, account headers, environment
visibility, ambiguous writes without retry, task identity checks, partial text,
unknown output kinds/statuses, and input validation.

## Create and stream observations

Add `--stream` to `launch` to print a creation receipt followed by changed task
snapshots as NDJSON. The receipt is flushed before observation starts. Polling is
every one second after each response. Duplicate snapshots are suppressed; changes
include complete current text so revisions are preserved. This is polling, not
provider token streaming. No text is invented when the API returns none.

```sh
./target/debug/codex-cloud-probe \
  --state-dir "$HOME/.local/state/macro-codex-probe" launch \
  --environment ENVIRONMENT_ID --branch main \
  --prompt-file /tmp/codex-probe.txt --stream
```

Resume observation without creating another task:

```sh
./target/debug/codex-cloud-probe \
  --state-dir "$HOME/.local/state/macro-codex-probe" stream TASK_ID
```

Observation ends on a known terminal status, an error, or Ctrl-C. A failed or
cancelled remote task returns a nonzero exit code. Ctrl-C stops only observation.
There is no automatic submission retry or observation deadline; preserve the
creation receipt to resume after errors. The state directory remains locked
while observing.
