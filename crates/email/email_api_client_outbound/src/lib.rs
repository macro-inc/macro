#![deny(missing_docs)]

//! Gmail and Microsoft Graph adapters for the `email_api_client_core` ports,
//! plus the Redis admission gate every Graph request passes.

/// Gmail outbound adapter implementation.
#[cfg(feature = "outbound-gmail")]
pub mod gmail;

/// Microsoft Graph outbound adapter implementation.
#[cfg(feature = "outbound-outlook")]
pub mod outlook;

/// Cross-service Microsoft request admission.
#[cfg(feature = "microsoft-gate")]
pub mod microsoft_gate;

#[cfg(feature = "outbound-gmail")]
pub use gmail::GmailApiClientRepository;

#[cfg(feature = "outbound-outlook")]
pub use outlook::OutlookApiClientRepository;
