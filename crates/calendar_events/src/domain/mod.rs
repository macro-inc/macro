//! Calendar domain layer.
/// Email invitation identity lookup and action policy.
pub mod invitations;

/// The clicker's owned inboxes.
pub mod acting;
/// The per-email-link calendar change log.
pub mod changes;
/// Kafka event models for the calendar topic.
pub mod events;
/// Domain models.
pub mod models;
/// User-initiated calendar mutation policy.
pub mod mutations;
/// Domain ports.
pub mod ports;
/// Calendar reminder dispatch policy.
pub mod reminder_dispatch;
/// Confirmed, durable organizer event replacement.
pub mod replacement;
/// Calendar business policy.
pub mod service;

/// Composition of provider-specific calendar capabilities.
pub mod providers;

/// Microsoft calendar synchronization policy and ports.
#[cfg(feature = "outlook")]
pub mod outlook;
/// Source-aware, read-only team calendar sharing.
pub mod team;
/// Coverage-aware personal availability from authorized team sources.
pub mod team_availability;
