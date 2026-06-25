//! Inbound adapters for webhook configuration.

/// Axum HTTP handlers and router for the webhook configuration API.
#[cfg(feature = "axum")]
pub mod axum_router;
