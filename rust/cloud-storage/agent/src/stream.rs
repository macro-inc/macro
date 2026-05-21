/// Stream of agent events, compatible with existing DCS consumers.
use crate::error::AgentError;
use futures::stream::Stream;
use serde::Serialize;
use std::pin::Pin;

/// The main streaming type returned by [`crate::Session::send_message`].
pub type ChatCompletionStream<'a> =
    Pin<Box<dyn Stream<Item = Result<StreamPart, AgentError>> + Send + 'a>>;

/// An individual event in the agent stream.
#[derive(Debug, Clone)]
pub enum StreamPart {
    /// A text delta from the assistant.
    Content(String),
    /// A complete tool invocation by the assistant.
    ToolCall(ToolCall),
    /// The result of executing a tool.
    ToolResponse(ToolResponse),
    /// Token usage for one completion round-trip.
    Usage(Usage),
}

/// Metadata identifying an MCP (external) tool.
#[derive(Debug, Clone, Serialize)]
pub struct McpInfo {
    /// The MCP server name.
    pub service: String,
    /// The original (un-mangled) tool name.
    pub tool_name: String,
    /// Human-readable display name, if the server provides one.
    pub display_name: Option<String>,
}

/// A tool call made by the assistant.
#[derive(Debug, Clone, Serialize)]
pub struct ToolCall {
    /// Provider-assigned call ID.
    pub id: String,
    /// Tool name (mangled for MCP tools).
    pub name: String,
    /// Parsed JSON arguments.
    pub json: serde_json::Value,
    /// Present when this is an MCP tool call.
    pub mcp: Option<McpInfo>,
}

/// Result of a tool execution.
#[derive(Debug, Clone)]
pub enum ToolResponse {
    /// Successful execution with JSON output.
    Json {
        /// The call ID this response corresponds to.
        id: String,
        /// The JSON output from the tool.
        json: serde_json::Value,
        /// The tool name.
        name: String,
    },
    /// Failed execution.
    Err {
        /// The call ID this response corresponds to.
        id: String,
        /// The tool name.
        name: String,
        /// Human-readable error description.
        description: String,
    },
}

/// Token usage for a completion round-trip.
#[derive(Debug, Clone)]
pub struct Usage {
    /// Tokens consumed by the input.
    pub input_tokens: u64,
    /// Tokens generated in the output.
    pub output_tokens: u64,
}
