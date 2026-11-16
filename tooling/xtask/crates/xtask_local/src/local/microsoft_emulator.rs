//! The Outlook emulator (`crates/outlook_emulator`) as part of a local stack.
//!
//! A stack with no real Microsoft OAuth client cannot reach Microsoft: Sign
//! in with Microsoft and Outlook linking have no application to consent to.
//! Such a stack runs the emulator instead. FusionAuth's `microsoft` identity
//! provider and the services' Microsoft service URLs point at it, so a
//! person signs in by picking a seeded user on the emulator's page and their
//! mailbox is the emulator's.
//!
//! A stack whose env carries a real Microsoft client (Doppler, `--env-file`)
//! talks to Microsoft as before and does not start the emulator.

use std::collections::BTreeMap;

use super::instance::{Instance, Port};
use super::{Mode, kickstart, repo_root, resources};

/// The emulator's Compose service.
pub const SERVICE: &str = "outlook_emulator";
/// The emulator's name on the services network.
const HOST: &str = "outlook-emulator";
const CONTAINER_PORT: u16 = 8080;
/// The seed inside the container.
const SEED_MOUNT: &str = "/etc/outlook-emulator/seed.yaml";
/// The users and mailboxes a stack starts with.
const SEED_FILE: &str = "crates/outlook_emulator/seed.example.yaml";
/// The OAuth client the services and FusionAuth present. The emulator
/// accepts any; the `local-` prefix marks it as no real application's.
const CLIENT_ID: &str = "local-microsoft-client";
const CLIENT_SECRET: &str = "local-microsoft-client-secret";
/// The tenant name that admits accounts of every directory, as deployed.
const TENANT: &str = "common";

/// Whether this stack runs the emulator in place of Microsoft: it runs its
/// own FusionAuth, and its resolved env names no real Microsoft client.
pub fn stands_in(mode: Mode, env: &BTreeMap<String, String>) -> bool {
    let real_client = env.get("MICROSOFT_CLIENT_ID").is_some_and(|client_id| {
        let client_id = client_id.trim();
        !client_id.is_empty() && client_id != CLIENT_ID
    });
    mode.spec().runs_local_infra && !real_client
}

fn in_network(path: &str) -> String {
    format!("http://{HOST}:{CONTAINER_PORT}{path}")
}

/// The emulator's origin as this instance's browser reaches it: its
/// published port, on the same `localhost` convention as FusionAuth's own
/// hosted pages.
pub fn browser_origin(instance: &Instance) -> String {
    format!("http://localhost:{}", instance.port(Port::OutlookEmulator))
}

/// The identity-provider settings that make FusionAuth treat the emulator
/// as Microsoft. FusionAuth discovers the endpoints from the issuer, from
/// inside its container.
pub fn idp() -> kickstart::MicrosoftIdp {
    kickstart::MicrosoftIdp {
        client_id: CLIENT_ID.to_string(),
        client_secret: CLIENT_SECRET.to_string(),
        issuer: in_network(&format!("/{TENANT}/v2.0")),
    }
}

/// What sends the services' Microsoft calls to the emulator and turns
/// Outlook on: the service URL overrides, the OAuth client the
/// authentication service links mailboxes with, and the Outlook switches.
/// Only the login page URL is opened by a browser.
pub fn env(instance: &Instance) -> BTreeMap<String, String> {
    [
        ("OVERRIDE_MICROSOFT_GRAPH_URL", in_network("/v1.0/")),
        ("OVERRIDE_MICROSOFT_LOGIN_URL", in_network("/")),
        (
            "OVERRIDE_MICROSOFT_LOGIN_PAGE_URL",
            format!("{}/", browser_origin(instance)),
        ),
        ("MICROSOFT_CLIENT_ID", CLIENT_ID.to_string()),
        ("MICROSOFT_CLIENT_SECRET", CLIENT_SECRET.to_string()),
        ("MICROSOFT_TENANT_ID", TENANT.to_string()),
        (
            "MICROSOFT_TOKEN_KMS_KEY_ID",
            resources::MICROSOFT_TOKEN_KMS_ALIAS.to_string(),
        ),
        ("OUTLOOK_CONNECTIONS_ENABLED", "true".to_string()),
        ("OUTLOOK_SYNC_ENABLED", "true".to_string()),
        ("OUTLOOK_WRITES_ENABLED", "true".to_string()),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_string(), value))
    .collect()
}

/// The Compose service of the authentication service.
pub const AUTHENTICATION_SERVICE: &str = "authentication-service";

/// What the authentication service's container gets besides the shared
/// env: no PostHog project key. With one, a new Outlook connection also
/// needs the user's `enable-outlook` flag, which no seeded user of the
/// emulator has and which the stack's placeholder key cannot even load;
/// without one, `OUTLOOK_CONNECTIONS_ENABLED` alone decides.
pub fn authentication_service_env() -> [(&'static str, &'static str); 1] {
    [("POSTHOG_API_KEY", "")]
}

/// The emulator's command line inside the runtime image. Links in its
/// answers are on the address services reach it at; the sign-in page is
/// advertised where this instance's browser reaches it.
pub fn command(instance: &Instance) -> Vec<String> {
    [
        "/app/out/outlook_emulator",
        "--listen",
        &format!("0.0.0.0:{CONTAINER_PORT}"),
        "--seed",
        SEED_MOUNT,
        "--public-url",
        &in_network(""),
        "--browser-url",
        &browser_origin(instance),
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
    format!("{}:{CONTAINER_PORT}", instance.port(Port::OutlookEmulator))
}

/// The emulator's network alias.
pub fn network_alias() -> &'static str {
    HOST
}

#[cfg(test)]
mod test;
