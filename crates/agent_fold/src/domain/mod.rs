//! Domain layer: the message vocabulary, the fold that derives it, and the
//! ports through which it is queried and fed.

/// Frames the fold could not account for.
mod error;
/// Collapsing a protocol log into messages.
pub mod fold;
/// Harness-specific `_meta` extraction.
pub mod meta;
/// The renderable message vocabulary.
pub mod model;
/// The driving query port and the driven log-source port.
pub mod ports;
/// The domain service answering queries by folding on read.
pub mod service;

#[cfg(test)]
mod test;
