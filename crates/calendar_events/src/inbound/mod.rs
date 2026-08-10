//! Inbound calendar adapters.

/// Axum routes for authenticated calendar queries.
#[cfg(feature = "inbound")]
pub mod axum_router;

/// Axum routes for authenticated calendar event mutations.
#[cfg(feature = "inbound")]
pub mod mutation_router;
