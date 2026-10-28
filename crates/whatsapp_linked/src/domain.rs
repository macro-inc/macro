/// Session-service event and command types.
pub mod events;
/// WhatsApp JIDs.
pub mod jid;
/// Account, binding and send models shared with the web app.
pub mod models;
/// Polls, locations, contact cards, events and system lines.
pub mod rich;

/// Native notification outbox.
#[cfg(feature = "ports")]
pub mod effects;
/// Attachment import into static files.
#[cfg(feature = "ports")]
pub mod media;
/// Port traits.
#[cfg(feature = "ports")]
pub mod ports;
/// DSS use cases.
#[cfg(feature = "ports")]
pub mod service;
/// In-process API for the session service.
#[cfg(feature = "ports")]
pub mod session;
/// Pixel size and length of files sent from Macro.
#[cfg(feature = "ports")]
pub mod shape;

#[cfg(feature = "ports")]
pub mod timeline;
