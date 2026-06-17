#![deny(missing_docs)]
//! AI projections hexagonal architecture crate.
//!
//! AI projections are cached, AI-generated views of underlying data for a
//! frontend-defined target, prompt, context, schema, and toolset version.
//!
//! # Architecture
//!
//! - **domain**: Contains models, ports, and pure materialization behavior
//! - **inbound**: Contains adapters for incoming requests
//! - **outbound**: Contains adapters for persistence, generation, and workers

/// Domain layer: models, ports, and service behavior.
pub mod domain;

/// Inbound layer: HTTP and other request adapters.
#[cfg(feature = "inbound")]
pub mod inbound;

/// Outbound layer: persistence, AI generator, and worker adapters.
#[cfg(feature = "outbound")]
pub mod outbound;
