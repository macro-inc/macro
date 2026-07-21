//! Domain layer for webhooks.

#[cfg(feature = "ports")]
/// Webhook event delivery state machine and retry policy.
pub mod delivery;
/// Webhook lifecycle event contracts.
pub mod events;
#[cfg(feature = "ingestion")]
/// Webhook event ingestion service.
pub mod ingestion;
/// Webhook domain models.
pub mod models;
#[cfg(test)]
mod models_test;
#[cfg(feature = "ports")]
/// Webhook ports.
pub mod ports;
#[cfg(feature = "ports")]
/// Webhook service implementation.
pub mod service;
#[cfg(test)]
mod service_test;
