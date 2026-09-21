#![deny(missing_docs)]
//! Workspace privacy policy. Enabling safeguards is separate from certifying HIPAA compliance.

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
