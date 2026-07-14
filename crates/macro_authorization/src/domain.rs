//! Authorization domain models, ports, and service implementation.

/// Models produced and consumed by the authorization domain.
pub mod models;
/// Interfaces that connect the authorization domain to its adapters.
pub mod ports;
/// Authorization service implementation.
pub mod service;
