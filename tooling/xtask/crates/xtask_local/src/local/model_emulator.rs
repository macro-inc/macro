//! The model emulator (`crates/model_emulator`) as part of a local stack.
//!
//! A stack with no real Gemini key cannot reach the model a new account's
//! assistant runs on: every conversation would fail on its first request.
//! Such a stack runs the emulator instead, and the agent's model router
//! sends its Gemini requests there. The emulator runs no model: it answers
//! from scripts a test sets through its control API.
//!
//! A stack whose env carries a real key (Doppler, `--env-file`) talks to
//! Google as before and does not start the emulator.

use std::collections::BTreeMap;

use super::Mode;
use super::instance::{Instance, Port};

/// The emulator's Compose service.
pub const SERVICE: &str = "model_emulator";
/// The emulator's name on the services network.
const HOST: &str = "model-emulator";
const CONTAINER_PORT: u16 = 8080;
/// The env var of the Gemini key the agent's model router requires.
pub const API_KEY_VAR: &str = "GOOGLE_GENERATIVE_AI_API_KEY";
/// The key `BootStubEnv` gives the services so they start; no real key.
pub const PLACEHOLDER_API_KEY: &str = "local-google-generative-ai-key";

/// Whether this stack runs the emulator in place of Gemini: it is a
/// self-contained local stack, and its resolved env names no real key.
pub fn stands_in(mode: Mode, env: &BTreeMap<String, String>) -> bool {
    let real_key = env.get(API_KEY_VAR).is_some_and(|key| {
        let key = key.trim();
        !key.is_empty() && key != PLACEHOLDER_API_KEY
    });
    mode.spec().runs_local_infra && !real_key
}

/// The service URL override that sends the model router's Gemini requests
/// to the emulator.
pub fn env() -> BTreeMap<String, String> {
    BTreeMap::from([(
        "OVERRIDE_GOOGLE_GENERATIVE_AI_API_URL".to_string(),
        format!("http://{HOST}:{CONTAINER_PORT}"),
    )])
}

/// The emulator's command line inside the runtime image.
pub fn command() -> Vec<String> {
    vec![
        "/app/out/model_emulator".to_string(),
        "--listen".to_string(),
        format!("0.0.0.0:{CONTAINER_PORT}"),
    ]
}

/// The published port, where a test reaches the control API:
/// `<instance port>:<container port>`.
pub fn published_port(instance: &Instance) -> String {
    format!("{}:{CONTAINER_PORT}", instance.port(Port::ModelEmulator))
}

/// The emulator's network alias.
pub fn network_alias() -> &'static str {
    HOST
}

#[cfg(test)]
mod test;
