//! Domain layer for search-event backfills.
//!
//! The application-level concern here is "drain every indexable record of an
//! entity type from its source of truth onto the search event queue so the
//! processing workers can re-index it." Each entity type has its own source
//! (a Postgres table in a different database), its own filter shape, and its
//! own mapping to [`sqs_client::search::SearchQueueMessage`] — but the public
//! surface (orchestration + HTTP routes) stays uniform.

pub mod models;
pub mod ports;
pub mod service;
