# crates/notifications

## What it is

Notifications: the notification domain (creation, fan-out, push and email delivery), its storage, the notification inbox, and `model_notifications`, the per-kind notification payloads other domains emit.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`model_notifications`](model_notifications/AGENTS.md) | Part of the notifications feature. |
| [`notification`](notification/AGENTS.md) | The notifications feature's hexagonal core. |
| [`notification_db_client`](notification_db_client/AGENTS.md) | Part of the notifications feature. |
| [`notification_inbox`](notification_inbox/AGENTS.md) | The unified notifications inbox: the viewer's pending notifications grouped by the entity they are filed under and cut into rows (one per channel thread, channel top … |

## Recipes

- Add a crate here: create `crates/notifications/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
