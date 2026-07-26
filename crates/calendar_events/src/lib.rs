#![deny(missing_docs)]
//! Calendar event domain and persistence adapter.
//!
//! A [`domain::models::CalendarEvent`] is the stable Macro entity. External
//! calendars and email invitations are sources of that entity, while
//! recurrence instances are stored as queryable occurrence projections.

/// Calendar business models, ports, and services.
pub mod domain;
/// Database adapters used by service composition roots.
#[cfg(feature = "postgres")]
pub mod outbound;
