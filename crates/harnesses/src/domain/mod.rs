//! Harness domain.

/// Domain models.
pub mod models;
/// Ports connecting the domain to its adapters.
pub mod ports;
/// Domain service implementation.
pub mod service;
/// Pairing code, device secret, and harness token generation.
pub mod tokens;
