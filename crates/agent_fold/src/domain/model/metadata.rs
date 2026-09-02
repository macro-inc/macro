//! Session-level state derived from the log.

use serde::Serialize;
use specta::Type;

/// Session-level state derived from the log, latest-wins and carried whole.
/// Fields start absent and fill in as the log reveals them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
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
