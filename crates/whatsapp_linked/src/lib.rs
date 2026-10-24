#![deny(missing_docs)]
//! Personal WhatsApp accounts linked as devices: pairing, group adoption into
//! group entitys, inbound ingestion and deliberate sends. DSS serves the HTTP
//! API; the WhatsApp session service calls [`domain::session::SessionService`]
//! in-process. The two coordinate only through Postgres rows and `NOTIFY`.

/// Models, ports and use cases.
pub mod domain;
/// DSS HTTP routes.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Postgres adapters.
#[cfg(feature = "outbound")]
pub mod outbound;
