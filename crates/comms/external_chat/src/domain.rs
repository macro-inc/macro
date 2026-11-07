/// Added chats, messages, sends and attachments shared with the web app.
pub mod models;
/// Polls, locations, contact cards, events and system lines.
pub mod rich;

/// Native notification outbox.
#[cfg(feature = "ports")]
pub mod effects;
/// Attachment import into static files.
#[cfg(feature = "ports")]
pub mod media;
/// Port traits, including the provider port.
#[cfg(feature = "ports")]
pub mod ports;
/// DSS use cases.
#[cfg(feature = "ports")]
pub mod service;
/// Pixel size and length of files sent from Macro.
#[cfg(feature = "ports")]
pub mod shape;
/// Timeline, read state and sharing contracts.
#[cfg(feature = "ports")]
pub mod timeline;
