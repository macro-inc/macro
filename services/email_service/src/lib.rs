/// Durable email-backfill completion orchestration.
pub mod backfill_completion_service;
/// Fenced email-backfill initialization orchestration.
pub mod backfill_init_service;
/// Durable publication of grant-triggered calendar work.
pub mod calendar_outbox;
/// Access-token adapter for user-initiated calendar mutations.
pub mod calendar_tokens;
pub mod config;
/// Outbound infrastructure adapters for email provider capabilities.
pub mod outbound;
pub mod pubsub;
pub mod util;
