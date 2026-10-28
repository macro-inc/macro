//! Preview leases and authorization.
mod ids;
/// Capabilities supplied by the application composition root.
pub mod ports;
mod service;
pub use ids::PreviewId;
pub use service::*;

/// Shared metadata and fenced ownership ports.
pub mod storage;
