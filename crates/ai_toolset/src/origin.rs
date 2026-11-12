//! Who dispatched a tool call, recorded on its `execute_tool` span.
//!
//! The same tool runs for many callers: an agent session's turn, a background
//! agent (memory, ai_projection, …), the channel bot, a public MCP client. A
//! [`ToolCallOrigin`] rides on the [`RequestContext`](crate::RequestContext)
//! and [`ToolSet::try_tool_call`](crate::ToolSet::try_tool_call) records it on
//! the call's span, so a trace search can tell the callers apart without
//! walking parents. These are structural labels, never content, so they are
//! recorded whatever the content policy says.

use crate::ToolCaller;
use genai_telemetry::{GenAiSpanExt as _, attr, current_span_is_named};

/// Longest MCP client name recorded: the name is self-reported.
const MAX_CLIENT_NAME_CHARS: usize = 64;

/// How a caller is presented Macro's tools.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ToolMode {
    /// The direct Macro tools: callers that cannot run code (summaries,
    /// sessions without a user owner, no code runner reachable, clients that
    /// refuse generic executors).
    Standard,
    /// Code mode: the SDK replaces every direct tool it covers.
    Code,
}

/// Who dispatched a tool call. Every field is optional: a host records what it
/// knows, and an empty origin records nothing.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ToolCallOrigin {
    host: Option<String>,
    tool_mode: Option<ToolMode>,
    turn_purpose: Option<&'static str>,
    caller: Option<ToolCaller>,
}

impl ToolCallOrigin {
    /// The host or agent running the call, such as `agent_session`, `memory`
    /// or `public_mcp`.
    pub fn with_host(mut self, host: impl Into<String>) -> Self {
        self.host = Some(host.into());
        self
    }

    /// Set the host only when none was set.
    pub fn or_host(self, host: impl Into<String>) -> Self {
        match self.host {
            Some(_) => self,
            None => self.with_host(host),
        }
    }

    /// How the caller is presented Macro's tools.
    pub fn with_tool_mode(mut self, tool_mode: ToolMode) -> Self {
        self.tool_mode = Some(tool_mode);
        self
    }

    /// What the turn making the call is for, such as `conversation`.
    pub fn with_turn_purpose(mut self, purpose: &'static str) -> Self {
        self.turn_purpose = Some(purpose);
        self
    }

    /// The authenticated public MCP caller.
    pub fn with_caller(mut self, caller: ToolCaller) -> Self {
        self.caller = Some(caller);
        self
    }

    /// Record the origin on `span`.
    pub fn record(&self, span: &tracing::Span) {
        if let Some(host) = &self.host {
            span.set_str(attr::MACRO_TOOL_HOST, host.clone());
        }
        if let Some(tool_mode) = self.tool_mode {
            span.set_str(attr::MACRO_TOOL_MODE, <&str>::from(tool_mode));
        }
        if let Some(purpose) = self.turn_purpose {
            span.set_str(attr::MACRO_TURN_PURPOSE, purpose);
        }
        if let Some(caller) = &self.caller {
            span.set_str(attr::MACRO_MCP_CALLER, caller_kind(caller));
            if let ToolCaller::McpClient { name: Some(name) } = caller {
                // Cut plainly, with no marker: the name is grouped by.
                span.set_str(
                    attr::MACRO_MCP_CLIENT_NAME,
                    name.chars().take(MAX_CLIENT_NAME_CHARS).collect::<String>(),
                );
            }
        }
    }

    /// Record the origin on the current span when it is an `execute_tool`
    /// span, for dispatches that open no span of their own.
    pub fn record_on_current_tool_span(&self) {
        if current_span_is_named(attr::span_name::EXECUTE_TOOL) {
            self.record(&tracing::Span::current());
        }
    }
}

fn caller_kind(caller: &ToolCaller) -> &'static str {
    match caller {
        ToolCaller::Agent(_) => "agent",
        ToolCaller::McpClient { .. } => "mcp_client",
        ToolCaller::ApiKey => "api_key",
    }
}
