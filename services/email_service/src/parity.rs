//! Characterization of the production HTTP surface with isolated dependencies.

mod capture;
mod database;
mod fixture;
mod kafka;
mod lab;
mod normalize;
mod redis;
mod sql_fault;
mod stub;
mod suites;
mod test;
mod transcript;

/// The recorder owns process-global tracing; nextest isolates every test.
pub(crate) fn process_per_test() -> bool {
    if std::env::var_os("NEXTEST").is_some() {
        true
    } else {
        eprintln!("parity: skipped, run with cargo nextest (process per test)");
        false
    }
}

// Reuse the repository's local-only identity signing fixtures; never copy key
// material into the lab or depend on credentials from the process environment.
const PRIVATE_KEY: &str = include_str!(
    "../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC_KEY: &str = include_str!(
    "../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

pub(crate) type HttpRecording = std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>;

/// Canonical body representation shared by the recording HTTP fakes.
pub(crate) fn http_body(bytes: &[u8]) -> serde_json::Value {
    use sha2::{Digest, Sha256};
    serde_json::from_slice(bytes).unwrap_or_else(|_| {
        serde_json::json!({
            "bytes": bytes.len(), "sha256": format!("{:x}", Sha256::digest(bytes)),
        })
    })
}
