//! The adapters behind `contacts_core`'s ports: the Postgres repository,
//! the SQS ingress queue and the connection gateway notifier.

#![deny(missing_docs)]

/// Connection gateway notifier adapter.
pub mod gateway;
/// SQS-backed contacts ingress queue adapter.
pub mod ingress;
/// Existing viewer-aware user-name resolution behind the directory's name port.
#[cfg(feature = "directory-names")]
pub mod names;
/// Database-backed contacts repository.
pub mod repository;
