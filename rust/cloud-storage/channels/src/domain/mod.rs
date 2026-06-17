/// Domain events emitted by channel workflows.
pub mod events;
/// Legacy channel list service implementation.
#[cfg(feature = "list")]
pub mod list_service;
/// Domain models for channel messages.
pub mod models;
#[cfg(feature = "ports")]
/// Port traits for channel messages.
pub mod ports;
#[cfg(feature = "ports")]
/// Service orchestration for channel messages.
pub mod service;
#[cfg(feature = "ports")]
/// Domain orchestration for channel side effects.
pub mod side_effects;
