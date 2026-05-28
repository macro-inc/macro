/// Axum handler and router for channel messages.
#[cfg(feature = "inbound")]
pub mod axum_router;
/// Document permissions token validation utilities.
#[cfg(feature = "inbound")]
pub mod permissions_token;
/// AI toolset for reading channel messages and threads.
#[cfg(feature = "ai_tools")]
pub mod toolset;
