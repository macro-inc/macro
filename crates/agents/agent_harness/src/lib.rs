//! Container transports for sandboxed coding-agent sessions.
//!
//! Agent harness orchestration and container providers.
#![deny(missing_docs)]

/// Harness commands, orchestration, and required outbound ports.
pub mod domain;
pub mod inbound;
pub mod outbound;
/// Test doubles for the ports.
pub mod testing;

/// Install the process-wide TLS provider used by outbound clients.
pub fn install_tls_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}
