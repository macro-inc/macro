//! Inbound adapters for entity access.
//!
//! These modules contain adapters for incoming requests, such as Axum extractors.

#[cfg(feature = "axum")]
pub mod axum_extractors;
