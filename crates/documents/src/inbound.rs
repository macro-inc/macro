//! Inbound adapters for the documents domain.

#[cfg(feature = "axum")]
pub mod axum_router;

#[cfg(feature = "ai_tools")]
pub mod toolset;

#[cfg(feature = "attachment")]
pub mod attachment;
