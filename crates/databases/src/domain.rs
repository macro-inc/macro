//! Domain layer: models, ports, the viewer's catalog, and the service
//! implementation.

pub mod activity;
pub mod catalog;
pub mod events;
pub mod journal;
pub mod models;

#[cfg(feature = "entity_mutation")]
pub mod entity_mutation;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "ports")]
pub mod receipt;

#[cfg(feature = "ports")]
pub mod service;

#[cfg(feature = "ports")]
pub mod sharing;

#[cfg(feature = "ports")]
pub mod transfer;

/// Retry-safe first database provisioning.
#[cfg(feature = "ports")]
pub mod starter;
