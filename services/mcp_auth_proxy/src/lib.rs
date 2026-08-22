//! `mcp_auth_proxy` is the MCP-facing OAuth broker used by the `mcp_service` binary.
//!
//! It sits between an MCP client and the product login so the MCP server can
//! expose the metadata and loopback-public-client behavior Claude expects while
//! still returning the same FusionAuth bearer tokens the rest of Macro uses.
//!
//! High-level flow:
//! 1. expose protected-resource and authorization-server discovery metadata
//! 2. accept dynamic registration for public loopback clients
//! 3. start a broker session at `/authorize` and send the browser to product `/login`
//! 4. let the product frontend choose Google or email OTP
//! 5. accept the resulting product tokens at `/login/{session_id}/complete`
//! 6. issue a short-lived broker code for the MCP client loopback callback
//! 7. exchange that code at `/token` after redirect URI and PKCE validation
//! 8. support refresh-token exchanges against FusionAuth
//!
//! Module layout:
//! - `domain`: auth proxy state, models, ports, and service logic
//! - `inbound`: axum router and HTTP middleware
//! - `outbound`: adapters for FusionAuth and Redis

#![deny(missing_docs)]

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
