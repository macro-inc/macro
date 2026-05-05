//! Domain layer: models, ports (trait interfaces), and service implementation.

pub mod branch_name;
pub mod models;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "ports")]
pub mod service;
