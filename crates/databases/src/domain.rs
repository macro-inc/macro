//! Domain layer: models, ports, catalog/materialization/translation logic,
//! and the service implementation.

pub mod activity;
pub mod catalog;
pub mod events;
pub mod materialize;
pub mod models;
pub mod sugar;
pub mod translate;

#[cfg(feature = "entity_mutation")]
pub mod entity_mutation;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "ports")]
pub mod service;

#[cfg(test)]
pub mod test_support;

#[cfg(all(test, feature = "sqlite"))]
mod roundtrip_test;
