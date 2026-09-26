/// Parent-scoped message HTTP API.
pub mod axum_router;

/// Project discussion tools using the canonical message service.
#[cfg(feature = "toolset")]
pub mod toolset;
