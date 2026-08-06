//! Domain models and capability boundaries for email provider APIs.

/// Provider-neutral values exchanged across email API boundaries.
pub mod models;

/// Capability-oriented provider and infrastructure ports.
#[cfg(feature = "ports")]
pub mod ports;
