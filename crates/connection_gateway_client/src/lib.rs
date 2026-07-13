#![deny(missing_docs)]
//! HTTP client for the connection gateway service.

pub mod client;

pub use client::ConnectionGatewayClient;
pub use connection_gateway_models as models;
