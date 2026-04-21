#![deny(missing_docs)]
//! Tauri plugin for OTA bundle updates.

/// contains domain level business logic
pub mod domain;
/// adapter for incoming data into the service
pub mod inbound;
/// the outbound implementations of ports
pub mod outbound;
