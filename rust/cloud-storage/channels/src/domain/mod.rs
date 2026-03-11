/// Domain models for channel messages.
pub mod models;
#[cfg(feature = "ports")]
/// Port traits for channel messages.
pub mod ports;
#[cfg(feature = "ports")]
/// Service orchestration for channel messages.
pub mod service;
