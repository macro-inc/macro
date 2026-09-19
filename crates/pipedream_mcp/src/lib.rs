#![deny(missing_docs)]
//! Pipedream-managed MCP connectors: users connect apps through Pipedream
//! Connect (Pipedream owns grants, tokens, and refresh), and the AI loop
//! calls their tools through Pipedream's remote MCP server.
//!
//! This crate is fully separate from the native `mcp_client` stack — its own
//! endpoints (`/pipedream/mcp/*`), its own `pipedream_mcp_connections`
//! table, and its own toolset. Which stack serves a user's tools is decided
//! at load time by the `mcp_select` crate.

/// Domain layer: models, ports, and services.
pub mod domain;

/// Inbound adapters (HTTP/axum).
pub mod inbound;

/// Outbound adapters for the Pipedream API and Postgres.
pub mod outbound;
