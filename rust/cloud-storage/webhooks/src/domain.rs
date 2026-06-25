//! Domain layer for webhooks: models, ports, and the service implementation.

/// The catalog of supported events and their allow-listed filter fields.
pub mod events;
/// Prefixed, time-sortable webhook identifiers.
pub mod ids;
/// Domain models, request/response DTOs, and error types.
pub mod model;
/// Port traits (repository, endpoint validator, secret encryptor).
#[cfg(feature = "ports")]
pub mod ports;
/// The typed webhook rule definition and its filter tree.
pub mod rule;
/// The webhook service: create / validate / patch.
#[cfg(feature = "ports")]
pub mod service;
