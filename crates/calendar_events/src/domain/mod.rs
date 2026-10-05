//! Calendar domain layer.
/// Email invitation identity lookup and action policy.
pub mod invitations;

/// The clicker's owned inboxes.
pub mod acting;
/// Kafka event models for the calendar topic.
pub mod events;
/// Macro meeting links carried by calendar events.
pub mod meeting_links;
/// Domain models.
pub mod models;
/// User-initiated calendar mutation policy.
pub mod mutations;
/// Domain ports.
pub mod ports;
/// Calendar reminder dispatch policy.
pub mod reminder_dispatch;
/// Calendar business policy.
pub mod service;
