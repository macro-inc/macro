//! Domain layer: the activity model and the storage port.

pub mod materializer;
pub mod models;
pub mod overview;
pub mod ports;
#[cfg(feature = "ai_tools")]
pub mod service;
pub mod timeline;
