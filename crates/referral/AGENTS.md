# referral

## What it is

Part of the billing feature (referrals). Generates/redeems referral codes,
grants the Stripe discount, and notifies the referrer for the
invite-to-Macro flow.

## Start here

- `src/domain/service.rs`: `ReferralServiceImpl` — referral code generation,
  invite handling, and discount/notification orchestration.
- `src/domain/ports.rs`: `ReferralRepo`, `DiscountClient`, `ReferralService`.
- `src/outbound/pg_referral_repo.rs` + `src/outbound/stripe_discount_client.rs`:
  the Postgres and Stripe adapters.

## Scope

- Owns: referral code lifecycle and invite-to-Macro.
- Not here: the discount's actual billing effect → Stripe (via
  `stripe_discount_client.rs`, a thin client only); sending the notification
  itself → `notification`.

## Boundaries

- Depends on: `notification`, `macro_user_id`, `rate_limit` (via
  `services/authentication_service`'s wiring).
- Used by: `services/authentication_service`.

## Checks

- `cargo test -p referral` (`SQLX_OFFLINE` unset; requires local MacroDB).

## Related

- Rules: `.agents/rules/rust/architecture.md`
