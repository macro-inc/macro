/// Durable email-backfill completion orchestration.
pub mod backfill_completion_service;
/// Fenced email-backfill initialization orchestration.
pub mod backfill_init_service;
/// Durable publication of email backfill outbox rows.
pub mod backfill_outbox;
/// Connection-gateway refresh adapter for disconnecting an inbox's calendar.
pub mod calendar_refresh;
/// Google Calendar quota gate for disconnecting an inbox's calendar.
pub mod calendar_request_gate;
/// Access-token adapter for disconnecting an inbox's calendar.
pub mod calendar_tokens;
pub mod config;
/// Outbound infrastructure adapters for email provider capabilities.
pub mod outbound;
pub mod pubsub;
pub mod util;
