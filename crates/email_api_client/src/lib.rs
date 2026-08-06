#![deny(missing_docs)]

//! Provider-neutral contracts and models for email provider integrations.

/// Provider-neutral domain types and, when enabled, capability ports.
pub mod domain;

/// Provider-specific outbound adapters.
#[cfg(feature = "outbound-gmail")]
pub mod outbound;

#[cfg(feature = "outbound-gmail")]
pub use outbound::gmail::GmailApiClientRepository;
