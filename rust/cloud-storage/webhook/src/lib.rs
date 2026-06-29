#![deny(missing_docs)]
//! Webhook management hex crate.
//!
//! This crate currently contains the core application-layer webhook pieces for
//! the first iteration:
//!
//! - database tables for event ingestion, webhooks, deliveries, and delivery
//!   attempts;
//! - a repository that can create, get, patch, and update webhook validity via
//!   `is_valid`;
//! - inbound handlers for `POST /webhooks`, `PATCH /webhooks/{webhook_id}`, and
//!   `POST /webhooks/{webhook_id}/validate`;
//! - validation that sends a signed `webhook.validation.test` event and persists
//!   the result in `is_valid`;
//! - validation attempt rate limiting with the existing `rate_limit` crate using
//!   the key shape `per-user-validate-webhook:{macro_user_id}:{webhook_id}` and
//!   a limit of 10 attempts per 3600-second window.
//!
//! The current implementation intentionally excludes delivery workers, SQS/SNS
//! infrastructure, event ingestion, redelivery, and auto-pause behavior.
//!
//! Temporary limitations: IDs use prefixed UUIDv7 strings (`wh_<uuid_v7>`)
//! rather than true ULIDs. Custom headers are stored as JSON in `headers`.
//! Webhook signing secrets are intentionally stored as plaintext in
//! `signing_secret`, matching the existing bot secret storage approach.

/// Domain models, ports, and service.
pub mod domain;
#[cfg(feature = "inbound")]
/// HTTP adapters.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Postgres and HTTP adapters.
pub mod outbound;
