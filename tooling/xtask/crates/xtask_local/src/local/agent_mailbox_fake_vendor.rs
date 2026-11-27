//! The fake deadsimple.email API (`crates/agent_mailbox_fake_vendor`) as
//! part of a local stack.
//!
//! A stack with no real provisioning key runs the fake, and email_service's
//! agent mailboxes provision, read and send against it. No real mail moves;
//! every mailbox the stack shows says "fake vendor, not live". A stack whose
//! env carries a real key (Doppler, `--env-file`) talks to the provider.

use std::collections::BTreeMap;

use super::Mode;
use super::instance::{Instance, Port};

/// The fake's Compose service.
pub const SERVICE: &str = "agent_mailbox_fake_vendor";
/// The fake's name on the services network.
const HOST: &str = "agent-mailbox-fake-vendor";
const CONTAINER_PORT: u16 = 8080;
/// The env var of the provisioning key email_service reads.
pub const API_KEY_VAR: &str = "DEADSIMPLE_API_KEY";
/// The provisioning key the fake accepts. Not a real key.
pub const FAKE_API_KEY: &str = "dse_fake_not_live";

/// Whether this stack runs the fake: it is self-contained, and its resolved
/// env names no real key.
pub fn stands_in(mode: Mode, env: &BTreeMap<String, String>) -> bool {
    let real_key = env.get(API_KEY_VAR).is_some_and(|key| {
        let key = key.trim();
        !key.is_empty() && key != FAKE_API_KEY
    });
    mode.spec().runs_local_infra && !real_key
}

/// The service URL override and key that send agent mailboxes to the fake.
pub fn env() -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "OVERRIDE_DEAD_SIMPLE_API_URL".to_string(),
            format!("http://{HOST}:{CONTAINER_PORT}"),
        ),
        (API_KEY_VAR.to_string(), FAKE_API_KEY.to_string()),
    ])
}

/// The fake's command line inside the runtime image.
pub fn command() -> Vec<String> {
    vec![
        "/app/out/agent_mailbox_fake_vendor".to_string(),
        "--listen".to_string(),
        format!("0.0.0.0:{CONTAINER_PORT}"),
        "--admin-key".to_string(),
        FAKE_API_KEY.to_string(),
    ]
}

/// The published port: `<instance port>:<container port>`.
pub fn published_port(instance: &Instance) -> String {
    format!(
        "{}:{CONTAINER_PORT}",
        instance.port(Port::AgentMailboxFakeVendor)
    )
}

/// The fake's network alias.
pub fn network_alias() -> &'static str {
    HOST
}

#[cfg(test)]
mod test;
