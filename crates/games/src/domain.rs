//! Domain layer: models, ports, and the games service.

pub mod models;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod service;
