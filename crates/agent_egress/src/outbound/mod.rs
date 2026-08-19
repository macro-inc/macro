//! Adapters this crate reaches the rest of the world through.

/// Minting a scoped GitHub App installation credential.
pub mod github_tokens;

/// Resolving an owner's connected MCP servers to live OAuth tokens.
pub mod mcp_credentials;

/// Resolving a sandbox's session token to the session it stands for.
pub mod session_authority;

/// Executing an already-addressed, already-stamped request.
pub mod forwarder;
