#![deny(missing_docs)]
//! Skills hexagonal architecture crate.
//!
//! Skills are markdown documents (document sub type `skill`) containing
//! instructions that AI reads and follows when the skill is referenced in an
//! AI input. This crate defines the skill discovery and reading toolset and other skill
//! functionality.
//!
//! # Architecture
//!
//! - **domain**: domain models, ports (traits), service implementation
//! - **inbound**: adapters for incoming requests (AI toolset, HTTP)
//! - **outbound**: adapters for external dependencies (search service)

pub mod domain;

#[cfg(any(feature = "ai_tools", feature = "axum"))]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
