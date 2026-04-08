//! Domain layer for entity access management.
//!
//! Contains models, ports (traits), and the service implementation.

pub mod models;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "ports")]
pub mod service;
