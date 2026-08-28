//! The fixed local FusionAuth/JWT identity, the shared internal-auth key, and
//! the per-instance secret derivation.
//!
//! These are NOT optional defaults — they're the mandatory contract that the
//! FusionAuth kickstart (which writes them *into* FusionAuth) and the service env
//! (which tells the services what identity to expect) must agree on byte-for-byte.
//! Single-sourcing them here is what prevents the kickstart↔service drift that
//! the old Pulumi-configure-then-patch-`.env` approach kept hitting. They are
//! deterministic, local-only, and safe to check in — never used in dev or prod.

/// FusionAuth API key registered by the kickstart and used by services that
/// call the FusionAuth admin API (auth-service).
pub const FUSIONAUTH_API_KEY: &str = "bf69486b-4733-4954-a44e-2e1b5f2c8a91";

/// HS256 signing key id imported by the kickstart and referenced by the tenant
/// / application JWT config.
pub const JWT_SIGNING_KEY_ID: &str = "d7d09513-a3f5-401c-9685-34ab6c552453";

/// The HS256 secret. `macro_auth` reads this as `JWT_SECRET_KEY`.
pub const JWT_SECRET: &str = "super-secret-jwt-signing-key-for-local-development-only";

/// The populate-JWT lambda id (the unlicensed local variant).
pub const POPULATE_JWT_LAMBDA_ID: &str = "a7f3e8d2-4b91-4c5a-9e6f-1a2b3c4d5e6f";

/// The Macro application id. Client id == application id == JWT `aud`
/// (`AUDIENCE`). Must NOT be FusionAuth's reserved built-in application id
/// (`3c219e58-ed0e-4b18-ad48-f4f92793ae32`, the "FusionAuth" admin app), which
/// already exists on every instance and would make the kickstart's
/// create-application step fail with `[duplicate]applicationId`.
pub const APPLICATION_ID: &str = "22222222-2222-4222-8222-222222222222";

/// A fixed local tenant id (deterministic, local-only). This is FusionAuth's
/// built-in default tenant, pinned via the kickstart `defaultTenantId`
/// variable and reconfigured in place — local is single-tenant by design.
pub const TENANT_ID: &str = "11111111-1111-4111-8111-111111111111";

/// A fixed OAuth client secret (deterministic, local-only).
pub const CLIENT_SECRET: &str = "c3VwZXItc2VjcmV0LWxvY2FsLWNsaWVudC1zZWNyZXQtMDE";

/// The JWT issuer the tenant emits; `macro_auth` checks `iss` against this.
pub const ISSUER: &str = "local.macro.com";

/// Fixed id for the passwordless-login email template the kickstart creates.
pub const PASSWORDLESS_EMAIL_TEMPLATE_ID: &str = "33333333-3333-4333-8333-333333333333";

/// Fixed id for the `google` (plain login) OIDC identity provider. Only created
/// when a Google OAuth client is configured (see `kickstart::GoogleIdp`).
pub const GOOGLE_IDP_ID: &str = "44444444-4444-4444-8444-444444444444";

/// Fixed id for the `google_gmail` (Gmail-scoped) OIDC identity provider.
/// `authentication_service` resolves it by name, so the id only has to be
/// stable, not shared with dev/prod.
pub const GOOGLE_GMAIL_IDP_ID: &str = "55555555-5555-4555-8555-555555555555";

/// Fixed id for the reconcile lambda attached to `google_gmail` (blocks
/// sign-in with a Google account that is linked as a secondary inbox).
pub const RECONCILE_LAMBDA_ID: &str = "66666666-6666-4666-8666-666666666666";

/// Fixed id for the `github` identity provider. Only created when a real
/// GitHub OAuth client is configured (see `kickstart::GithubIdp`).
///
/// Read from both ends, which is why it is here rather than written twice:
/// `authentication_service` resolves the provider *by name* when it starts a
/// link, and separately takes this id from `GITHUB_IDP_ID` for the link calls
/// themselves. The kickstart therefore has to create one provider that is both
/// named `github` and has this id, or the two halves address different things.
pub const GITHUB_IDP_ID: &str = "99999999-9999-4999-8999-999999999999";

/// Local from-address for FusionAuth-sent mail (lands in Mailpit).
pub const MAIL_FROM: &str = "noreply@macro.local";

/// The internal service-to-service auth key in local mode. Services read it as
/// `INTERNAL_API_SECRET_KEY`; the FusionAuth kickstart's user webhooks send it
/// as `x-internal-auth-key`. They MUST match (a mismatch makes the webhook's
/// new-user registration fail), so both sides read this one constant. Local-only.
pub const INTERNAL_AUTH_KEY: &str = "local";

/// The auth-service OAuth redirect URI for an instance on `auth_port`. The
/// FusionAuth kickstart authorizes it and services read it as
/// `FUSIONAUTH_OAUTH_REDIRECT_URI` — build it one way so they can't drift.
pub fn oauth_redirect_uri(auth_port: u16) -> String {
    format!("http://localhost:{auth_port}/oauth/redirect")
}

/// Deterministically derive a local-only internal secret from a label and the
/// instance name, so every container in one instance agrees (e.g. services and
/// sync_service must share `INTERNAL_API_SECRET_KEY`) while different instances
/// stay isolated. Local-only; never a real secret.
pub fn instance_secret(label: &str, instance: &str) -> String {
    format!("local-{instance}-{label}")
}
