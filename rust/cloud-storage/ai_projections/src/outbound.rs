//! Outbound adapters for the ai projections domain.

#[cfg(feature = "agent")]
pub mod agent_generator;
pub mod ai_projection_repo;
pub mod sqs_queue;
