#![deny(missing_docs)]
//! Owner-bound Codex OAuth connections, durable device login and encrypted credential rotation.

/// Connection policy and independently replaceable ports.
pub mod domain;
/// PostgreSQL storage and KMS envelope encryption.
pub mod outbound;
