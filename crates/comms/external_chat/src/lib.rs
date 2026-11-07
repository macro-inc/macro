#![deny(missing_docs)]
//! External chats: chats that live at another service (WhatsApp is the one
//! provider), added to Macro as independently shared entities. This crate is
//! the provider-neutral part: timeline and read state, sharing, deliberate
//! sends and uploads, notification effects and the `/external-chats` routes.
//! A provider implements [`domain::ports::ChatProvider`].

/// Models, ports and use cases.
pub mod domain;
/// DSS HTTP routes.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Postgres adapters.
#[cfg(feature = "outbound")]
pub mod outbound;
/// `NOTIFY` channels and payloads DSS listens on.
pub mod signals;
