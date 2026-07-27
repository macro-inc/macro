/// Domain models for calls.
pub mod models;

/// Unified entity-mutation capability impls.
#[cfg(feature = "ports")]
pub mod entity_mutation;

/// Port traits for calls.
#[cfg(feature = "ports")]
pub mod ports;

/// Service orchestration for calls.
#[cfg(feature = "ports")]
pub mod service;
