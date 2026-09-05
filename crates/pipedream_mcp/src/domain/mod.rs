/// Domain models for Pipedream connections and the app catalog.
pub mod models;
pub use mcp_toolset::CallToolResultExt;
/// Port traits consumed by the domain services.
pub mod ports;
/// Domain services: connect completion, catalog browsing, and the toolset.
pub mod service;
