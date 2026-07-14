//! `mcp_auth_proxy` is the MCP-facing OAuth broker used by the `mcp_service` binary.
//!
//! It sits between an MCP client and the upstream OAuth provider so the MCP
//! server can expose the metadata and loopback-public-client behavior Claude
//! expects while still returning upstream FusionAuth bearer tokens.
//!
//! High-level flow:
//! 1. expose protected-resource and authorization-server discovery metadata
//! 2. accept dynamic registration for public loopback clients
//! 3. redirect the user to the upstream provider from `/authorize`
//! 4. exchange the upstream callback code at `/oauth/callback`
//! 5. issue a short-lived broker code for the MCP client loopback callback
//! 6. exchange that code at `/token` after redirect URI and PKCE validation
//! 7. support refresh-token exchanges against the upstream provider
//!
//! Module layout:
//! - `domain`: auth proxy state, models, ports, and service logic
//! - `inbound`: axum router and HTTP middleware
//! - `outbound`: adapters for upstream OAuth providers

#![deny(missing_docs)]

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
