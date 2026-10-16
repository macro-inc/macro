# ses_client

## What it is

Part of shared infrastructure (transactional email). Outbound email
delivery: SES in dev/prod, local SMTP (Mailpit) when `SMTP_HOST` is set,
used by `authentication_service` for invite emails.

## Start here

- `src/lib.rs`: `SesClient`/`Ses` (aliased to `MockSesClient` under `#[cfg(test)]`
  via `mockall::automock`) and the `Transport` enum that picks SES vs. SMTP.
- `src/send_email.rs` / `src/send_email_smtp.rs`: the two delivery paths.
- `src/invite_user.rs`: the invite email template and subject.

## Scope

- Owns: choosing and driving the email transport, and the invite-email template.
- Not here: other transactional email templates (those compose their own HTML
  and call `send_email`).

## Boundaries

- Depends on: `macro_env_var` (the `SMTP_HOST`/`SMTP_PORT` escape hatch).
- Used by: `authentication_service`.

## Recipes

- Send a new kind of email: build its HTML, call `Ses::send_email` (or
  `invite_user` as a template) — don't add a new transport branch per email kind.

## Checks

- `cargo test -p ses_client` (`SQLX_OFFLINE` unset).

## Gotchas

- `#[cfg(test)] pub use MockSesClient as Ses` means tests always get the mock;
  there is no way to exercise the real `SesClient` type under `cargo test`.
- The local SMTP transport is plaintext (`builder_dangerous`) — never route
  through it outside local dev.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
