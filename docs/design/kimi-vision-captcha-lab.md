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

```text
bun run lab:smoke -- --lab-run [--family <name>|all] [--provider mock|kimi]
  └ lab service starts on 127.0.0.1:47831 (fresh HMAC secret)
  └ per challenge:
      issue(family, sessionNonce) → runId, challengeId, one-time capability
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
(request shape, malformed output → closed failure). Every family also has
its own tests: seeds, scoring, leakage, wrong-kind submissions, the runner
end to end, out-of-bounds responses, and gate rejections with zero planner
calls and actions. CI runs them in the Browser Tests job.

## Live results

### Families

2026-11-25, `accounts/fireworks/models/kimi-k3` on Fireworks, the families
branch, 10 attempts per family (one model call and one action each):

| Family | Attempts | Solved | Incorrect | `model_error` | Planner latency (median, range) | Tokens per call |
| --- | --- | --- | --- | --- | --- | --- |
| relation | 10 | 10 | 0 | 0 | 1.08 s, 0.77–26.7 s | 685–728 |
| count | 10 | 8 | 2 | 0 | 0.86 s, 0.76–0.98 s | 749 |
| order | 10 | 10 | 0 | 0 | 1.09 s, 1.02–1.78 s | 652 |
| transcription | 10 | 6 | 4 | 0 | 0.95 s, 0.88–1.07 s | 339 |
| rotation | 10 | 10 | 0 | 0 | 0.96 s, 0.92–1.04 s | 551 |

44 of 50 solved. Transcription misread one or two of five distorted digits
in four attempts; count picked a wrong tile twice. One relation call took
26.7 s. A first run of all families stopped making progress on its 16th
challenge (the sixth count attempt) and was killed after 13 minutes with
no browser process left; it wrote no record for that attempt, and the
remaining count, order, transcription and rotation attempts were run
afterwards. These are small samples on this fixture only.

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
