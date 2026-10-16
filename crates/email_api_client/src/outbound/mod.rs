//! Provider-specific outbound email API adapters.

/// Gmail outbound adapter implementation.
#[cfg(feature = "outbound-gmail")]
pub mod gmail;

/// Microsoft Graph outbound adapter implementation.
#[cfg(feature = "outbound-outlook")]
pub mod outlook;

/// Cross-service Microsoft request admission.
#[cfg(feature = "microsoft-gate")]
pub mod microsoft_gate;
