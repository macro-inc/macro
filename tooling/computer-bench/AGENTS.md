# computer-bench

## What it is

Part of Macro computers: benchmarks and guest checks for computers on
Firecracker hosts. It measures Buy -> running -> macrod connected -> first
agent reply through a real control plane, and checks that a computer's guest
works (packages, cargo, Docker, browsers, persistence across stop/start and
hibernate). Not shipped; run by hand against bench hosts.

## Start here

- `e2e.py`: the Buy -> reply loop against a local stack's API, n runs to JSON
  Lines; reads the setup trace from Tempo and the host agent's launch phases.
- `stats.py` (+ `test_stats.py`): p50/p95 per phase, the numbers reports quote.
- `run-checks.sh` -> `backends/firecracker.sh` -> `guest-checks.sh` /
  `browser-checks.mjs` / `mcp-checks.py`: the guest check suite, browser/MCP
  discovery and real tool action checks, and its backend adapter.
- `zfs-block-cloning-check.py`: root-only data integrity check of ZFS block
  cloning in a dataset you own; creates and destroys only its own children.
- `README.md`: how to run each, the settings, the history of the removed
  Incus and QEMU harnesses.

## Recipes

- Local stack that can buy: `just run_local --instance <name> --detach`, then
  `seed.py --stack <name> --state <file>` (Stripe test key only) and
  `generate_local_e2e_token`; run `flag-stub.py` on the stack's services
  network as `POSTHOG_HOST` with a nonempty `POSTHOG_API_KEY` for auth.
- Timed e2e: `timed.sh "<ssh to host>" ./e2e.py --stack <name> --token-file
  <file> --runs 20 --label <backend> --control-plane <where> --host-cmd
  "<ssh to host>" --out <dir>`; then `stats.py <dir>/e2e-<label>.jsonl`.
- Agent teammate e2e on a deployed environment (never prod): `./e2e.py
  --agent --auth-url <url> --storage-url <url> --token-file <file> --label
  <env> --control-plane <env> --out <dir>`. Without `--stack` it skips spans
  unless given `--tempo-url`, and host load and clock offset without
  `--host-cmd`; `t_*_created` are the server's clock.

## Checks

- `python3 -m unittest discover tooling/computer-bench`
- `shellcheck tooling/computer-bench/*.sh tooling/computer-bench/backends/*.sh`

## Gotchas

- Timed numbers only under the host's timed lock (`TIMED_LOCK`, `timed.sh`)
  with host load < 2; record load and the control plane's host with results.
  Builds, functional runs and other guests on the host invalidate a run.
- Compare backends only from the same control plane and guest image.
- The first prompt right after a computer reports ready can be lost (macrod
  opens its trigger stream only after its agent is bound); `e2e.py` resends
  every 5 s and records `first_prompt_lost`.
- Every purchase and release invoices the team's Stripe test subscription,
  and Stripe caps invoices per subscription per day: after a few dozen runs
  purchases stay "purchasing" (429 in auth's log). Seed again with a new
  `--state` file to move the team to a fresh subscription.
- Use only test computers and datasets owned by your run; coordinate budgets
  on shared test hosts and hold the timed lock for benchmarks. Never target
  production hosts or data: the scripts create and destroy computers by name
  and id.
