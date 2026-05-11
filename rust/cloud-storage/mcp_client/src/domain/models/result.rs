use thiserror::Error;

/// Domain errors for the MCP client.
#[derive(Debug, Error)]
pub enum Error {
    /// The server requires authentication but no credentials are stored.
    #[error("no credentials stored for server: {0}")]
    NoCredentials(String),
    /// Stored credentials are invalid or expired.
    #[error("invalid credentials for server: {0}")]
    InvalidCredentials(String),
    /// Failed to connect to the MCP server.
    #[error("connection failed: {0}")]
    Connection(String),
    /// The requested tool was not found on any connected server.
    #[error("unknown tool: {0}")]
    UnknownTool(String),
    /// A tool invocation failed.
    #[error("tool call failed: {0}")]
    ToolCall(String),
    /// A mangled tool name already exists in the tool set.
    #[error("tool name conflict: {0}")]
    ToolConflict(String),
    /// An internal or infrastructure error.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// Domain result type.
pub type Result<T> = std::result::Result<T, Error>;
