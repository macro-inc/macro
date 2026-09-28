#![deny(missing_docs)]
//! Leased, entity-authorized live previews over stock OpenSSH reverse forwarding.

/// Preview policies and capabilities, independent of HTTP and SSH.
pub mod domain;
/// HTTP, MCP and SSH entry points.
pub mod inbound;
/// Transport implementations for domain capabilities.
pub mod outbound;

#[cfg(test)]
mod testing;
