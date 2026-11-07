//! Domain layer: models, ports, and service implementation.

pub mod models;

/// Committed pull request facts.
pub mod events;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "service")]
pub mod service;
