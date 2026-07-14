//! Domain layer: models, ports, and service implementation.

pub mod models;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "service")]
pub mod service;
