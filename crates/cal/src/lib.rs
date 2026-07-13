//! Cal.com integration library.
//!
//! Receives cal.com webhook events (booking created, etc.) and fires
//! analytics events in response. Follows the hexagonal architecture
//! pattern used elsewhere in the workspace:
//!
//! - [`domain`]: core models, ports, and the webhook service
//! - [`inbound`]: HTTP router that validates and dispatches cal.com webhooks
//! - [`outbound`]: adapters that ship domain events to analytics backends

#![deny(missing_docs)]

/// Domain layer: models, ports, and the webhook service.
pub mod domain;
/// Inbound adapters (HTTP router for cal.com webhooks).
#[cfg(feature = "axum")]
pub mod inbound;
/// Outbound adapters (analytics sinks).
#[cfg(feature = "outbound")]
pub mod outbound;
