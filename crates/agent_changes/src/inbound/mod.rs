//! Inbound transport adapters for the changes service.

pub mod axum_router;

pub use axum_router::{AgentChangesRouterState, agent_changes_router};
