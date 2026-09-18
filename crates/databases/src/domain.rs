//! Domain layer: models, ports, catalog/materialization/translation logic,
//! and the service implementation.

pub mod catalog;
pub mod materialize;
pub mod models;
pub mod sugar;
pub mod translate;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "ports")]
pub mod service;
