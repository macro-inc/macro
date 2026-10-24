# invite_email

## What it is

Belongs to notifications: domain models and Askama templates for invitation
emails — referral-to-Macro invites, team invites, channel invites, call
invites, and the colleague-joined email.

## Start here

- `src/lib.rs`: `InviteToMacro`, `ReferralCode`, and the other top-level
  notification metadata types — each derives `Template` against a file in
  `templates/`.
- `src/call_invite.rs`, `src/colleague_joined.rs`: the remaining notification
  metadata types, one file each.
- `templates/*.html`: the actual email markup (Askama/Jinja2-compatible
  syntax).
- `preview_invite.py`: renders `templates/invite.html` with dummy data via
  Jinja2 and opens it in a browser — use this to check template changes
  without sending an email (`pip3 install jinja2` if needed).

## Scope

- Owns: invite/referral/colleague-joined email notification metadata and
  templates.
- Not here: sending/queuing the notification → `crates/notification`; who
  triggers an invite → `crates/call`, `crates/referral`, `model_notifications`.

## Boundaries

- Depends on: `notification` (for `Notification`, `NotificationExtEmail`
  types), `macro_env`, `macro_user_id`, `model-entity`.
- Used by: `model_notifications`, `call`, `referral`.

## Recipes

- Add a new invite email: new metadata type in `src/<name>.rs` deriving
  `Template` → `templates/<name>.html` → `pub use` it from `src/lib.rs`.
- Change an email's markup: `templates/<name>.html` → preview with
  `preview_invite.py` (edit its dummy data / template path first) → verify
  against the type's fields in `src/lib.rs`.

## Checks

- `cargo test -p invite_email`.

## Gotchas

- The team invite email promises what joining gives (`InviteePlan`). The
  sender, `teams`' `invite_users_to_team`, derives it the way `join_team`
  grants entitlements: Pro only from an enterprise team or one with a
  subscription. Never let the copy promise more than the join grants.
- `InviteToTeamMetadata.reminder` marks the reminder emails `teams` sends for
  unanswered invites; it only prefixes the subject with "Reminder:". A
  reminder shares the invite's rate-limit bucket (one email per invite per
  2 days), so reminders must stay more than 2 days apart.
- Metadata is queued and stored as JSON, and the notification service
  publishes it in its OpenAPI spec. A new field needs `#[serde(default)]` so
  payloads queued before a deploy still deserialize, and a regenerated web
  client (`bun run gen-api notification-service` in `apps/web`).

## Related

- Docs: `packages/email-renderer/README.md` (if rendering in the standalone
  renderer rather than the email template pipeline here)
