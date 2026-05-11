//! Domain layer: models, ports (trait interfaces), and service implementation.

pub mod branch_name;
pub mod content;

#[cfg(feature = "markdown_init")]
pub mod markdown_init;

#[cfg(all(feature = "markdown_init", feature = "ports"))]
pub mod upload_finalize;

pub mod models;
pub mod response;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "ports")]
pub mod service;
