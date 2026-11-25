# captcha-vision-lab

## What it is

A lab-only smoke test of Kimi vision on synthetic, server-scored challenge
families that we generate and serve on loopback. Not an agent capability: nothing
in production imports it, and it solves nothing but its own fixture. Design:
[`docs/design/kimi-vision-captcha-lab.md`](../../docs/design/kimi-vision-captcha-lab.md).

## Start here

- `src/run.ts`: one challenge end to end (browser, gate, planner, action, verdict).
- `src/families.ts`: the families and their bounded responses; `src/executor.ts` maps a response to the quiz's own controls.
- `src/server.ts`: the challenge service; the answer never leaves it.
- `src/gate.ts`: every provenance check, in one place.

## Scope

- Owns: the challenge families, the run capability, the runner, the mock and Kimi
  planners, the loopback provider stand-in, `lab:smoke`.
- Not here: production CAPTCHA solving → `packages/starter-agent/behavior/capabilities/captcha`.

## Checks

- `bun install --frozen-lockfile && bun run check` (CI runs it in Browser Tests).
- On NixOS, Playwright's downloaded Chromium can't load: set
  `LAB_CHROMIUM_PATH=$(readlink -f $(which google-chrome-stable))` (or any
  Chromium binary).

## Gotchas

- Update `bun.lock` with the dev shell's Bun (`nix develop -c bun install`):
  a newer Bun writes a lockfile version CI's Bun can't read.
- Outside the root workspace on purpose: its own `bun.lock`, and
  `test/isolation.test.ts` fails if any code outside it names it.
- Never import starter-agent, muppet, harness or CapSolver code, and never add
  `main`/`exports`/`bin`: the isolation tests enforce both.
- The registered origin is fixed (`127.0.0.1:47831`); tests bind it, so they
  run one file at a time (Bun's default).
- The planner gets a PNG, the visible prompt and its family's response spec,
  and answers that bounded response. Never widen it to coordinates, DOM or
  generic actions; a new family gets its own bounded response.
- A non-loopback `--kimi-base-url` is a paid call: it needs
  `--allow-remote-provider` and explicit owner authorization for that run.
