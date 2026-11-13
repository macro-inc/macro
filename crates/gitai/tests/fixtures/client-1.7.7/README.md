# git-ai 1.7.7 wire fixtures

Requests recorded from an unmodified git-ai 1.7.7 client (`git-ai --version` =
`1.7.7`, source tag `5420ab908`) talking to a capture server. Use them as
contract tests for gitai-service's `/worker/*` handlers.

Each file is one request: `method`, `path`, `query`, the headers the server
cares about, the parsed JSON `body`, and the capture server's `response`. The
response is what the capture server answered, not a requirement; for failure
fixtures it is the forced status.

## How they were produced

- A scratch client in its own `HOME` (no real user data): identity
  `Test Dev <dev@example.com>`, three locations: a repo with origin
  `https://github.com/macro-inc/macro.git` (allowed), a repo with origin
  `https://github.com/someone-else/other.git` (not allowed), and a plain
  directory with no repo. Config: `api_base_url` = capture server, a fake
  `api_key`, `telemetry_oss: "off"`, version checks and auto-updates off,
  `allow_repositories: ["github.com/macro-inc/macro"]`.
- Synthetic Claude Code transcripts (one per location) and one Codex rollout
  (macro repo), fed through `git-ai checkpoint claude|codex --hook-input stdin`,
  then commits. The transcripts carry deliberately fake secrets:
  `ghp_FAKE-NOT-A-REAL-TOKEN-1234`, `4242424242424242`,
  `AKIA-FAKE-NOT-A-REAL-KEY`, `password=hunter2-fake-pw` (all low entropy: the
  client leaves them unmasked; hyphenated so the repo's PII scanner accepts them) and Stripe's public
  documentation key `sk_test_4eC39…` plus a random `fake_token=Zq8v…` (high
  entropy: the client masks them as `sk_t********p7dc`).
- Scrubbed: scratch paths became `/home/test/scratch`, the install id
  (`X-Distinct-ID`, `install_id`) a fixed UUID, the host header
  `127.0.0.1:8787`.
- Commit SHAs, session ids and timestamps are real for that run but synthetic.

The harness and capture server live outside the repo (phase 0 spike); the
harness is `run-scratch-client.sh <api_base_url> <api_key> [work_dir]`.

## Fixtures

| File | Request | How it was produced |
| --- | --- | --- |
| `metrics-upload-mixed.json` | `POST /worker/metrics/upload` | Default harness run. One batch with every event type produced: Committed (1) ×5 (3 macro, **2 for the not-allowed repo**), AgentUsage (2) ×2, Checkpoint (4) ×5 (**1 for the not-allowed repo**), SessionEvent (5) ×13 (Claude ×5, Codex ×8, macro only), TokenUsage (9) ×2 (Claude, Codex). Shows client redaction. |
| `metrics-upload-sweep-allowed-only.json` | `POST /worker/metrics/upload` | Three transcripts with no checkpoint (macro, other, no repo), picked up by the daemon's sweep after a restart. Only the macro session's 5 SessionEvents and 1 TokenUsage are sent; the other two sessions' SessionEvents and TokenUsage were queued locally and dropped at upload. |
| `metrics-upload-503.json` | `POST /worker/metrics/upload` | Server forced to 503; one Committed event. |
| `metrics-upload-429-retry-after.json` | `POST /worker/metrics/upload` | Server forced to 429 with `Retry-After: 2`. |
| `metrics-upload-401.json` | `POST /worker/metrics/upload` | Server forced to 401. |
| `metrics-upload-errors-array.json` | `POST /worker/metrics/upload` | 200 with `{"errors":[{"index":0,…}]}`: the event is marked undeliverable (attempts = 6), never retried. |
| `metrics-upload-retry-after-503.json` | `POST /worker/metrics/upload` | The 503 event re-sent exactly 300 s later (first backoff step). The 429 and 401 events were also retried at +300 s, ignoring `Retry-After`. |
| `logs-upload-daemon-start.json` | `POST /worker/logs/upload` | Daemon logs from the default run (startup, checkpoints, commits, sweeps). |
| `logs-upload.json` | `POST /worker/logs/upload` | A later, small logs batch. |
| `logs-upload-after-503.json` | `POST /worker/logs/upload` | The logs batch that reports the failed metrics upload (includes the server's error body). |
| `notes-upload.json` | `POST /worker/notes/upload` | Run with `notes_backend.kind = "http"`. Note: with an `api_key` and **no** `notes_backend` key, 1.7.7 defaults to `http`. Includes the not-allowed repo's note. |
| `notes-get.json` | `GET /worker/notes/?commits=a,b` | `git-ai log -2` with the local notes cache removed. Trailing slash on the path; SHAs comma-joined in one `commits` value. |
| `releases-get.json` | `GET /worker/releases` | `git-ai upgrade` with `disable_version_checks: false`. Response shows the four channels. |
| `releases-download-sha256sums.json` | `GET /worker/releases/latest/download/SHA256SUMS` | `git-ai upgrade --force`. No auth headers on downloads. The capture server answered 404 on purpose (no GitHub fetch, no install). |

Not captured because the client never sends them in 1.7.7 with an API key:
`/worker/cas/*` (no producer), `/worker/oauth/*` (only with `git-ai login`),
`/api/bundles`, `/api/cube/*`. `git-ai whoami` sends no request.
