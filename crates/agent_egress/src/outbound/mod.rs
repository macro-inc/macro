//! Adapters this crate reaches the rest of the world through.

/// Minting a scoped GitHub App installation credential.
pub mod github_tokens;

/// Answering the reserved `macro` slug with Macro's own MCP server.
pub mod macro_mcp;

/// Resolving an owner's connected apps and custom servers, within what the
/// session's agent was given, through the connectors service.
pub mod mcp_credentials;

/// Resolving a sandbox's session token to the session it stands for.
pub mod session_authority;

/// Executing an already-addressed, already-stamped request.
pub mod forwarder;

/// Held tool calls in Postgres, and the NOTIFY that wakes their holds.
pub mod tool_approvals;

/// MCP tool exchanges with credentials isolated per invocation.
pub mod actor_mcp;

/// Pacing each account's MCP exchanges per upstream, with 429 retries.
pub mod budgeted_mcp;
