use async_trait::async_trait;
use serde::Serialize;

/// Result type for tool calls, containing either the output or a [`ToolCallError`].
pub type ToolResult<T> = std::result::Result<T, ToolCallError>;

/// A unit type for tools that don't require any context.
pub struct NoContext();

/// Error type for failed tool calls.
///
/// Contains both an internal error for logging/debugging and a user-facing description.
#[derive(Debug)]
pub struct ToolCallError {
    /// The underlying error that caused the tool call to fail.
    pub internal_error: anyhow::Error,
    /// A human-readable description of the error suitable for returning to the AI.
    pub description: String,
}

impl std::fmt::Display for ToolCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "description: {}. error: {}",
            self.description, self.internal_error
        )
    }
}

/// Trait for synchronous tools that can be called by an AI model.
///
/// # Type Parameters
///
/// - `Sc`: Service context type (shared state like database connections)
/// - `Rc`: Request context type (per-request data like user info)
pub trait Tool<Sc, Rc>: Sync + Send {
    /// The output type produced by this tool.
    type Output: Serialize + 'static;

    /// Execute the tool with the given contexts.
    fn call(&self, service_context: Sc, request_context: Rc) -> ToolResult<Self::Output>;
}

/// Trait for asynchronous tools that can be called by an AI model.
///
/// # Type Parameters
///
/// - `Sc`: Service context type (shared state like database connections)
/// - `Rc`: Request context type (per-request data like user info)
#[async_trait]
pub trait AsyncTool<Sc, Rc>: Sync + Send {
    /// The output type produced by this tool.
    type Output: Serialize + 'static;

    /// Execute the tool asynchronously with the given contexts.
    async fn call(&self, service_context: Sc, request_context: Rc) -> ToolResult<Self::Output>;
}
