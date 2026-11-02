//! The interface language each user picks for themselves.
//!
//! # Architecture
//!
//! - **domain**: the error type, the repository port, and the service
//! - **outbound**: the PostgreSQL repository (`postgres` feature)
//! - **inbound**: the Axum router (`inbound` feature)

#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
