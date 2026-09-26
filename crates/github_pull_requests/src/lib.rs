//! GitHub pull requests stored as foreign entity records.
//!
//! Owns the pull request model, the rules for merging refreshed pull request data into what is
//! already stored, the typed `github_pull_request` columns read from that data, and the service
//! that writes pull request records and lists the ones a caller can see.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports, and service implementation.
//! - **outbound**: Contains adapters for external persistence systems.

#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "outbound")]
pub mod outbound;
