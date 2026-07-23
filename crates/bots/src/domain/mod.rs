//! Domain layer for bots.

/// Bot lifecycle event contracts.
pub mod events;
/// Bot domain models.
pub mod models;
#[cfg(feature = "ports")]
/// Bot ports.
pub mod ports;
#[cfg(feature = "ports")]
/// Bot service.
pub mod service;
/// Token utilities.
pub mod tokens;
