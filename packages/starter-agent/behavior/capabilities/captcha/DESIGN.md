# Captcha: clearing a human check on the agent's own tab

`solveCaptcha` clears a reCAPTCHA (v2, v3) or Cloudflare Turnstile check on the browser's current tab,
and says what the page did after. Anything else goes to the owner, who can take over the screen.

```
solveCaptcha ─ driver lease (browser/driver.ts) ─ one `opencode run` (Kimi K3)
  model: relay /brain/fireworks/v1 → harness /brain/fireworks → Fireworks
  tools: mcp.ts only (detect_captcha, solve_captcha), every OpenCode tool off
    solve_captcha: detect → relay /brain/captcha/solve → harness → CapSolver → inject → observe
```

| File          | What it holds                                                                                |
| ------------- | -------------------------------------------------------------------------------------------- |
| `detect.ts`   | Which check a page shows, from facts read off it. Pure.                                      |
| `page.ts`     | The page side over CDP: read the facts, inject the token, run the widget's callback, settle. |
| `brain.ts`    | The harness's solve route, through the relay; its answers are parsed, refusals are values.   |
| `solve.ts`    | One solve start to finish, and the observed outcome.                                         |
| `mcp.ts`      | The solver's stdio MCP server; it appends each attempt's outcome to the run's record file.   |
| `opencode.ts` | The OpenCode run: inline config, relay-only provider, `captcha` agent, nothing else.         |
| `index.ts`    | `solveCaptcha`: the lease, a deterministic detect first, the run, the answer with `next`.    |

- **No key here.** CapSolver's and Fireworks' keys stay in the harness. The guest sends the agent's
  own Macro key, and only the relay holds it: OpenCode and the MCP server get the relay's capability.
- **What CapSolver gets:** the task type, the page's origin and path (no query or fragment), the
  site key, and the widget's action, cdata or `data-s`. Never cookies, page text, a proxy or a user
  agent.
- **The outcome is observed.** `solved` needs evidence: the page navigated, the challenge is gone, or
  the widget's callback ran. `injected` means the token is in the form and the page hasn't reacted
  yet. What `solveCaptcha` returns comes from the MCP server's record file, never from the model's
  text.
- **Bounded.** One OpenCode run per call, at most 8 model steps and 2 solves, and 5 minutes. No
  subagents, shell, files or web. The harness enforces each agent's solve budgets.
- **One driver.** The solver holds the browser lease for the run, so the agent's own browser steps
  refuse while it does. The owner's take-over (`$HOME/state/screen-driver`, written by the harness)
  beats both. The harness also holds every `/brain/*` call while the owner drives.
- **Spans:** `captcha.solve_captcha` and `captcha.solve`, with the kind, host, outcome, evidence
  and CapSolver task id. Never the token, site key, path or query.
