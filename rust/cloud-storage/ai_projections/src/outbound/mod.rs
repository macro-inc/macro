//! Outbound adapters for AI projections.

/// Agent-loop backed generator for projection materialization.
pub mod agent_generator;
/// Postgres-backed repository for projection cache lifecycle and scheduling.
pub mod pg_projection_repo;
/// Tokio polling scheduler for enqueueing due projection refreshes.
pub mod polling_worker;
/// SQS-backed queue for projection generation messages.
#[cfg(feature = "sqs")]
pub mod sqs_projection_queue;
