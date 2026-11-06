//! Inbound adapters for the chat domain.

mod error_response;

#[cfg(feature = "attachment")]
pub mod attachment;

#[cfg(test)]
mod test;

pub mod http;

/// AI toolset exposing chat history to agents.
#[cfg(feature = "ai_tools")]
pub mod toolset;
