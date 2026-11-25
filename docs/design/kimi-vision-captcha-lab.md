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

```text
bun run lab:smoke -- --lab-run [--provider mock|kimi]
  └ lab service starts on 127.0.0.1:47831 (fresh HMAC secret)
  └ per challenge:
      issue(sessionNonce) → runId, challengeId, signed one-time capability
      gate before_navigation: capability present, target == registered URL
      own Chromium process, fresh temp profile, one context
        route allowlist: only the lab origin, fetched by the runner with no
        redirects followed; the page request alone carries the capability;
        only the first main-frame navigation to the target; every WebSocket
        refused; popups counted and closed
      gate before_planner: URL, one navigation, no redirect/popup/frame/
        blocked request, and the service attests this session opened it
      planner(screenshot of #quiz, visible prompt, visible labels) → {choice}
      gate before_action (same checks, fresh attestation)
      click the chosen label's own option button → one submission
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
(request shape, malformed output → closed failure). CI runs them in the
Browser Tests job.

## Live result

2026-11-25, `accounts/fireworks/models/kimi-k3` on Fireworks, shapes quiz:

| Family | Attempts | Solved | Incorrect | Errors | Planner latency | Tokens per call |
| --- | --- | --- | --- | --- | --- | --- |
| shapes and position | 10 | 10 | 0 | 0 | 0.9–1.9 s (median ≈1.0 s) | 713–756 |

The first attempt, with Kimi's default reasoning on, returned no content
within the 64-token cap (5 `model_error`, no actions); reasoning is now off.
Results describe this fixture only, not any third-party CAPTCHA.
