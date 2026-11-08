//! The channels HTTP routes (feature `axum`), AI toolset (`agent_tools`),
//! attachment adapter (`attachment`) and teammate-DM Kafka consumer
//! (`kafka_consumer`), all driving the `channels` domain.

#![deny(missing_docs)]

/// Attachment adapter for resolving channel references into AI-consumable context.
#[cfg(feature = "attachment")]
pub mod attachment;
/// Axum handler and router for channel messages.
#[cfg(feature = "axum")]
pub mod axum_router;
/// Axum handler and router for legacy channel list routes.
#[cfg(all(feature = "axum", feature = "list"))]
pub mod list_router;
/// Kafka consumer that ensures teammate DMs after `team.member_joined`.
#[cfg(feature = "kafka_consumer")]
pub mod teammate_dms_consumer;
/// AI toolset for reading channel messages and threads.
#[cfg(feature = "ai_tools")]
pub mod toolset;
