# CAPTCHA vision lab

A smoke test of Kimi vision on a CAPTCHA-like fixture we own: a fresh,
randomized, server-scored shapes quiz ("Pick the option where the red
triangle is above the blue circle") served on loopback, answered from a
screenshot, scored by the server. Design and threat model:
[`docs/design/kimi-vision-captcha-lab.md`](../../docs/design/kimi-vision-captcha-lab.md).

## Not included

General CAPTCHA solving, third-party or vendor challenges, generic
computer-use actions, coordinate actions, token harvesting or injection, a
production fallback from CapSolver to the lab, MCP or agent exposure, and
stealth or evasion. The lab answers only its own quiz, only at
`http://127.0.0.1:47831/lab/shapes-quiz`.

## Runbook

Run from this directory. On NixOS, first point the runner at a working
Chromium (Playwright's download can't load there):

```sh
export LAB_CHROMIUM_PATH=$(readlink -f $(which google-chrome-stable))
bun install --frozen-lockfile
```

Tests (mock planner and loopback stand-in only; no provider call):

```sh
bun run check
# … 34 pass, 0 fail
```

Mock smoke run. The mock always answers `--mock-choice`, so about one in four
is `solved`; the run passes when every challenge reaches a server-scored
outcome:

```sh
bun run lab:smoke -- --lab-run --challenges 3
# incorrect  planner_calls=1  actions=1  planner_ms=0  tokens=-  lab-records/<run>.json
```

Without `--lab-run` it refuses and starts nothing.

Kimi adapter against the loopback stand-in (no provider call). In one
terminal:

```sh
bun run lab:kimi-stand-in -- --port 47840 --choice B --log /tmp/stand-in.jsonl
```

In another:

```sh
bun run lab:smoke -- --lab-run --provider kimi \
  --kimi-base-url http://127.0.0.1:47840/v1 --challenges 3
wc -l /tmp/stand-in.jsonl   # 3: one request per challenge
```

Live Kimi (a paid Fireworks call: only with authorization for that run). The
key comes from Doppler's `shared_ai` config and never reaches the browser or
the records:

```sh
doppler run -p shared_ai -c lcl --only-secrets FIREWORK_API_KEY -- \
  bun run lab:smoke -- --lab-run --provider kimi --allow-remote-provider --challenges 5
# solved  planner_calls=1  actions=1  planner_ms=1019  tokens=734  lab-records/<run>.json
```

`--challenges` is capped at 5 per run.

## Records

One JSON file per challenge in `--records-dir` (default `lab-records/`,
ignored by git): run id, capability id, origin, gate decisions, provider,
requested and returned model, planner calls, the action taken, the server's
outcome, token usage and timings. No answer, option id or seed.
Outcomes: `solved`, `incorrect`, `expired` (server-scored), and
`provenance_rejected`, `model_error`, `aborted`, `action_error` (no score).
