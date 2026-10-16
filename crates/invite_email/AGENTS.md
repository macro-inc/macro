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

## Related

- Docs: `packages/email-renderer/README.md` (if rendering in the standalone
  renderer rather than the email template pipeline here)
