#![recursion_limit = "256"]
//! Calendar sync service.
//!
//! Hosts the Google Calendar push webhook, user-initiated calendar mutations,
//! the sync scheduler + outbox drain, and the backfill queue consumer, so the
//! calendar sync deploy/ingress lifecycle is independent of email_service.

/// HTTP surface: the push webhook and calendar mutation routes.
pub mod api;
/// Calendar's own backfill queue: message type and SQS enqueue client.
pub mod backfill_queue;
/// Calendar backfill queue consumer.
pub mod calendar_backfill;
/// Process-level adapters backing the calendar application services.
pub mod calendar_backfill_adapters;
/// Sync scheduler and durable backfill publication.
pub mod calendar_outbox;
/// Redis-backed Google Calendar API quota gate.
pub mod calendar_ratelimit;
/// Connection-gateway calendar refresh notifier.
pub mod calendar_refresh;
/// Access-token adapter for user-initiated calendar mutations.
pub mod calendar_tokens;
/// Service configuration.
pub mod config;
/// Health check router.
pub mod health;
/// Shared calendar pubsub helpers.
pub mod pubsub_util;
