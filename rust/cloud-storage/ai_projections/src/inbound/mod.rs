//! Inbound adapters for AI projections.

/// Axum HTTP router for AI projection materialization.
pub mod axum_router;
/// SQS worker for projection generation messages.
#[cfg(feature = "sqs")]
pub mod sqs_worker;
