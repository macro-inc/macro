//! Domain layer: models, ports (trait interfaces), and service implementation.

pub mod models;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(any(feature = "sync", feature = "link"))]
pub mod service;
