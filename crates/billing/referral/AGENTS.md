# referral

## What it is

Part of the billing feature (referrals). Generates referral codes, records a
referral when a brand-new user signs up through one, and rewards the referrer
($10 of AI credit, or more free allowance) through the `ReferralRewarder`
port. Also sends invite-to-Macro emails.

## Start here

- `src/domain/service.rs`: `ReferralServiceImpl` — referral code generation,
  referral tracking plus the referrer reward, and invite emails.
- `src/domain/ports.rs`: `ReferralRepo`, `ReferralRewarder`, `ReferralService`.
- `src/outbound/pg_referral_repo.rs`: the Postgres adapter. A user is referred
  at most once (unique `referral_tracking.referred_id`).

## Scope

- Owns: referral code lifecycle and invite-to-Macro.
- Not here: the reward itself → `crates/ai_billing` (`InviteRewardService`,
  wired in `services/authentication_service/src/outbound/invite_rewards.rs`);
  sending the notification itself → `notification`.

## Boundaries

- Depends on: `notification`, `macro_user_id`, `rate_limit` (via
  `services/authentication_service`'s wiring).
- Used by: `services/authentication_service`.

## Checks

- `cargo test -p referral` (`SQLX_OFFLINE` unset; requires local MacroDB).

## Related

- Rules: `.agents/rules/rust/architecture.md`
