//! Domain layer for favorites.

pub mod models;
#[cfg(feature = "ports")]
pub mod mutation_service;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod service;
