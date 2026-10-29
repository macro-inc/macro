//! Calendar domain layer.
/// Email invitation identity lookup and action policy.
pub mod invitations;

/// The clicker's owned inboxes.
pub mod acting;
/// What a viewer may do with an event, following Google's guest permissions.
pub mod capabilities;
/// The per-email-link calendar change log.
pub mod changes;
/// Which copy of a meeting held by several of the user's inboxes a change
/// addresses.
pub mod copies;
/// Kafka event models for the calendar topic.
pub mod events;
/// iCalendar export of calendar events.
pub mod ics;
/// Asking to join a calendar event shared with a channel.
pub mod join_requests;
/// Macro meeting links carried by calendar events.
pub mod meeting_links;
/// Domain models.
pub mod models;
/// User-initiated calendar mutation policy.
pub mod mutations;
/// Markdown documents linked to a meeting occurrence.
#[cfg(feature = "notes")]
pub mod notes;
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
