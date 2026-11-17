//! Outbound adapters for bots.

#[cfg(feature = "realtime")]
/// This process's own read of the bot topic, for live bot updates.
pub mod bot_topic_changes;
#[cfg(feature = "realtime")]
/// Connection-gateway publisher for changed bot profiles.
pub mod connection_gateway_profiles;
/// Postgres bot repository.
pub mod pg_bots_repo;
