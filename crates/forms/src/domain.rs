//! Domain layer: models, ports, events, activity and the service.

pub mod activity;
pub mod events;
pub mod models;

#[cfg(feature = "entity_mutation")]
pub mod entity_mutation;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "ports")]
pub mod service;

#[cfg(feature = "ports")]
pub mod sharing;
