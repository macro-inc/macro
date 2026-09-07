/// Existing PDF annotation use cases and authorization.
#[cfg(feature = "annotations")]
pub mod annotations;
/// Common application boundary used by HTTP, agents, and channel adapters.
#[cfg(feature = "ports")]
pub mod api;
/// Contextual notifications and permission-aware realtime delivery.
#[cfg(feature = "ports")]
pub mod delivery;
/// Independent delivery of committed facts.
#[cfg(feature = "ports")]
pub mod effects;
/// Transport-independent committed message facts.
pub mod events;
/// Parent-independent mention identities.
pub mod mentions;
/// Shared message and thread models.
pub mod models;
/// Notification audience and semantic policy.
pub mod notification;
/// Repository and delivery boundaries.
#[cfg(feature = "ports")]
pub mod ports;
/// Message authorization and use-case orchestration.
#[cfg(feature = "ports")]
pub mod service;
