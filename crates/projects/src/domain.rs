//! Domain models, ports, and project service definitions.

/// Event-to-activity mappings for this domain.
pub mod activity;
/// Unified entity-mutation capability impls.
#[cfg(feature = "service")]
pub mod entity_mutation;
pub mod events;
pub mod models;
pub mod response;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "service")]
pub mod service;

#[cfg(feature = "service")]
pub mod upload;
