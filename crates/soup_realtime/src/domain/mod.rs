//! Core realtime Soup contracts and orchestration.

/// Versioned output message models.
pub mod models;

/// Inbound and outbound domain ports.
#[cfg(feature = "ports")]
pub mod ports;

/// Realtime Soup fan-out service.
#[cfg(feature = "ports")]
pub mod service;
