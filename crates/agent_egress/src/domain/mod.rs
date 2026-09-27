//! The domain: what a session may reach, and with whose credentials.

/// Failures a proxied call can end in.
pub mod error;
/// Vocabulary: grants, slugs, targets, and the transport-neutral request and
/// response the service passes through.
pub mod model;
/// A response body that logs how long it lived and how it ended.
pub mod observed_body;
/// The capabilities the service needs from the outside.
pub mod ports;
/// Pacing a sandbox that reopens an event stream in a loop.
pub mod reopen_throttle;
/// The service itself.
pub mod service;
