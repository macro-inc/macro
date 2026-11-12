//! Axum adapter for team-admin enterprise actions.

/// Team-admin HTTP handlers and their OpenAPI operations.
pub mod axum_router;

pub use axum_router::{EnterpriseRouterState, enterprise_router};
