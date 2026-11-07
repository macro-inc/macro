//! Inbound adapters.

pub mod axum_router;
pub mod models;

pub use axum_router::{AiUsageRouterState, ai_usage_router};
