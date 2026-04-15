/// Channel name resolution logic.
pub mod channel_name;

/// Domain models for calls.
pub mod models;

/// Port traits for calls.
#[cfg(feature = "ports")]
pub mod ports;

/// Service orchestration for calls.
#[cfg(feature = "ports")]
pub mod service;
