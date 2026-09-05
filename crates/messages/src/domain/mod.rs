/// Existing PDF annotation use cases and authorization.
#[cfg(feature = "annotations")]
pub mod annotations;
/// Contextual notifications and permission-aware realtime delivery.
#[cfg(feature = "ports")]
pub mod delivery;
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
