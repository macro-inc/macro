#![deny(missing_docs)]
//! Webhook management hex crate.
//!
//! This crate currently contains the core application-layer webhook pieces for
//! the first iteration:
//!
//! - database tables for event ingestion, webhooks, deliveries, and delivery
//!   attempts;
//! - a typed `filters` model for matching webhook deliveries, shaped as an
//!   array of objects such as
//!   `[{"events": ["document.created"], "ids": ["doc_123"]}]`, where
//!   `ids` is optional and an absent `ids` field matches all entity ids;
//! - a repository that can create, get, patch, and update webhook validity via
//!   `is_valid`; it can also list active webhooks whose typed `filters` match
//!   an event with
//!   `domain::ports::WebhookRepo::list_active_webhooks_matching_event`;
//! - inbound handlers for `POST /webhooks`, `PATCH /webhooks/{webhook_id}`, and
//!   `POST /webhooks/{webhook_id}/validate`;
//! - validation that sends a signed `webhook.validation.test` event and persists
//!   the result in `is_valid`;
//! - validation attempt rate limiting with the existing `rate_limit` crate using
//!   the key shape `per-user-validate-webhook:{macro_user_id}:{webhook_id}` and
//!   a limit of 10 attempts per 3600-second window;
//! - a Kafka consumer (`inbound::kafka_consumer`, feature `consumer`) that
//!   subscribes to the `macro.documents` and `macro.channels` topics and hands
//!   every event to the `domain::ingestion::WebhookEventIngestionService`
//!   (feature `ingestion`), whose per-event handlers are still stubs.
//!
//! The current implementation intentionally excludes delivery workers, SQS/SNS
//! infrastructure, redelivery, and auto-pause behavior.
//!
//! Temporary limitations: IDs use prefixed UUIDv7 strings (`wh_<uuid_v7>`)
//! rather than true ULIDs. Custom headers are stored as JSON in `headers`.
//! Webhook signing secrets are intentionally stored as plaintext in
//! `signing_secret`, matching the existing bot secret storage approach.

/// Domain models, ports, and services.
pub mod domain;
#[cfg(any(feature = "inbound", feature = "consumer"))]
/// HTTP and Kafka consumer adapters.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Postgres and HTTP adapters.
pub mod outbound;
