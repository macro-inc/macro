//! Session-level state derived from the log.

use serde::Serialize;
use specta::Type;

/// Which ACP agent produced a session's log.
///
/// ACP names none of a harness's conventions - which `_meta` keys it writes,
/// what it calls its tools, how it reports a subagent - so the fold has to
/// know who it is reading in order to read those. The agent announces itself
/// in the `initialize` response's `agentInfo.name`; a log that starts
/// mid-session (a resume) is recognized from the `_meta` namespaces its
/// first tool frames carry instead. Carried on the metadata so a reader can
/// show it and never has to infer it.
///
/// [`Self::Unknown`] is a real state, not a failure: every reader falls back
/// to the harness-neutral conventions, and a harness this fold has not met
/// still folds to the generic vocabulary.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Harness {
    /// `@agentclientprotocol/claude-agent-acp`.
    ClaudeCode,
    /// `OpenCode`, whose ACP server is built in.
    OpenCode,
    /// OpenAI Codex, through `codex-acp`.
    Codex,
    /// Cursor cloud agents, through this repository's `cursor_cloud_agents`.
    Cursor,
    /// Macro's own in-process agent, `agent_inmem`.
    Macro,
    /// Nous Research's Hermes agent.
    Hermes,
    /// OpenClaw.
    OpenClaw,
    /// Not announced, or an agent this fold does not know.
    #[default]
    Unknown,
}

/// Session-level state derived from the log, latest-wins and carried whole.
/// Fields start absent and fill in as the log reveals them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    /// The agent that produced the log. See [`Harness`].
    pub harness: Harness,
    /// Current model per the runtime's own `configOptions` responses, so a
    /// rejected model change never moves it.
    pub model: Option<String>,
    /// The models the runtime offers, in the order it listed them.
    pub supported_models: Vec<ModelOption>,
    /// Session title, when the harness reports one.
    pub title: Option<String>,
    /// The slash commands the harness most recently advertised, in the order
    /// it listed them. Empty until the first `available_commands_update`,
    /// which arrives right after session setup, before any turn.
    pub available_commands: Vec<AvailableCommand>,
    /// The last system event's wire name (`"acp_ready"`, `"disconnected"`),
    /// `None` until the runtime reports one.
    pub status: Option<String>,
}

/// One slash command the harness advertises.
///
/// Mirrors ACP's `AvailableCommand`, flattened: the only input shape ACP
/// defines today is "unstructured text after the name," so the hint is
/// carried directly rather than through a nested enum.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvailableCommand {
    /// Bare name as advertised (`"qc"`, `"honeycomb:query-patterns"`) - no
    /// leading slash, which is client syntax rather than part of the name.
    pub name: String,
    /// Human-readable description, verbatim from the harness.
    pub description: String,
    /// Placeholder text for the command's input, when it takes any.
    pub input_hint: Option<String>,
}

/// One model the runtime offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    /// The value to send back to select this model.
    pub id: String,
    /// Human-readable label.
    pub name: String,
    /// Descriptive copy - pricing, context size, and the like.
    pub description: Option<String>,
}
