//! Inbound adapters for the projects domain.
//!
//! Axum routing is introduced as project routes migrate into this crate.

/// Axum project route adapter.
#[cfg(feature = "axum")]
pub mod axum_router;

/// AI toolset adapter.
#[cfg(feature = "ai_tools")]
pub mod toolset;
