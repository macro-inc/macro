/// Axum handler and router for channel messages.
#[cfg(feature = "inbound")]
pub mod axum_router;
/// AI toolset for reading channel messages and threads.
#[cfg(feature = "ai_tools")]
pub mod toolset;
