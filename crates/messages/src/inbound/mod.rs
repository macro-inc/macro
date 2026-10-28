/// Parent-scoped message HTTP API.
#[cfg(feature = "inbound")]
pub mod axum_router;
/// RTC-authenticated guest access to a call's discussion.
#[cfg(feature = "inbound")]
pub mod guest_chat;
/// AI tools for reading and writing any entity's Discussion.
#[cfg(feature = "ai_tools")]
pub mod toolset;
