# crates/testing

## What it is

Test support: the local end-to-end suite that drives an isolated local stack (`local_e2e`), the helpers other crates' tests use against it, and the Gmail and Outlook emulators. Only dev-dependencies may point here.

Layer: `testing` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`email_e2e`](email_e2e/AGENTS.md) | The end-to-end test suite for Email and Calendar: the real `email_service` API, its `pubsub_workers` (queue workers and the Outlook mailbox loops) and, when a scenario … |
| [`gmail_emulator`](gmail_emulator/AGENTS.md) | Test support for the Email and Calendar features: a stateful fake of the Google APIs our email, calendar and sign-in code call. |
| [`local_e2e`](local_e2e/AGENTS.md) | Belongs to local dev tooling: end-to-end Rust tests (`local_e2e` package) that run against an isolated local stack started through the xtask local orchestrator, seeded … |
| [`local_e2e_test_support`](local_e2e_test_support/AGENTS.md) | Belongs to local dev tooling: shared helpers for Rust local end-to-end tests — fixture loading, local JWTs, and local-only service URLs. |
| [`model_emulator`](model_emulator/AGENTS.md) | Test support for the agent: a stand-in for the Gemini API that answers from scripts instead of a model. |
| [`outlook_emulator`](outlook_emulator/AGENTS.md) | Test support for the Email and Calendar features: a stateful fake of the Microsoft Graph mail and calendar APIs and the Microsoft identity platform our email, calendar … |

## Recipes

- Add a crate here: create `crates/testing/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
