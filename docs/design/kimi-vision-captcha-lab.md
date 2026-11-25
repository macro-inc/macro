# Kimi vision CAPTCHA lab: shapes smoke test

Status: implemented as a smoke test (`packages/captcha-vision-lab`). Lab only.

## Invariant

The lab answers only challenges it generates and serves itself, on one
registered loopback URL, with answers that never leave its server. Anything
else (a third-party page, an unknown origin, a missing or replayed
capability, any navigation, redirect, popup, frame or foreign request) ends
the attempt before the model is called or anything is clicked. Production is
unchanged: `solveCaptcha` and its CapSolver failure path (owner handoff) do
not know the lab exists.

## Scope

In: one challenge family (a shapes and position quiz), a mock planner, a
Kimi K3 vision planner over Fireworks' OpenAI-compatible API, a loopback
provider stand-in, and an explicit `lab:smoke` command.

Out: general CAPTCHA solving, third-party or vendor challenges, generic
computer-use actions (click at x,y, drag, type), coordinate actions, token
harvesting or injection, a production fallback from CapSolver to the lab,
MCP or agent exposure, stealth or evasion, and the broader evaluation
program (held-out sets, many families). More families follow in a stacked
change with the same rules.

## Flow

Use the repository dev shell's Bun as described in the
[lab runbook](../../packages/captcha-vision-lab/README.md#runbook).

```text
bun run lab:smoke -- --lab-run [--provider mock|kimi]
  └ refuse startup if HTTP_PROXY, HTTPS_PROXY or ALL_PROXY is present in any case
  └ lab service starts on 127.0.0.1:47831 (fresh HMAC secret)
  └ per challenge:
      issue(sessionNonce) → runId, challengeId, signed one-time capability
      gate before_navigation: capability present, target == registered URL
      own Chromium process, fresh temp profile, one context
        route allowlist: only the lab origin, fetched by the runner with no
        redirects followed; the page request alone carries the capability;
        only the first main-frame navigation to the target; every WebSocket
        refused; popups counted and closed
      below that, the browser's network is a dead proxy (loopback too)
        with WebRTC kept behind it and no DNS prefetch
      gate before_planner: URL, one navigation, no redirect/popup/frame/
        blocked request, and the service attests this session opened it
      read the screenshot of #quiz, visible prompt and labels; gate again
      planner(screenshot, prompt, labels) → {choice}
      gate before_action (same checks, fresh attestation)
      click the chosen label's own option button → one submission
      gate after_action (observations after a 500 ms quiet window): anything
        the click set off voids the attempt
      verdict = lab service status for (runId, challengeId)
      record JSON; browser and profile destroyed
```

## Trust boundaries

- **CLI startup** (`src/cli.ts`). Refuses proxy-configured runs before
  creating a lab or planner or starting Chromium. Some Bun versions apply
  proxy variables to loopback HTTP, which could expose a capability header.
  A `NO_PROXY` exception leaves the refusal in effect.
- **Lab service** (`src/server.ts`). Generates the quiz from `crypto`
  randomness, renders options as metadata-free PNGs at opaque URLs, keeps
  which option is right in memory. Serves only the registered origin. The
  page takes a capability whose HMAC (`node:crypto`), run, challenge, origin,
  path, session nonce and expiry all match, once. Assets and the submission
  need the bound session; one submission per challenge; status is `pending`,
  `solved`, `incorrect` or `expired`. Issuing, attesting and reading status
  are in-process calls, not routes.
- **Runner** (`src/run.ts`, `src/gate.ts`). Owns the browser and the gate. The
  planner never sees or influences a gate decision. Success comes only from
  the service's status. Records hold fixed failure codes, never error
  messages, which can quote page markup or model output. The gate sees what
  happened up to its last check; anything a page does later is still blocked
  by the allowlist, it just no longer changes a recorded verdict.
  Each challenge has a three-minute wall-clock deadline (spec §11): past it
  the planner call is aborted, no action is taken, the browser is closed
  (giving up after 10 s) and the record is kept with outcome `timeout`.
  Each request the runner forwards to the lab has a 10 s bound and a fresh
  connection.
  A browser that cannot start, or a page that cannot be read or
  captured, ends the attempt as a kept `browser_error` (no planner call,
  no action), and the command goes on to the next challenge.
- **Planner** (`src/planner.ts`). Input: a PNG of the quiz region, the
  visible prompt, the visible labels. Output: one visible label, or abort.
  The Kimi adapter sends the prompt, the image and a strict JSON schema
  (`reasoning_effort: none`, temperature 0, 64 tokens); any transport,
  status, parse or schema failure is `model_error` with no action. A
  non-loopback base URL needs `--allow-remote-provider`.
- **Isolation** (`test/isolation.test.ts`). No code outside the package names
  it; it imports only node, Playwright, zod and itself; it exports nothing;
  it is outside the root workspace.

## Tests

Mock end to end (right → `solved`, wrong → `incorrect`, replayed capability
→ rejected), leakage canaries (seed, answer-bearing words, option ids) over
HTML, asset URLs and bytes, API responses, planner input and records, gate
negatives (no, forged, cross-run, expired or replayed capability; wrong
origin; wrong path; redirect; navigation; popup; third-party frame; third-party
asset; WebSocket; delayed popup; expiry between planner and action), each
asserting zero planner calls, zero actions and zero submissions, a popup or
foreign request set off by the click voiding the scored attempt, a failed
click recording no markup, and the Kimi adapter against the stand-in
(request shape, malformed output → closed failure). The CLI proxy test
asserts refusal with zero requests to the lab or the counting proxy. CI
runs them in the Browser Tests job.

## Live result

2026-11-25, `accounts/fireworks/models/kimi-k3` on Fireworks, shapes quiz,
25 attempts in four runs:

| Run | Attempts | Solved | Incorrect | `model_error` | Planner latency | Tokens per call |
| --- | --- | --- | --- | --- | --- | --- |
| 1: default reasoning | 5 | 0 | 0 | 5 | 1.6–2.0 s | not recorded (the failed parse dropped usage) |
| 2: `reasoning_effort: none` | 10 | 10 | 0 | 0 | 0.9–1.9 s | 713–756 |
| 3: same, after the review fixes to the runner | 5 | 5 | 0 | 0 | 1.0–1.5 s | 713–756 |
| 4: same, after the per-challenge deadline | 5 | 5 | 0 | 0 | 1.0–1.8 s | 713–735 |

In run 1 Kimi K3 reasoned by default and used up the 64-token cap, so every
reply had no content: five closed failures, no planner retry and no click.
With reasoning off, 20 of 20 were solved. Run 1's five JSON records were
deleted when run 2 reused their directory. Its console output and one
record's failure detail (`choices[0].message.content` was null), copied
verbatim from the session transcript, are kept with the local proof as
`live-kimi-run1-console.txt`.
Results describe this fixture only, not any third-party CAPTCHA.
