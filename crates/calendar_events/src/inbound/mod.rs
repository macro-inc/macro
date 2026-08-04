//! Inbound calendar adapters.

/// Axum routes for authenticated calendar queries.
#[cfg(feature = "inbound")]
pub mod axum_router;

/// RFC 5545 iCalendar invitation parsing.
#[cfg(feature = "ics")]
pub mod ics;
