/// Attachment adapter for resolving channel references into AI-consumable context.
#[cfg(feature = "attachment")]
pub mod attachment;
/// Axum handler and router for channel messages.
#[cfg(feature = "inbound")]
pub mod axum_router;
/// Axum handler and router for legacy channel list routes.
#[cfg(all(feature = "inbound", feature = "list"))]
pub mod list_router;
/// AI toolset for reading channel messages and threads.
#[cfg(feature = "ai_tools")]
pub mod toolset;
