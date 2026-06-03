//! Inbound adapters for the CRM domain.

#[cfg(feature = "axum")]
pub mod axum_extractors;
#[cfg(feature = "axum")]
pub mod axum_router;
