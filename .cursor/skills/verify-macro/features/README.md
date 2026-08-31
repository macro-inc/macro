# Macro verification map

This directory is the maintained source for verifying Macro's user-facing web behavior. Read this index before driving the app, then follow the matching feature file.

## Baseline preconditions

- Run from the repository root in the pinned Nix environment entered by `just local-e2e`.
- Let `run-proof.ts` generate a unique `verify-macro-` instance for every run.
- Let the helper run `doctor-local` against that generated instance before launch.
- Use the deterministic `e2e@macro.local` identity and fixtures loaded by `localE2ESeed`.
- Never drive the shared `macro` instance or an instance not created by this verification run.

## Driving conventions

- Start from the seeded state unless the feature says otherwise.
- Use the repository-level `just local-e2e` harness.
- Prefer stable data attributes and accessible names over CSS position or coordinates.
- Treat mapped commands, fixture names, and UUID-backed selectors as literal.
- Keep Playwright serial. The local E2E stack and authenticated user are shared within one run.

## Proof and skip reporting

- Capture the user action and resulting state in a retained Playwright trace.
- Keep the doctor output, terminal transcript, and Playwright `.zip` trace archives under the unique directory printed by `run-proof.ts`.
- For mutations, verify the result from a second user-facing view before teardown.
- Report an unreachable entry point with the attempted command and unmet precondition.
- Do not claim an unexercised entry point passed because another path did.
- Clean up the named stack, then confirm the proof directory still exists.

## Feature entry contract

Each feature file describes the user-visible behavior, entry points, exact Playwright path, observable proof, and known traps. Keep implementation details out unless they define a stable selector or required fixture.

## Features

- [Browse files](./browse-files.md) covers opening Files and seeing a seeded document.
- [Search](./search.md) covers searching for a seeded document, opening it, and restoring search state.
- [Browse channels](./browse-channels.md) covers opening Channels and reading seeded channel content.
- [Sidebar navigation](./sidebar-navigation.md) covers the primary workspace destinations and loaded list states.
