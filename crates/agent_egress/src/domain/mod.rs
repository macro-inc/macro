//! The domain: what a session may reach, and with whose credentials.

/// Failures a proxied call can end in.
pub mod error;
/// Vocabulary: grants, slugs, targets, and the transport-neutral request and
/// response the service passes through.
pub mod model;
/// The capabilities the service needs from the outside.
pub mod ports;
/// The service itself.
pub mod service;
