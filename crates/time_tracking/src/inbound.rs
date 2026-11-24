//! Driving adapters: the HTTP routers and the AI tools.

pub mod axum_router;
pub mod report_router;

#[cfg(feature = "toolset")]
pub mod toolset;
