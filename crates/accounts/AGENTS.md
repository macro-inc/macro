# crates/accounts

## What it is

Accounts and teams: team membership and seats, onboarding, user API keys and languages, invites, account managers, system status, the native app service, last-online tracking, and the Microsoft OAuth grant and mobile welcome email stores.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`account_manager`](account_manager/AGENTS.md) | Part of account security: lets an agent account (`User."isAgent"`) manage a person's account. |
| [`gtm_invite`](gtm_invite/AGENTS.md) | Belongs to growth/GTM tooling: personal, time-limited signup links Macro staff create for prospects. |
| [`last_online_tracker`](last_online_tracker/AGENTS.md) | Belongs to notifications/presence: tracks each user's last-seen timestamp in Redis, written off the hot path through a background worker, for presence and notification … |
| [`microsoft_oauth_grant_db_utils`](microsoft_oauth_grant_db_utils/AGENTS.md) | Compatibility helpers for encrypted Microsoft OAuth envelopes in the legacy `microsoft_oauth_grants` table, keyed by owner and normalized email address. |
| `mobile_welcome_email_db_client` |  |
| [`native_app_service`](native_app_service/AGENTS.md) | Part of the native apps (Tauri desktop and iOS). |
| [`onboarding`](onboarding/AGENTS.md) | Part of the onboarding feature (`/setup`). |
| [`system_status`](system_status/AGENTS.md) | Platform status banner: Macro staff set the status (operational, degraded, major outage with a message) and every user sees a banner while it is not operational. |
| [`teams`](teams/AGENTS.md) | Part of account/workspace management — team membership, invites, roles, CRM/analytics settings, and the `macro.teams` lifecycle event producer that other features … |
| [`user_api_key`](user_api_key/AGENTS.md) | Part of account security — creates, lists, and deletes a user's API keys. |
| [`user_language`](user_language/AGENTS.md) | Part of the interface language setting. |

## Recipes

- Add a crate here: create `crates/accounts/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
