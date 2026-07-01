//! Domain layer for webhooks.

/// Webhook domain models.
pub mod models;
#[cfg(feature = "ports")]
/// Webhook ports.
pub mod ports;
#[cfg(feature = "ports")]
/// Webhook service implementation.
pub mod service;
#[cfg(test)]
mod service_test;
