//! The Properties HTTP API (feature `axum`) and AI toolset (feature
//! `agent_tools`), both driving the `properties` domain service.
//!
//! Split out of `properties` so that the domain's dependents do not rebuild
//! when a route or tool changes.

#[cfg(feature = "axum")]
pub mod axum_router;
#[cfg(feature = "ai_tools")]
pub mod toolset;
