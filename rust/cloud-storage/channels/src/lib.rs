#![deny(missing_docs)]
//! Paginated channel messages with thread previews, reactions, and attachments.

/// Domain layer: models, ports, and service.
pub mod domain;
/// Inbound layer: axum handler and router.
#[cfg(any(feature = "inbound", feature = "ai_tools"))]
pub mod inbound;
/// Outbound layer: postgres repository.
#[cfg(feature = "outbound")]
pub mod outbound;
