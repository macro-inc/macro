# ai_admission

## What it is

AI billing: the admission port (`AiAdmissionService`) that gates user-owned AI
work, its public errors (`AiAdmissionError`, `DenyReason`) and their HTTP
contract. Split out of `ai_billing` so crates that only admit AI work, such
as `jev_classifier`, need not compile billing, teams and Stripe.

## Scope

- Owns: the port, `DisabledAiAdmissionService`, the error codes and messages,
  and `IntoResponse` for `AiAdmissionError` (402 for denials, 503 when billing
  can't validate).
- Not here: the billing-backed implementation, `BillingAdmissionService` →
  `crates/billing/ai_billing`.

## Boundaries

- Depends on: `ai_usage` (for `AiFeature`), `macro_user_id`.
- Used by: `ai_billing` (re-exports everything at its old paths), `jev_classifier`.

## Gotchas

- Error codes and messages are a public API contract; the tests in
  `src/http/test.rs` pin them.

## Checks

- `cargo test -p ai_admission`
