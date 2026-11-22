#![recursion_limit = "256"]
//! Email service. The service binary, the OpenAPI generator, and the backfill
//! and worker binaries all link this library, so the service compiles once and
//! caches as one rlib.

mod api;
/// Durable publication of email backfill outbox rows.
pub mod backfill_outbox;
/// Google Calendar quota gate for disconnecting an inbox's calendar.
pub mod calendar_request_gate;
/// Access-token adapter for disconnecting an inbox's calendar.
pub mod calendar_tokens;
pub mod composition;
pub mod config;
/// Periodic enrichment of pending CRM company directory entries.
pub mod crm_enrichment_worker;
pub mod email_policy_worker;
/// Resumable rollout maintenance, isolated from ordinary mailbox connections.
pub mod mailbox_provider_repair_worker;
/// Durable provider-neutral mailbox worker scheduling.
pub mod mailbox_sync_worker;
/// Outbound infrastructure adapters for email provider capabilities.
pub mod outbound;
pub mod outlook_flags;
pub mod pubsub;
mod server;
pub mod util;
mod utils;

/// The service's OpenAPI document, rendered by the `*_openapi` binary.
pub use api::swagger::ApiDoc;
pub use server::run;

/// Provider-specific IMAP rollout scheduling.
pub mod imap_runtime;
