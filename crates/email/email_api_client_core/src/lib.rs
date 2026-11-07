#![deny(missing_docs)]

//! Provider-neutral models, capability ports and orchestration for email
//! provider integrations.
//!
//! The Gmail and Microsoft Graph adapters live in `email_api_client_outbound`.

/// Provider-neutral values exchanged across email API boundaries.
pub mod models;

/// Capability-oriented provider and infrastructure ports.
#[cfg(feature = "ports")]
pub mod ports;

/// Provider-neutral email API orchestration.
#[cfg(feature = "ports")]
pub mod service;

/// Counts provider requests made inside one unit of work.
#[cfg(feature = "ports")]
pub mod request_count;
