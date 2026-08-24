//! Inbound HTTP and AI-tool adapters for bots.

#[cfg(feature = "inbound")]
/// Axum router for bot management.
pub mod axum_router;
#[cfg(feature = "inbound")]
/// Axum router for channel-scoped bot webhooks.
pub mod channel_webhook_router;
#[cfg(feature = "ai_tools")]
/// AI tools for managing bots.
pub mod toolset;
