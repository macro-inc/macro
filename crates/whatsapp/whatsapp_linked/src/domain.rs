/// Session-service event and command types.
pub mod events;
/// WhatsApp JIDs.
pub mod jid;
/// Account, pairing, roster and chat list models shared with the web app.
pub mod models;

/// Port traits.
#[cfg(feature = "ports")]
pub mod ports;
/// WhatsApp as an external chat provider.
#[cfg(feature = "ports")]
pub mod provider;
/// DSS use cases: the account, pairing and chat list.
#[cfg(feature = "ports")]
pub mod service;
/// In-process API for the session service.
#[cfg(feature = "ports")]
pub mod session;
