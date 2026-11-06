#![deny(missing_docs)]
//! Call management with hexagonal architecture.
//!
//! Manages video/audio calls in channels using a ports-and-adapters pattern
//! with LiveKit as the RTC backend.

/// Domain layer: models, ports, and service.
pub mod domain;
/// Inbound layer: axum handler, router, and AI toolset.
#[cfg(any(feature = "inbound", feature = "ai_tools"))]
pub mod inbound;
/// Outbound layer: LiveKit RTC client adapter.
#[cfg(feature = "outbound")]
pub mod outbound;
