#![deny(missing_docs)]
//! Skills hexagonal architecture crate.
//!
//! Skills are markdown documents (document sub type `skill`) containing
//! instructions that AI reads and follows when the skill is referenced in an
//! AI input. This crate defines the skill search toolset and other skill
//! functionality.
//!
//! # Architecture
//!
//! - **domain**: domain models, ports (traits), service implementation
//! - **inbound**: adapters for incoming requests (AI toolset)
//! - **outbound**: adapters for external dependencies (search service)

pub mod domain;

#[cfg(feature = "ai_tools")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
