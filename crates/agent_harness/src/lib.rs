//! Container transports for sandboxed coding-agent sessions.
//!
//! A provisioned container implements the agent-session transport contract and
//! can be attached to [`agent_session::domain::service::AgentSessionService`].
//! This crate owns container provider ports and adapters; `agent_session` owns
//! persistence, ACP lifecycle, active actors, ordering, and logging.
//!
//! Nothing here reads the environment or constructs its own adapters - that is
//! the binary's job in `services/agent_harness_service`.
#![deny(missing_docs)]
// Every implementation below the ports is still `todo!()`, so the fields the
// adapters hold are written but never read. Comes out as they land.
#![allow(dead_code)]

/// Harness commands, orchestration, and required outbound ports.
pub mod domain;
pub mod inbound;
pub mod outbound;
/// Test doubles for the ports.
pub mod testing;

/// Choose the TLS backend for this process.
///
/// Must be called before anything dials TLS. Both `ring` and `aws-lc-rs` end up
/// in this workspace's dependency graph - `aws-lc-rs` through the AWS SDK that
/// `kafka_util` pulls in for MSK IAM - so rustls refuses to pick one and panics
/// on first use instead. `reqwest` never trips this because it selects a
/// provider internally; the sidecar's WebSocket dial goes through
/// `tokio-tungstenite`, which does not.
///
/// Lives here rather than in the pump so the choice stays a process-level
/// decision the binaries make, but is written once so they cannot disagree.
/// Idempotent: a second call is a no-op rather than an error.
pub fn install_tls_provider() {
    // `Err` means a provider is already installed, which is the desired state.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}
