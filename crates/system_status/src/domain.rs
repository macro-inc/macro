//! Domain layer: models, ports (trait interfaces), and service implementation.

pub mod models;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "ports")]
pub mod service;

#[cfg(all(test, feature = "ports"))]
pub(crate) mod fakes;
