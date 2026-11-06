# crates/email

## What it is

Email: the email domain (sync, threads, drafts, sending, scheduled and focus processing), the Gmail and Outlook API client, its stores, formatting and validation helpers, invite and reminder emails, and Google token handling.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`email`](email/AGENTS.md) | The core of the Email feature: threads/messages orchestration, scheduling and reminders/followups, calendar-invitation extraction, and the AI email tools — hexagonal … |
| [`email_api_client`](email_api_client/AGENTS.md) | Part of the Email feature: provider-neutral contracts and models for email provider integrations (sync, send, tokens, rate limits), plus the Gmail and Outlook (Microsoft … |
| [`email_db_client`](email_db_client/AGENTS.md) | Part of the Email feature: the SQLx query crate for MacroDB's email tables — messages, threads, contacts, labels, links, attachments, sync tokens, CRM cleanup, and … |
| `email_formatting` |  |
| [`email_utils`](email_utils/AGENTS.md) | Part of the Email feature: shared email text handling — HTML sanitization, reply-quote stripping, body parsing, contact name normalization, and sender/generic-address … |
| `email_validator` |  |
| `generic_email_domains` |  |
| `google_token` |  |
| [`invite_email`](invite_email/AGENTS.md) | Belongs to notifications: domain models and Askama templates for invitation emails — referral-to-Macro invites, team invites, channel invites, call invites, and the … |
| [`reminders`](reminders/AGENTS.md) | Part of the Email feature. |

## Recipes

- Add a crate here: create `crates/email/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
