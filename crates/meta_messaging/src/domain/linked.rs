//! Personal linked accounts and shared group publication policy. Protocol secrets
//! remain in the isolated session service; Macro is the native content authority.

pub mod models;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod service;
