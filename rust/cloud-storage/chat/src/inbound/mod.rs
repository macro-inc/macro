//! Inbound adapters for the chat domain.

#[cfg(feature = "attachment")]
pub mod attachment;

#[cfg(test)]
mod test;

mod http;

// Re-exports for backwards compatibility.
pub use self::http::extractors::ChatModelAccess;
pub use self::http::router::*;
