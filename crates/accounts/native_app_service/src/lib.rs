#![deny(missing_docs)]
//! This crate provides the serverside handlers required to dynamically update the tauri application
//! Consumers of this crate should integrate the router
//! by calling [axum::Router::with_state]

/// contains domain level business logic
pub mod domain;
/// the outbound implementations of ports
pub mod inbound;
/// adapter for incoming data into the service
pub mod outbound;

#[cfg(test)]
mod tests;
