//! Authorization domain models, ports, and service implementation.

/// Bot credential authorization policy.
pub mod bot_authorizer;
/// Harness credential authorization policy.
pub mod harness_authorizer;
/// Models produced and consumed by the authorization domain.
pub mod models;
/// Interfaces that connect the authorization domain to its adapters.
pub mod ports;
/// Authorization service implementation.
pub mod service;
/// User API key credential authorization policy.
pub mod user_api_key_authorizer;
