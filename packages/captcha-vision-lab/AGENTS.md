# captcha-vision-lab

## What it is

A lab-only smoke test of Kimi vision on synthetic, server-scored challenge
families that we generate and serve on loopback. Not an agent capability: nothing
in production imports it, and it solves nothing but its own fixture. Design:
[`docs/design/kimi-vision-captcha-lab.md`](../../docs/design/kimi-vision-captcha-lab.md).

## Start here

- `src/run.ts`: one challenge end to end (browser, gate, planner, action, verdict).
- `src/families.ts`: the families and their bounded responses.
- `src/browser-host.ts`: the Node process that drives Chromium; `src/host-protocol.ts` is everything it accepts, `src/browser.ts` the runner's side.
- `src/server.ts`: the challenge service; the answer never leaves it.
- `src/gate.ts`: every provenance check, in one place.

## Scope

- Owns: the challenge families, the run capability, the runner, the mock and Kimi
  planners, the loopback provider stand-in, `lab:smoke`.
- Not here: production CAPTCHA solving → `packages/starter-agent/behavior/capabilities/captcha`.

## Checks

- Follow the [runbook](README.md#runbook) to install and check with the dev
  shell's Bun. The `CAPTCHA vision lab` workflow runs the same check nightly,
  on pushes to `main` that change the lab, and by hand on a branch (`gh
  workflow run captcha_vision_lab.yml --ref <branch>`). `PR CI` runs only
  `check:gate` (no browser), in Browser Tests: run the workflow on a branch
  that changes the lab before merging it.

## Gotchas

- Playwright runs only in `src/browser-host.ts`, under Node (`node` from the
  dev shell). Don't drive Chromium from Bun: its pipe to Chromium stalls
  about once in 40–80 sessions. Keep the host protocol fixture-specific:
  never add script, navigation, coordinate or CDP messages.

- Update `bun.lock` with the dev shell's Bun (`nix develop -c bun install`):
  a newer Bun writes a lockfile version CI's Bun can't read.
- Outside the root workspace on purpose: its own `bun.lock`, and
  `test/isolation.test.ts` fails if any code outside it names it.
- Never import starter-agent, muppet, harness or CapSolver code, and never add
  `main`/`exports`/`bin`: the isolation tests enforce both.
- The registered origin is fixed (`127.0.0.1:47831`); tests bind it, so they
  run one file at a time (Bun's default).
- Keep the CLI proxy check before server or planner startup. It rejects
  `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` in any letter case.
- The planner gets a PNG, the visible prompt and its family's response spec,
  and answers that bounded response. Never widen it to coordinates, DOM or
  generic actions; a new family gets its own bounded response.
- A non-loopback `--kimi-base-url` is a paid call: it needs
  `--allow-remote-provider` and explicit owner authorization for that run.
