//! Core realtime Soup contracts and orchestration.

/// Who receives realtime Soup events outside Macro.
pub mod events;

/// Versioned output message models.
pub mod models;

/// Inbound and outbound domain ports.
#[cfg(feature = "ports")]
pub mod ports;

/// Realtime Soup fan-out service.
#[cfg(feature = "ports")]
pub mod service;
