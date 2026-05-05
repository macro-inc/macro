//! Inbound adapters for the chat domain.

#[cfg(feature = "attachment")]
pub mod attachment;

#[cfg(test)]
mod test;

mod http;

/// AI toolset exposing chat history to agents.
#[cfg(feature = "ai_tools")]
pub mod toolset;

// Re-exports for backwards compatibility.
pub use self::http::extractors::ChatModelAccess;
pub use self::http::router::*;
