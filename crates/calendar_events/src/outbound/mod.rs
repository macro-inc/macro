//! Outbound calendar adapters.

/// Google Calendar API adapter.
#[cfg(feature = "google")]
pub mod google;
/// PostgreSQL calendar repository.
#[cfg(feature = "postgres")]
pub mod pg;
