#![deny(missing_docs)]
//! AI projections hexagonal architecture crate.
//!
//! An AI projection is a materialized, cached AI-generated view of a user's
//! underlying data, keyed by a frontend-defined text id (e.g.
//! `notification_important_widget`). The high-level definition lives in the
//! `ai_projection` table, while each user's cached instance lives in the
//! `user_ai_projection` table.
//!
//! # Lifecycle
//!
//! `POST /ai-projections` is both create and read: it upserts the definition
//! and the caller's instance, returning the cached state. A cold instance (or
//! a `regenerate: true` request) triggers materialization — asynchronously via
//! `ai_projection_queue` by default, or inline when the request sets
//! `await: true`. Completed (or failed) materializations are pushed to the
//! target's connected clients through the connection gateway as
//! `ai_projection_updated` messages, so the frontend never polls.
//!
//! The definition's `prompt_hash` versions the whole generation recipe
//! (prompt, optional `model` override, optional `output_schema`): re-upserting
//! with any of those changed revises the definition and resets instances to
//! cold on their next request. Worker writes are scoped to the message's hash
//! so results for outdated versions are discarded. A scheduled refresh lambda
//! (`ai_projections_refresh_handler`) deletes inactive instances and
//! re-enqueues stale ones per cadence.
//!
//! When `output_schema` is set, generation is two-phase: the tool-enabled
//! agent loop gathers context, then a prompted (non-strict) structured
//! completion distills it into schema-conforming JSON — this works across all
//! routed providers (Anthropic, OpenAI, Cerebras, ...).
//!
//! # Architecture
//!
//! - **domain**: Domain models, ports (traits), and the service implementation
//! - **outbound**: Adapters for external dependencies (PostgreSQL, SQS, the
//!   agent loop, the connection gateway)
//! - **inbound**: Adapters for incoming requests (Axum handlers)

/// The domain module contains the domain logic for ai projections
pub mod domain;

/// The inbound module contains the inbound adapters for ai projections
#[cfg(feature = "inbound")]
pub mod inbound;

/// The outbound module contains the outbound adapters for ai projections
#[cfg(feature = "outbound")]
pub mod outbound;

/// The worker module contains the inbound SQS poller for ai projections
#[cfg(feature = "worker")]
pub mod worker;
