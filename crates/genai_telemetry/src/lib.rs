//! GenAI span telemetry shared by the AI toolset and the agent loop.
//!
//! The agent runtime (`rig`) already emits the *structural* OpenTelemetry GenAI
//! spans — `invoke_agent`, `chat`, `execute_tool` — with model, provider, usage
//! and tool names. What it does not give us, and what Datadog LLM Observability
//! evaluations (Tool Selection, Goal Completeness, …) need, is
//!
//! - the **content**: prompts, tool arguments, tool results and model output
//!   (`gen_ai.input.messages`, `gen_ai.output.messages`,
//!   `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, …),
//! - the **tool definitions** offered on each model call
//!   (`gen_ai.tool.definitions`), and
//! - the **session** the trace belongs to (`gen_ai.conversation.id`).
//!
//! This crate provides the shared pieces to record them:
//!
//! - [`attr`]: the `gen_ai.*` attribute names and well-known values, spelled once.
//! - [`ContentPolicy`] / [`Limits`]: whether content may be captured (the
//!   OpenTelemetry-standard `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`
//!   switch) and how large a single attribute may grow. Content is always
//!   bounded — a 12-turn agent run otherwise re-sends the whole conversation on
//!   every `chat` span and a tool can return a whole document.
//! - [`messages`]: builders for the semconv JSON shapes (`{"role", "parts"}`
//!   messages, tool definitions, system instructions) that Datadog parses.
//! - [`GenAiSpanExt`]: attribute setters that write straight to the
//!   OpenTelemetry span. `tracing` only accepts fields declared at span
//!   creation, so this is the only way to add attributes to spans another crate
//!   (rig) opened — and it keeps large content out of the JSON log layer, which
//!   would otherwise repeat every span field on every log line.

#![deny(missing_docs)]

pub mod attr;
mod content;
pub mod messages;
mod span;

pub use content::{
    BoundedMessages, ContentPolicy, Limits, bound_messages, bound_tool_definitions,
    bounded_json_string, truncate_bytes, truncate_chars,
};
pub use span::{GenAiSpanExt, current_span_is_named};
