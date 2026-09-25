//! Inbound adapters: the axum router and shared admission error responses.

pub mod admission;
pub mod axum_router;

pub use admission::{AiAdmissionErrorBody, admission_error_response};
pub use axum_router::{AiBillingRouterState, ai_billing_router};
