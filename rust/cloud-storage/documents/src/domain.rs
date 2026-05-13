//! Domain layer: models, ports (trait interfaces), and service implementation.

pub mod branch_name;
pub mod content;

#[cfg(feature = "document_create")]
pub mod create;

#[cfg(feature = "ports")]
pub mod upload_finalize;

pub mod models;
pub mod response;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "service")]
pub mod service;
