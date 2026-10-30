#![deny(missing_docs)]
//! Personal WhatsApp accounts linked as devices, the one `external_chat`
//! provider: pairing, the account's chat list, adding chats, inbound
//! ingestion and dispatching deliberate sends. DSS serves the `/whatsapp` API
//! and composes [`domain::provider::WhatsAppProvider`] into the external chat
//! service; the WhatsApp session service calls
//! [`domain::session::SessionService`] in-process. The two coordinate only
//! through Postgres rows and `NOTIFY`.

/// Models, ports and use cases.
pub mod domain;
/// DSS HTTP routes.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Postgres adapters.
#[cfg(feature = "outbound")]
pub mod outbound;
/// `NOTIFY` channels between DSS and the session service.
pub mod signals;
