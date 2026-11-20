# Agent teammates: clearing CAPTCHAs

An agent teammate browsing on its own computer stalls on human checks: reCAPTCHA, Cloudflare
Turnstile and the like. `solveCaptcha` clears the ones a solver can, on the agent's own current tab,
and hands the rest to the agent's owner, who can take over the agent's screen.

## How it works

```
agent (Claude) ─ solveCaptcha({ reason })                         packages/starter-agent
  │  checks the tab first: no check / unsupported → answers at once, nothing else runs
  │  takes the browser lease (the owner's take-over beats it)
  └─ one bounded `opencode run`, its only tools the captcha MCP server
       model: Kimi K3 ─ relay /brain/fireworks/v1/chat/completions ─ harness ─ Fireworks
       solve_captcha: read the challenge (site key, origin + path, widget params)
                      ─ relay /brain/captcha/solve ─ harness ─ CapSolver createTask / getTaskResult
                      ─ token into the widget's field, its callback run, the page looked at again
  ← observed outcome + `next` (+ the owner's screen link when it's theirs to do)
```

- **Keys stay in the harness.** `CAPSOLVER_API_KEY` and `FIREWORK_API_KEY` are only in the harness
  service's config. The agent's computer holds its own Macro key, and only its relay process has
  it: OpenCode and the MCP server get the relay's per-run capability, and the relay forwards exactly
  the two brain routes.
- **What CapSolver gets:** the task type, the page's origin and path (never its query or fragment),
  the site key, and the widget's own `action`, `cdata` or `data-s`. Never cookies, page content, a
  proxy or a user agent. All tasks are proxyless.
- **The outcome is observed.** `solved` needs evidence: the page moved to another origin or path
  since right before the token went in, or the challenge is gone. The widget's callback running is
  not evidence, since the solver runs it itself. `injected` means the token is in the form (and the
  callback ran) but the challenge is still shown, so the agent submits it. Of two attempts in a
  run, the better outcome is the one reported. The result comes from the MCP server's record of what it
  did, never from the model's words.
- **The owner as fallback.** A Cloudflare interstitial, hCaptcha, DataDome, AWS WAF, GeeTest,
  Arkose, PerimeterX and image puzzles come back `unsupported`. Those, and every failure, tell the
  agent to ask its owner, with a link to take over its screen (`/app/screen/<harness id>?mode=drive`,
  once the harness writes `$HOME/state/harness-id`).

## Limits

| Limit | Where |
| --- | --- |
| One OpenCode run per call: at most 8 model steps, 2048 output tokens a step, 2 solves, 5 minutes (`timeout` inside the sandbox stops OpenCode and its MCP server) | `packages/starter-agent` (`captcha/opencode.ts`, `captcha/mcp.ts`) |
| Every OpenCode tool off except the two captcha tools; no subagents, shell, files, web, skills or plugins; none of the computer's own OpenCode config | `captcha/opencode.ts` |
| One driver: the solver's lease refuses the agent's own browser steps; the owner's take-over file refuses both, and the solver checks it again before it touches the page | `browser/driver.ts`, `captcha/solve.ts` |
| Per agent and per harness process: 1 concurrent solve, 20 an hour, 100 a day, reset on deploy (two replicas allow twice that); 120 s of polling per solve | harness `captcha_gateway` |
| Idempotent by `solveId` within a process: a repeated request joins the same solve. Each attempt sends a fresh id | harness `captcha_gateway` |
| Only Kimi K3 on the Fireworks route; `max_tokens` at most 8192, `n` 1, 5 minutes per call | harness `fireworks_gateway` |
| The harness holds every `/brain/*` call while the owner drives the agent's screen | agent screen (pending: lands with the screen take-over work) |

The agent's charter (`AGENT.md`) says to use it only for what the owner asked: never to make
accounts in bulk, buy tickets automatically or collect non-public data, which CapSolver's own
terms also forbid.

## Billing

- **Model:** each `/brain/fireworks` call records `UsageAmount::Tokens` under the agent and its team,
  priced as `kimi-k3`, with cached prompt tokens as cache reads. A retried HTTP call is a new request
  that Fireworks served and is billed once for what it served. Fireworks' response id is on the span
  (`gen_ai.response.id`), not yet in the ledger.
- **Solves:** a solve that comes back `ready` records `UsageAmount::ProviderCredits { credits: 1 }`
  under the model `capsolver-<task>`, priced per solve from CapSolver's list price (seeded by the
  `capsolver_pricing` migration). Failed solves cost nothing, here and at CapSolver. The `solveId`
  is the idempotency key, so a repeated request never records twice.

## Tracing

One trace per solve: `captcha.solve_captcha` → `captcha.find`, `captcha.opencode_run` → (MCP
server) `captcha.tool.solve` → `captcha.solve` → `captcha.harness_solve` → (harness)
`captcha_gateway.solve` → `captcha.apply`. The run's traceparent also goes on each model call, so
`brain_fireworks.chat` joins it. Spans carry kinds, hosts, outcomes, evidence, counts and the
CapSolver task id: never the token, the site key, a path or query, or page text.

## Testing

- `packages/starter-agent`: detection on literal page facts, the driver lease, the relay's brain
  routes, Chromium against local fixture pages (test site keys, no third-party scripts) with a
  stand-in harness, and the whole chain through a real OpenCode with a scripted stand-in model.
- `crates/capsolver_emulator`: a scripted CapSolver for the harness's tests and for local runs
  (`OVERRIDE_CAPSOLVER_API_URL`).
- `brain_bench` (`agent_harness_service`, feature `brain-bench`, never built by default): the two
  brain routes alone, with a fixed bench key and an in-memory usage ledger, for driving the whole
  chain locally without a stack.
- `capsolver_live_contract` (ignored unless `CAPSOLVER_API_KEY` is set): two real solves of
  Cloudflare's and Google's test site keys.
