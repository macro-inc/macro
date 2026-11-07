//! Domain layer: models, ports, and the collab-surface service.

pub mod models;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod service;
#[cfg(feature = "ports")]
pub mod token;
