# authentication_service

## What it is

Account sign-in and identity feature: FusionAuth-backed login, session/JWT
issuance, signup policy and allowlisting, OAuth/OAuth2 account linking
(Google/Microsoft/GitHub), subscription checkout status, Cursor/Codex API
key issuance, and account merge/link flows.

## Start here

- `src/api.rs`: route module list (`login`, `oauth`, `oauth2`, `session`,
  `jwt`, `webhooks`, `signup_policy`, `codex`, `cursor_api_key`, `merge`, ...).
- `src/service/signup_policy/`: `SignupPolicy` built at startup; enforced
  authoritatively by the FusionAuth `user.create` webhook
  (`src/api/webhooks`), not by the public precheck routes.
- `src/config.rs` + `src/doppler_config.rs`: env vars and the Doppler config
  validator binary (`authentication_service_doppler_config`).
- `README.md`: the Develop signup allowlist (bypass flag, rollout/rollback
  steps) and GTM invite links — read before touching signup policy.

## Scope

- Owns: FusionAuth-backed login/session issuance, JWT minting, signup
  allowlisting, OAuth/OAuth2 account linking, GTM invite links, shared-mailbox
  relocation signup, Cursor/Codex API key endpoints.
- Not here: authorization/permission decisions on other entities →
  `crates/macro_authorization`; subscription/billing logic itself →
  `crates/ai_billing`, `crates/initiative`.

## Recipes

- Add a route: domain crate (if any) → `src/api/<area>.rs` → `src/api.rs`
  (router) → `src/openapi.rs`.
- Change signup policy: `src/service/signup_policy/` → `src/config.rs` → the
  Develop allowlist rollout steps in `README.md`.
- Add a config value: `src/config.rs` → Doppler project
  `authentication-service` → verify with
  `authentication_service_doppler_config`.

## Checks

- `cargo test -p authentication_service` (`SQLX_OFFLINE` unset).
- Signup-policy changes specifically:
  `env -u DATABASE_URL cargo test -p authentication_service --bin authentication_service config::test`
  and `cargo run -p authentication_service --bin authentication_service_doppler_config`.

## Gotchas

- The signup allowlist has a temporary Develop-only bypass
  (`DEVELOPMENT_BYPASS_SIGNUP_ALLOWLIST`) that overrides the allowlist even
  when present; see `README.md` before changing signup behavior.
- Denial responses and policy errors must never disclose configured allowlist
  addresses; never paste operational addresses into code, logs, or docs.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`,
  `.agents/rules/rust/security.md` · Skill: `new-service`
