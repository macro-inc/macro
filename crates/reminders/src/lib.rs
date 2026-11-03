#![deny(missing_docs)]
//! Private email snoozes and channel-message reminders, with notification delivery.

pub mod domain;

#[cfg(any(feature = "inbound", feature = "dispatch"))]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
