#[cfg(feature = "axum")]
/// Axum router and request/response types for soup endpoints.
pub mod axum_router;
#[cfg(feature = "ai_tools")]
/// AI tool definitions backed by soup queries.
pub mod toolset;
