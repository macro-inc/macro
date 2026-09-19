//! Enforced `execute_tool` telemetry for every tool dispatch.
//!
//! [`ToolSet::try_tool_call`](crate::ToolSet::try_tool_call) is the one door a
//! tool call goes through — the agent loop, user-executed tools and pipelines
//! all dispatch via the trait — and it wraps every call in a [`ToolCallSpan`].
//! Two situations:
//!
//! - The agent runtime already opened the semconv `execute_tool` span around
//!   the dispatch (it carries the tool name and the provider's call id). The
//!   guard **enriches** that span rather than nesting a duplicate.
//! - Nothing did — a user confirming a deferred tool, a pipeline calling a
//!   tool directly, a test. The guard **opens** `execute_tool {name}` itself.
//!
//! Either way the span ends up with what Datadog's tool evaluations read:
//! `gen_ai.operation.name`, `gen_ai.tool.name`, the arguments as input and the
//! result as output (both subject to the content policy and size bounds in
//! [`genai_telemetry`]), and an error status when the call failed.

#[cfg(test)]
mod test;

use crate::{ToolResult, ToolSetError};
use genai_telemetry::{
    ContentPolicy, GenAiSpanExt as _, attr, bounded_json_string, current_span_is_named,
    truncate_chars,
};
use serde::Serialize;

/// Telemetry guard for one tool call.
///
/// Create it with [`ToolCallSpan::begin`], run the call inside
/// [`ToolCallSpan::span`] (`fut.instrument(guard.span().clone())`), then hand
/// the outcome to [`ToolCallSpan::finish`].
#[derive(Debug)]
pub struct ToolCallSpan {
    span: tracing::Span,
    policy: ContentPolicy,
    tool_name: String,
}

impl ToolCallSpan {
    /// Begin telemetry for a call of `tool_name` with `arguments`, under the
    /// process-wide [`ContentPolicy`].
    pub fn begin(tool_name: &str, arguments: &serde_json::Value) -> Self {
        Self::begin_with_policy(tool_name, arguments, ContentPolicy::from_env())
    }

    /// [`Self::begin`] with an explicit content policy.
    pub fn begin_with_policy(
        tool_name: &str,
        arguments: &serde_json::Value,
        policy: ContentPolicy,
    ) -> Self {
        let span = if current_span_is_named(attr::span_name::EXECUTE_TOOL) {
            // The runtime's span already names the tool and carries the call
            // id; only the content and outcome are missing.
            tracing::Span::current()
        } else {
            // The literal must stay in step with `attr::span_name::EXECUTE_TOOL`
            // (`tracing` bakes the name into static metadata); `otel.name`
            // gives the exported span the semconv `execute_tool {name}` name.
            let otel_name = format!("{} {tool_name}", attr::operation::EXECUTE_TOOL);
            tracing::info_span!(
                "execute_tool",
                otel.name = %otel_name,
                gen_ai.operation.name = attr::operation::EXECUTE_TOOL,
                gen_ai.tool.type = attr::tool_type::FUNCTION,
                gen_ai.tool.name = %tool_name,
            )
        };
        if policy.capture {
            let (arguments, truncated) = bounded_json_string(arguments, &policy.limits);
            span.set_str(attr::TOOL_CALL_ARGUMENTS, arguments);
            if truncated {
                span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
            }
        }
        Self {
            span,
            policy,
            tool_name: tool_name.to_owned(),
        }
    }

    /// The span the call must run inside.
    pub fn span(&self) -> &tracing::Span {
        &self.span
    }

    /// Record the outcome: the result as the span's output on success, an
    /// error status (and the model-facing description as output) otherwise.
    pub fn finish<T: Serialize>(&self, result: &Result<ToolResult<T>, ToolSetError>) {
        match result {
            Ok(Ok(output)) => {
                if self.policy.capture {
                    match serde_json::to_value(output) {
                        Ok(value) => self.record_result(&value),
                        Err(error) => tracing::debug!(
                            error = ?error,
                            tool_name = %self.tool_name,
                            "tool result is not serializable; not recorded on the span"
                        ),
                    }
                }
            }
            Ok(Err(error)) => {
                // The tool ran and failed; `description` is what the model
                // sees, so it doubles as the span's output - and is content,
                // recorded under the same policy.
                self.span.set_error(
                    "tool_error",
                    self.error_description(&error.description, "the tool reported an error"),
                );
                if self.policy.capture {
                    self.record_result(&serde_json::Value::String(error.description.clone()));
                }
            }
            Err(error @ ToolSetError::NotFound(_)) => {
                tracing::warn!(tool_name = %self.tool_name, error = %error, "tool call could not be dispatched");
                self.span.set_error("tool_not_found", "no such tool");
            }
            Err(error @ ToolSetError::Deserialization(_)) => {
                tracing::warn!(tool_name = %self.tool_name, error = %error, "tool call could not be dispatched");
                // The message quotes the arguments it could not read.
                self.span.set_error(
                    "invalid_arguments",
                    self.error_description(
                        &error.to_string(),
                        "the arguments did not match the tool's schema",
                    ),
                );
            }
        }
    }

    /// An error description fit for the span's status: the detail, bounded,
    /// when content may be recorded; a fixed summary otherwise.
    fn error_description(&self, detail: &str, summary: &'static str) -> String {
        if self.policy.capture {
            truncate_chars(detail, self.policy.limits.max_part_chars).into_owned()
        } else {
            summary.to_owned()
        }
    }

    fn record_result(&self, value: &serde_json::Value) {
        let (result, truncated) = bounded_json_string(value, &self.policy.limits);
        self.span.set_str(attr::TOOL_CALL_RESULT, result);
        if truncated {
            self.span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
        }
    }
}
