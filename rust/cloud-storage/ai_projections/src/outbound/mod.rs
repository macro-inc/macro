//! Outbound adapters for AI projections.

/// Agent-loop backed generator for projection materialization.
pub mod agent_generator;
/// Postgres-backed repository for projection cache lifecycle and scheduling.
pub mod pg_projection_repo;
/// Tokio polling worker for background projection generation.
pub mod polling_worker;
