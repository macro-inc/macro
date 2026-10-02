//! Inbound adapters: the axum router.

pub mod admission;
pub mod axum_router;

pub use axum_router::{AiBillingRouterState, ai_billing_router};
