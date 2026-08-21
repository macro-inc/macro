//! The domain: vocabulary, translation, ports, and the session service.

/// Errors the domain can produce.
pub mod error;

/// The Cursor cloud event vocabulary the translation consumes.
pub mod event;

/// Identifiers and small value types.
pub mod model;

/// The capabilities the domain requires from the outside.
pub mod ports;

/// The session service: prompts in, translated updates out.
pub mod service;

/// The pure Cursor→ACP translation machine.
pub mod translate;
