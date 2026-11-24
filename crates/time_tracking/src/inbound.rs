//! Driving adapters: the HTTP router and the AI tools.

pub mod axum_router;

#[cfg(feature = "toolset")]
pub mod toolset;
