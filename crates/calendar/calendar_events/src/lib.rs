#![deny(missing_docs)]
//! Calendar event domain, parsing, and provider persistence adapters.
//!
//! A [`domain::models::CalendarEvent`] is the stable Macro entity. External
//! calendars and email invitations are sources of that entity, while
//! recurrence instances are stored as queryable occurrence projections.

/// Calendar business models, ports, and services.
pub mod domain;
/// Inbound adapters that expose calendar use cases and accepted formats.
#[cfg(any(feature = "inbound", feature = "dispatch", feature = "ai_tools"))]
pub mod inbound;
/// Database and provider adapters used by service composition roots.
#[cfg(any(
    feature = "google",
    feature = "postgres",
    feature = "dispatch-sqs",
    feature = "notify",
    feature = "mutation-client"
))]
pub mod outbound;
