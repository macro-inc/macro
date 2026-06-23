#![deny(missing_docs)]
//! Paginated channel messages with thread previews, reactions, and attachments.

/// Domain layer: models, ports, and service.
pub mod domain;
/// Inbound layer: axum handler, AI tools, and attachment adapters.
#[cfg(any(feature = "inbound", feature = "ai_tools", feature = "attachment"))]
pub mod inbound;
/// Outbound layer: postgres repository.
#[cfg(feature = "outbound")]
pub mod outbound;
