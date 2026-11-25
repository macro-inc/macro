# Kimi vision CAPTCHA lab

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

In: five randomized, server-scored challenge families (below), a mock
planner, a Kimi K3 vision planner over Fireworks' OpenAI-compatible API, a
loopback provider stand-in, and an explicit `lab:smoke` command.

Out: general CAPTCHA solving, third-party or vendor challenges, generic
computer-use actions (click at x,y, drag, type), coordinate actions, token
harvesting or injection, a production fallback from CapSolver to the lab,
MCP or agent exposure, stealth or evasion, and the broader evaluation
program (held-out sets, confidence intervals, baselines).

## Families

Each family draws a fresh challenge from `crypto` randomness (tests use a
seeded source), renders it to metadata-free PNGs, and has one bounded
response. The executor maps that response onto the quiz's own controls
only.

| Family | Prompt | Response | Executor |
| --- | --- | --- | --- |
| relation | Pick the option where the red triangle is above the blue circle. | one of A–D | clicks that option |
| count | Pick the tile with a different number of shapes from the other three. | one of A–D | clicks that option |
| order | Click the shapes from smallest to largest. | all of A–D, once each | clicks each option in that order |
| transcription | Type the digits in the image. | exactly five digits | fills the quiz's input, presses its submit button |
| rotation | How many degrees clockwise must the arrow turn to point up? | one of 0, 90, 180, 270 | clicks that option |

None takes coordinates, keys or any other element. The server scores the
response kind it expects and refuses any other kind without using the
challenge's one attempt.

## Flow

Use the repository dev shell's Bun as described in the
[lab runbook](../../packages/captcha-vision-lab/README.md#runbook).

```text
bun run lab:smoke -- --lab-run [--family <name>|all] [--provider mock|kimi]
  └ refuse startup if HTTP_PROXY, HTTPS_PROXY or ALL_PROXY is present in any case
  └ lab service starts on 127.0.0.1:47831 (fresh HMAC secret)
  └ per challenge:
      issue(family, sessionNonce) → runId, challengeId, one-time capability
      gate before_navigation: capability present, target == registered URL
      browser host: a Node child (Playwright's own runtime) with an
        allowlisted environment, driven over stdio by typed fixture
        messages only; its own Chromium, fresh temp profile, one context
        route allowlist: only the lab origin, fetched by the runner with no
        redirects followed; the page request alone carries the capability;
        only the first main-frame navigation to the target; every WebSocket
        refused; popups counted and closed
      below that, the browser's network is a dead proxy (loopback too)
        with WebRTC kept behind it and no DNS prefetch
      gate before_planner: URL, one navigation, no redirect/popup/frame/
        blocked request, and the service attests this session opened it
      read the screenshot of #quiz, visible prompt and the family's visible
        controls; gate again
      planner(screenshot, prompt, response spec) → bounded response
      gate before_action (same checks, fresh attestation)
      the family's own controls (option clicks, or input + submit) → one
        submission
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
- **Browser host** (`src/browser-host.ts`, `src/host-protocol.ts`,
  `src/browser.ts`). Chromium is driven from a Node child process, because
  under Bun Playwright's pipe to Chromium sometimes stopped delivering
  messages (a launch that never settled, a locator call never answered;
  about one browser session in 40–80). The runner and the host exchange
  one JSON message per line: open the registered URL (any other URL ends
  the host), report observations, capture the quiz, act through the quiz's
  own controls, close. There is no message for script, navigation,
  coordinates or the browser protocol; anything malformed or unknown ends
  the host. The host gets only the allowlisted environment, and the runner
  kills it at the deadline and after every attempt.
- **Runner** (`src/run.ts`, `src/gate.ts`). Owns the gate. The
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
  visible prompt, the response spec (the family's response kind and the
  visible labels). Output: that response, or abort.
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
asserts refusal with zero requests to the lab or the counting proxy. Every
family also has its own tests: seeds, scoring, leakage, wrong-kind
submissions, the runner end to end, out-of-bounds responses, and gate
rejections with zero planner calls and actions. CI runs them in the Browser
Tests job.

## Live results

### Families

2026-11-25, `accounts/fireworks/models/kimi-k3` on Fireworks, 10 attempts
per family, one model call and one action each. Run B is the current code
(uncompressed images, the three-minute deadline, server-side text checks);
run A was the first families code.

Run B:

| Family | Attempts | Solved | Incorrect | Other | Planner latency (median, range) | Tokens per call |
| --- | --- | --- | --- | --- | --- | --- |
| relation | 10 | 10 | 0 | 0 | 2.3 s, 1.2–5.0 s | 707–727 |
| count | 10 | 7 | 3 | 0 | 0.97 s, 0.88–1.1 s | 749 |
| order | 10 | 9 | 0 | 1 `action_error` | 1.6 s, 1.2–3.8 s | 652 |
| transcription | 10 | 7 | 3 | 0 | 1.3 s, 1.0–2.4 s | 339 |
| rotation | 10 | 10 | 0 | 0 | 1.5 s, 1.1–3.2 s | 551 |

43 of 50 solved. The order `action_error` timed out after 30 s reading
the page before the planner call (no planner call, no action); the
attempt is kept as a failure.

Run A:

| Family | Attempts | Solved | Incorrect | Other | Planner latency (median, range) | Tokens per call |
| --- | --- | --- | --- | --- | --- | --- |
| relation | 10 | 10 | 0 | 0 | 1.08 s, 0.77–26.7 s | 685–728 |
| count | 11 | 8 | 2 | 1 lost (timeout) | 0.86 s, 0.76–0.98 s | 749 |
| order | 10 | 10 | 0 | 0 | 1.09 s, 1.02–1.78 s | 652 |
| transcription | 10 | 6 | 4 | 0 | 0.95 s, 0.88–1.07 s | 339 |
| rotation | 10 | 10 | 0 | 0 | 0.96 s, 0.92–1.04 s | 551 |

44 of 51 solved. The first all-family run of run A stopped making progress
on its 16th challenge (the sixth count attempt): after 13 minutes with no
browser process left it was killed and wrote no record. It is counted here
as a lost (timeout) trial; the three-minute deadline added since then ends
such an attempt as a recorded `timeout`. Its cause is not proven; the most
likely one, an unbounded request forwarded to the lab, is now bounded.

Across both runs transcription misread one or two of five digits in 7 of
20 attempts and count picked a wrong tile in 5 of 21. These are small
samples on this fixture only.

### Shapes quiz (first PR)

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
