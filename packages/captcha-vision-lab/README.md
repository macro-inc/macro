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

Run from this directory. On NixOS, set `LAB_CHROMIUM_PATH` to a Nix-built
Chromium or Chrome: Playwright's downloaded headless shell can't load there
(it lacks `libgbm`). For example:

```sh
export LAB_CHROMIUM_PATH=$(readlink -f $(which chromium || which google-chrome-stable))
bun install --frozen-lockfile
```

Use the repo dev shell's Bun for the install and Bun 1.4.2 for the test and
smoke commands below. Bun 1.3.13 routes `node:http` through `HTTP_PROXY`,
while the lab requires a direct connection to its loopback service.

Tests (mock planner and loopback stand-in only; no provider call):

```sh
bun run check
# … 51 pass, 0 fail
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

`--challenges` is capped at 5 per run. Results so far (25 live attempts:
5 `model_error` with Kimi's default reasoning, then 20 of 20 solved with it
off) are in the design doc.

With the local stack up (`just run_local`), the same commands apply
unchanged: the lab uses none of the stack's services, and ordinary agent
browsing (starter-agent's browser and CAPTCHA tests on a real Chromium)
sends nothing to the stand-in and writes no lab records.

## Records

One JSON file per challenge in `--records-dir` (default `lab-records/`,
ignored by git): run id, capability id, origin, gate decisions, provider,
requested and returned model, planner calls, the action taken, the server's
outcome, token usage and timings. No answer, option id or seed.
Outcomes: `solved`, `incorrect`, `expired` (server-scored), and
`provenance_rejected`, `model_error`, `aborted`, `action_error`, `timeout`
(no score; `timeout` after three minutes of wall clock per challenge).
