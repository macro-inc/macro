//! Definitions for personas provisioned by product integrations.

/// Immutable configuration used to create a provisioned persona.
pub struct ProvisionedAgent {
    /// Stable key identifying the integration for one owner.
    pub key: &'static str,
    /// Initial display name.
    pub name: &'static str,
    /// Initial mention handle.
    pub handle: &'static str,
    /// Initial description.
    pub description: &'static str,
    /// Runtime harness slug.
    pub harness: &'static str,
    /// Initial model selection.
    pub default_model: &'static str,
}

/// The private persona created when a user connects Cursor.
pub const CURSOR_PERSONA: ProvisionedAgent = ProvisionedAgent {
    key: "cursor",
    name: "Cursor",
    handle: "cursor",
    description: "Your private Cursor coding agent.",
    harness: "cursor",
    default_model: "default",
};
