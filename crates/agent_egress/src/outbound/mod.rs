//! Adapters this crate reaches the rest of the world through.

/// Minting a scoped GitHub App installation credential.
pub mod github_tokens;

/// Resolving an owner's custom (URL-added) MCP servers to upstream calls.
pub mod custom_mcp;

/// Answering the reserved `macro` slug with Macro's own MCP server.
pub mod macro_mcp;

/// Resolving an owner's Pipedream-connected apps to scoped upstream calls.
pub mod mcp_credentials;

/// Resolving a sandbox's session token to the session it stands for.
pub mod session_authority;

/// Executing an already-addressed, already-stamped request.
pub mod forwarder;

/// Held tool calls in Postgres, and the NOTIFY that wakes their holds.
pub mod tool_approvals;
