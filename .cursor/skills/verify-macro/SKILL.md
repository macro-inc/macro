---
name: verify-macro
description: Verify Macro's primary web app through its isolated local stack and Playwright harness. Use after user-facing frontend or backend changes, when reproducing web behavior, or when collecting proof that a Macro feature works.
---

# Verify Macro

Macro's primary surface is the SolidJS web app. The repository also contains Tauri clients, APIs, and service-level integration tests, but this skill drives the seeded web app because it is the supported end-to-end user surface.

Read `features/README.md` and the relevant feature file before driving the app.

## Launch

Use the executable `scripts/run-proof.ts` helper from the repository root. It creates a collision-resistant named stack with isolated ports, networks, volumes, generated environment, bearer-token auth, and deterministic seed data. Playwright starts a Vite server against that stack for the duration of the run.

For the baseline Files proof:

```bash
env -u CARGO_TARGET_DIR nix --extra-experimental-features 'nix-command flakes' develop --command bun .cursor/skills/verify-macro/scripts/run-proof.ts local-smoke.spec.ts -- --grep "documents view shows seeded documents"
```

The helper installs Chromium when missing, warms the two generated WASM packages, runs the mapped Playwright test with tracing, records exit statuses, and tears down in `finally` or on `SIGINT`/`SIGTERM`. Those setup steps use fast paths when current. The run is ready when Playwright reaches `gotoApp`: it rejects login, signup, or welcome redirects and waits up to 30 seconds for `[data-split-container]`.

Do not use `.cursor/stack.sh` for verification. It reuses the shared `macro` instance and can contain user state. Do not drive an instance unless this run created its unique name.

## Doctor

The helper always runs `doctor-local` in the pinned Nix shell against its generated instance and saves the read-only preflight as `doctor.txt`.

Require Docker and the pinned toolchain checks to pass. The named instance's ports must be free before launch. To resume with a deliberate name, set `LOCAL_E2E_INSTANCE`; otherwise, let the helper generate one.

During a run, `gotoApp` is the auth and UI-shell doctor: the page must avoid `/app/welcome`, `/app/signup`, and `/app/login`, then show `[data-split-container]`. If it fails, keep the trace and run transcript, clean up the named instance, and do not continue with feature assertions.

## Drive

Use the existing Playwright tests under `apps/web/tests/e2e` through `scripts/run-proof.ts`. Direct `bunx playwright test` calls miss stack creation, deterministic seeding, generated service URLs, bearer-token auth, retained evidence, and guaranteed cleanup.

Stable handles already used by the harness include:

- `[data-sidebar-link="documents"]` for the Files sidebar destination.
- `[data-list-view="documents"]` and `[data-soup-list-container]` for its loaded list.
- `[data-entity-id="00000000-0000-0000-0002-000000000001"]` for the seeded `Project Roadmap`.
- `[data-soup-search] [contenteditable]` for search.
- `[data-channel-message-list]`, `[data-message-id="00000000-0000-0000-0001-000000000001"]`, and `[data-input-id="channel-input-00000000-0000-0000-0000-000000000001"]` for seeded channels.
- Accessible names and exact visible text when no stable data attribute exists.

Prefer the mapped command and selectors. When adding a proof path, reuse `tests/e2e/helpers/local-app.ts` and `tests/e2e/fixtures/local-e2e-seed.ts`; do not duplicate fixture IDs.

## Evidence

The helper creates a unique directory under `.cursor/verification/verify-macro/`, outside generated instance state. Set `PROOF_DIR` only when a caller needs another durable location. Every proof run retains:

- `doctor.txt` for prerequisites and port diagnostics.
- `run.txt` for the exact Playwright command, assertions, and numeric exit status.
- `result.json` for instance identity, every stage's exit status, test arguments, cleanup status, and trace archive paths.
- `playwright/**/*.zip` from `--trace on`, which records the real browser actions, page snapshots, requests, and resulting state. Passing runs can use hashed archive names.

The helper starts with a fresh proof directory and requires the current successful run to produce non-empty trace archives. Exercise the real user path. Do not replace clicks, typing, navigation, or keyboard input with internal setters or test-only endpoints. Capture the action and result in the trace, not only a final assertion.

For mutations, verify the visible result through a second user-facing read before teardown. The isolated database is acceptable side-effect proof only in addition to the UI result. Mock only boundaries that the production architecture already isolates. A passing command without a retained trace is not complete proof.

## Cleanup

The helper always runs `just stack down --instance "$LOCAL_E2E_INSTANCE"` in its `finally` path and signal handlers. This removes only that run's containers, networks, volumes, and generated stack state. Never kill by process name, never run `docker compose down` without the instance, and never clean the shared `macro` instance.

After cleanup, confirm evidence survived:

Open the proof directory printed by `run-proof.ts`. Require non-empty `doctor.txt`, `run.txt`, and `result.json`, plus `proofExit: 0`, `cleanupExit: 0`, and at least one path in `traceArchives`. If any condition fails, report the run as incomplete.
