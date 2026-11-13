//! A wake's trace, version 1: its model session's turns and tool calls,
//! parsed from a Claude Code transcript or a Codex rollout and redacted by
//! the agent before upload (muppet's trace utility). Stored whole as one blob
//! per wake and read whole. Its text is the agent's session content.

use serde::{Deserialize, Serialize};

/// Which program wrote the transcript the trace was parsed from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum WakeTraceSource {
    /// A Claude Code transcript.
    Claude,
    /// A Codex rollout.
    Codex,
}

/// Tokens one model turn used.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct WakeTraceTokens {
    /// Input tokens.
    pub input: f64,
    /// Output tokens.
    pub output: f64,
    /// Input tokens read from the cache.
    pub cache_read: f64,
    /// Input tokens written to the cache.
    pub cache_write: f64,
}

/// One step on a trace's timeline. Instants are ISO 8601.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WakeTraceSpan {
    /// The prompt, or anything said to the session after it.
    User {
        /// When it was said.
        at: String,
        /// What was said.
        text: String,
    },
    /// One model response.
    Turn {
        /// Its place among the turns, from 0.
        index: u32,
        /// When it began.
        at: String,
        /// When it ended.
        end: String,
        /// The model that answered.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        /// What it said.
        text: String,
        /// What it thought.
        thinking: String,
        /// What it used.
        tokens: WakeTraceTokens,
    },
    /// One tool call.
    Tool {
        /// The tool call's id.
        id: String,
        /// The index of the turn that called it.
        turn: u32,
        /// When it was called.
        at: String,
        /// When it returned; absent while it runs.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        end: Option<String>,
        /// The tool.
        name: String,
        /// Its input, as the model gave it.
        #[cfg_attr(feature = "schema", schema(value_type = Object))]
        input: serde_json::Value,
        /// Its result as text; absent while it runs.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<String>,
        /// Whether it failed.
        error: bool,
    },
}

/// A wake's model session from end to end.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct WakeTrace {
    /// The format version; always 1.
    pub v: u8,
    /// Which program wrote the transcript.
    pub source: WakeTraceSource,
    /// The model session's id.
    pub session_id: String,
    /// The transcript's first instant.
    pub started_at: String,
    /// The transcript's last instant.
    pub ended_at: String,
    /// Whether the session was still being written when this was uploaded.
    pub live: bool,
    /// The model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The title Claude Code gave the session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// What the session cost, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    /// The timeline.
    pub spans: Vec<WakeTraceSpan>,
}
