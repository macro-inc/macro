//! Inbound adapters for the projects domain.
//!
//! Axum routing is introduced as project routes migrate into this crate.

/// Axum project route adapter.
#[cfg(feature = "axum")]
pub mod axum_router;
