//! Inbound calendar adapters.

/// Axum routes for authenticated calendar queries.
#[cfg(feature = "inbound")]
pub mod axum_router;

/// Queue worker driving calendar reminder dispatch.
#[cfg(feature = "dispatch")]
pub mod dispatch_worker;

/// Axum routes for authenticated calendar event mutations.
#[cfg(feature = "inbound")]
pub mod mutation_router;
/// Read-only team sharing and personal availability settings.
#[cfg(feature = "inbound")]
pub mod team_router;

/// AI toolset adapter exposing calendar CRUD to agents.
#[cfg(feature = "ai_tools")]
pub mod toolset;

/// AI adapter for coverage-aware team calendar availability.
#[cfg(feature = "ai_tools")]
pub mod team_toolset;
