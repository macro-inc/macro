#![deny(missing_docs)]
//! User API keys: create, list, and delete a caller's keys, following the
//! hexagonal architecture pattern.
//!
//! Keys are user-owned rows in `"UserApiKey"`. This crate owns that table's
//! lifecycle. Authenticating a request *with* a key lives in
//! `macro_authorization` (`x-macro-user-api-key`). The repository port still
//! exposes a lookup-by-key method for that use case.
//!
//! # Architecture
//!
//! - **domain**: domain models, ports, and the service implementation.
//! - **inbound**: driving adapters (Axum HTTP router).
//! - **outbound**: driven adapters (Postgres repository).

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
