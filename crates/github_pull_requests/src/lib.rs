//! GitHub pull requests stored as foreign entity records.
//!
//! Owns the pull request model, the rules for merging refreshed pull request data into what is
//! already stored, and the service that writes pull request records.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports, and service implementation.

#![deny(missing_docs)]

pub mod domain;
