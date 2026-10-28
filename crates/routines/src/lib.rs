//! Routine tools and a client for the owning scheduled-action service.
#![deny(missing_docs)]
/// Validated routine commands and service capabilities.
pub mod domain;
/// AI tools available to MCP and embedded agents.
pub mod inbound;
/// HTTP implementation of the routine capability.
pub mod outbound;
