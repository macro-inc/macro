//! The Gmail emulator (`crates/gmail_emulator`) as part of a local stack.
//!
//! A stack with no real Google OAuth client cannot reach Google: sign-in with
//! Google and Gmail linking would dead-end at a consent screen for a client
//! that does not exist. Such a stack runs the emulator instead. FusionAuth's
//! `google` and `google_gmail` identity providers and the services' Google
//! service URLs point at it, so a person signs in by picking a seeded user
//! on the emulator's page and their mailbox is the emulator's.
//!
//! A stack whose env carries a real Google client (Doppler, `--env-file`)
//! talks to Google as before and does not start the emulator.

use std::collections::BTreeMap;

use super::instance::{Instance, Port};
use super::{Mode, kickstart, repo_root};

/// The emulator's Compose service.
pub const SERVICE: &str = "gmail_emulator";
/// The emulator's name on the services network.
const HOST: &str = "gmail-emulator";
const CONTAINER_PORT: u16 = 8080;
/// The seed inside the container.
const SEED_MOUNT: &str = "/etc/gmail-emulator/seed.yaml";
/// The users and mailboxes a stack starts with.
const SEED_FILE: &str = "crates/gmail_emulator/seed.example.yaml";
/// The OAuth client the services and FusionAuth present. It matches the
/// placeholders `BootStubEnv` gives the services; the emulator accepts any.
const CLIENT_ID: &str = "local-google-client";
const CLIENT_SECRET: &str = "local-google-client-secret";

/// Whether this stack runs the emulator in place of Google: it runs its own
/// FusionAuth, and its resolved env names no real Google client.
pub fn stands_in(mode: Mode, env: &BTreeMap<String, String>) -> bool {
    mode.spec().runs_local_infra && kickstart::GoogleIdp::from_env(env).is_none()
}

fn in_network(path: &str) -> String {
    format!("http://{HOST}:{CONTAINER_PORT}{path}")
}

/// Google's authorization endpoint as this instance's browser reaches it:
/// the emulator's published port, on the same `localhost` convention as
/// FusionAuth's own hosted pages.
pub fn authorization_endpoint(instance: &Instance) -> String {
    format!(
        "http://localhost:{}/o/oauth2/v2/auth",
        instance.port(Port::GmailEmulator)
    )
}

/// The identity-provider settings that make FusionAuth treat the emulator
/// as Google.
pub fn idp(instance: &Instance) -> kickstart::GoogleIdp {
    kickstart::GoogleIdp {
        client_id: CLIENT_ID.to_string(),
        client_secret: CLIENT_SECRET.to_string(),
        authorization_endpoint: authorization_endpoint(instance),
        token_endpoint: in_network("/token"),
        userinfo_endpoint: in_network("/v1/userinfo"),
    }
}

/// The service URL overrides that send the services' Google calls to the
/// emulator. Only the authorization URL is opened by a browser.
pub fn env(instance: &Instance) -> BTreeMap<String, String> {
    [
        ("OVERRIDE_GMAIL_API_URL", in_network("/gmail/v1")),
        ("OVERRIDE_GOOGLE_PEOPLE_API_URL", in_network("/people/v1")),
        (
            "OVERRIDE_GOOGLE_OAUTH_CERTS_URL",
            in_network("/oauth2/v3/certs"),
        ),
        ("OVERRIDE_GOOGLE_OAUTH_TOKEN_URL", in_network("/token")),
        ("OVERRIDE_GOOGLE_OAUTH_REVOKE_URL", in_network("/revoke")),
        (
            "OVERRIDE_GOOGLE_OAUTH_AUTHORIZATION_URL",
            authorization_endpoint(instance),
        ),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_string(), value))
    .collect()
}

/// The emulator's command line inside the runtime image. It pushes Gmail
/// watch notifications straight to the email service's webhook, the job the
/// `gmail_forwarder` sidecar does for real Google.
pub fn command() -> Vec<String> {
    [
        "/app/out/gmail_emulator",
        "--listen",
        &format!("0.0.0.0:{CONTAINER_PORT}"),
        "--seed",
        SEED_MOUNT,
        "--push-endpoint",
        "http://email-service:8080/gmail/webhook",
    ]
    .iter()
    .map(|argument| argument.to_string())
    .collect()
}

/// The seed file's bind mount.
pub fn seed_volume() -> String {
    format!("{}:{SEED_MOUNT}:ro", repo_root().join(SEED_FILE).display())
}

/// The published port: `<instance port>:<container port>`.
pub fn published_port(instance: &Instance) -> String {
    format!("{}:{CONTAINER_PORT}", instance.port(Port::GmailEmulator))
}

/// The emulator's network alias.
pub fn network_alias() -> &'static str {
    HOST
}

#[cfg(test)]
mod test;
