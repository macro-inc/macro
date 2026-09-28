//! OpenTelemetry GenAI semantic-convention attribute names and well-known values.
//!
//! Mirrors the `gen_ai.*` registry of the OpenTelemetry GenAI semantic
//! conventions, plus the two `macro.genai.*` attributes this workspace adds to
//! describe its own truncation. Datadog maps these onto its LLM Observability
//! schema: `gen_ai.operation.name` picks the span kind (`chat` → llm,
//! `execute_tool` → tool, `invoke_agent` → agent), `gen_ai.conversation.id` is
//! the session, `gen_ai.tool.definitions` the tool set an evaluation judges a
//! tool choice against, and the `*.messages` / `tool.call.*` attributes are the
//! span's input and output.

/// The operation performed: see [`operation`].
pub const OPERATION_NAME: &str = "gen_ai.operation.name";
/// The GenAI provider serving the request (`anthropic`, `openai`, …).
pub const PROVIDER_NAME: &str = "gen_ai.provider.name";
/// The model requested.
pub const REQUEST_MODEL: &str = "gen_ai.request.model";
/// The `max_tokens` request parameter.
pub const REQUEST_MAX_TOKENS: &str = "gen_ai.request.max_tokens";
/// The `temperature` request parameter.
pub const REQUEST_TEMPERATURE: &str = "gen_ai.request.temperature";
/// The model that actually answered.
pub const RESPONSE_MODEL: &str = "gen_ai.response.model";
/// The provider-assigned response id.
pub const RESPONSE_ID: &str = "gen_ai.response.id";
/// Why generation stopped, one entry per choice: see [`finish_reason`].
pub const RESPONSE_FINISH_REASONS: &str = "gen_ai.response.finish_reasons";
/// Input tokens consumed.
pub const USAGE_INPUT_TOKENS: &str = "gen_ai.usage.input_tokens";
/// Output tokens produced.
pub const USAGE_OUTPUT_TOKENS: &str = "gen_ai.usage.output_tokens";
/// The messages sent to the model / agent, as a JSON array of
/// `{"role", "parts"}` objects (see [`crate::messages`]).
pub const INPUT_MESSAGES: &str = "gen_ai.input.messages";
/// The messages produced by the model / agent, as a JSON array of
/// `{"role", "parts", "finish_reason"}` objects (see [`crate::messages`]).
pub const OUTPUT_MESSAGES: &str = "gen_ai.output.messages";
/// The system instructions, as a JSON array of parts, kept separate from the
/// chat history.
pub const SYSTEM_INSTRUCTIONS: &str = "gen_ai.system_instructions";
/// The tools offered to the model, as a JSON array of
/// `{"type": "function", "name", "description", "parameters"}` objects.
pub const TOOL_DEFINITIONS: &str = "gen_ai.tool.definitions";
/// The name of the tool executed.
pub const TOOL_NAME: &str = "gen_ai.tool.name";
/// The description of the tool executed.
pub const TOOL_DESCRIPTION: &str = "gen_ai.tool.description";
/// The kind of tool executed: see [`tool_type`].
pub const TOOL_TYPE: &str = "gen_ai.tool.type";
/// The provider-assigned tool call id.
pub const TOOL_CALL_ID: &str = "gen_ai.tool.call.id";
/// The arguments the tool was called with (opt-in content).
pub const TOOL_CALL_ARGUMENTS: &str = "gen_ai.tool.call.arguments";
/// The result the tool returned (opt-in content).
pub const TOOL_CALL_RESULT: &str = "gen_ai.tool.call.result";
/// The name of the agent.
pub const AGENT_NAME: &str = "gen_ai.agent.name";
/// The conversation (session) this operation belongs to.
pub const CONVERSATION_ID: &str = "gen_ai.conversation.id";
/// Low-cardinality error class when the operation failed.
pub const ERROR_TYPE: &str = "error.type";

/// Macro-specific: how many of the oldest messages were dropped from
/// [`INPUT_MESSAGES`] to fit the size budget (see [`crate::Limits`]).
pub const MACRO_INPUT_MESSAGES_OMITTED: &str = "macro.genai.input_messages_omitted";
/// Macro-specific: `true` when any content attribute on the span was cut to fit
/// the size budget (see [`crate::Limits`]).
pub const MACRO_CONTENT_TRUNCATED: &str = "macro.genai.content_truncated";
/// Macro-specific: tokens in the agent's context window after a turn, as the
/// harness reported it (ACP `usage_update.used`).
pub const MACRO_CONTEXT_USED_TOKENS: &str = "macro.genai.context.used_tokens";
/// Macro-specific: the agent's context window size in tokens (ACP
/// `usage_update.size`).
pub const MACRO_CONTEXT_SIZE_TOKENS: &str = "macro.genai.context.size_tokens";
/// Macro-specific: the coarse ACP tool kind (`execute`, `edit`, `read`, …).
pub const MACRO_TOOL_KIND: &str = "macro.genai.tool.kind";
/// Macro-specific: the human-readable title the harness gave a tool call.
pub const MACRO_TOOL_TITLE: &str = "macro.genai.tool.title";
/// Macro-specific: the MCP server a tool was reached through, when it was.
pub const MACRO_MCP_SERVER: &str = "macro.genai.mcp.server";

/// Well-known [`OPERATION_NAME`] values.
pub mod operation {
    /// An agent run (a turn of the agent loop).
    pub const INVOKE_AGENT: &str = "invoke_agent";
    /// A model completion.
    pub const CHAT: &str = "chat";
    /// A tool execution.
    pub const EXECUTE_TOOL: &str = "execute_tool";
}

/// Well-known [`TOOL_TYPE`] values.
pub mod tool_type {
    /// A client-side function the agent executes.
    pub const FUNCTION: &str = "function";
}

/// Well-known [`RESPONSE_FINISH_REASONS`] values.
pub mod finish_reason {
    /// The model finished naturally.
    pub const STOP: &str = "stop";
    /// The model stopped to call one or more tools.
    pub const TOOL_CALL: &str = "tool_call";
    /// The model hit a token or request limit.
    pub const LENGTH: &str = "length";
    /// The model refused to continue.
    pub const CONTENT_FILTER: &str = "content_filter";
    /// The run failed before the model finished.
    pub const ERROR: &str = "error";
    /// The run was cancelled by the caller.
    pub const CANCELLED: &str = "cancelled";
}

/// Span names used for the semconv spans this workspace opens or adopts. The
/// agent runtime names its spans identically, which is how the toolset detects
/// an already-open tool span (see [`crate::current_span_is_named`]).
pub mod span_name {
    /// The per-tool-call span.
    pub const EXECUTE_TOOL: &str = "execute_tool";
    /// The per-agent-run span.
    pub const INVOKE_AGENT: &str = "invoke_agent";
}
