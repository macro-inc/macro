# CAPTCHA vision lab

A smoke test of Kimi vision on CAPTCHA-like fixtures we own: fresh,
randomized, server-scored challenges in five families (relation, count,
order, transcription, rotation) served on loopback, answered from a
screenshot with a bounded, family-specific response, scored by the server. Design and threat model:
[`docs/design/kimi-vision-captcha-lab.md`](../../docs/design/kimi-vision-captcha-lab.md).

## Not included

General CAPTCHA solving, third-party or vendor challenges, generic
computer-use actions, coordinate actions, token harvesting or injection, a
production fallback from CapSolver to the lab, MCP or agent exposure, and
stealth or evasion. The lab answers only its own quiz, only at
`http://127.0.0.1:47831/lab/quiz`.

## Runbook

From this directory, use the repository dev shell in each lab terminal so
installation and execution both use the same Bun as CI.
The runner drives Chromium from a Node child process, so `node` (the dev
shell's) must be on `PATH` too.

```sh
nix develop ../..
bun install --frozen-lockfile
```

The CLI exits before starting the lab, Chromium, or the planner when
`HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` is present in any letter case,
including empty values. Unset the proxy variables before running the lab.
`NO_PROXY` exceptions do not override the startup check.

```sh
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
```

Clear the dev shell's library overrides before running the lab with
Playwright's downloaded Chromium.

```sh
unset BASH_ENV LD_LIBRARY_PATH
```

On NixOS, point `LAB_CHROMIUM_PATH` at a Nix-built Chromium or Chrome.

```sh
export LAB_CHROMIUM_PATH="$(command -v chromium || command -v google-chrome-stable)"
```

On Ubuntu, install Chromium from the locked Playwright package.

```sh
./node_modules/.bin/playwright install --with-deps chromium
```

On macOS (Apple Silicon or Intel), install the same Chromium build; macOS
needs no system dependencies, so leave out `--with-deps`, and leave
`LAB_CHROMIUM_PATH` unset.

```sh
./node_modules/.bin/playwright install chromium
```

Tests (mock planner and loopback stand-in only; no provider call):

```sh
bun run check
# … 104 pass, 0 fail
```

Mock smoke run. The mock always answers `--mock-choice`, so about one in four
is `solved`; the run passes when every challenge reaches a server-scored
outcome:

```sh
bun run lab:smoke -- --lab-run --challenges 3
# incorrect  planner_calls=1  actions=1  planner_ms=0  tokens=-  lab-records/<run>.json
```

Without `--lab-run` it refuses and starts nothing. `--family` picks a family
(`relation` by default) or `all`; `--challenges` is per family. For a choice
the mock answers `--mock-choice` (or the first label), for an order the
labels as shown, for text `00000`.

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

`--challenges` is capped at 10 per family per run. Results so far are in the
design doc.

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
`provenance_rejected`, `model_error`, `aborted`, `action_error`,
`browser_error`, `timeout`
(no score; `timeout` after three minutes of wall clock per challenge).
