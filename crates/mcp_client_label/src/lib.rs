//! The label an MCP client's posts are shown under: the name it registered
//! with and, when its registration backs the claim, which known product it is.

/// A known MCP client product whose mark Macro shows on its posts.
///
/// Only set when the client's registration is consistent with the product (see
/// `mcp_auth_proxy`'s `client_kind`); a name alone never earns one. Stored by
/// its serialized name in `comms_messages.triggered_via_kind`, so a variant is
/// never renamed or removed while rows carry it.
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    PartialEq,
    Hash,
    serde::Serialize,
    serde::Deserialize,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub enum McpClientKind {
    /// Claude on claude.ai, the desktop and mobile apps.
    Claude,
    /// Anthropic's Claude Code CLI.
    ClaudeCode,
    /// OpenAI's ChatGPT.
    #[serde(rename = "chatgpt")]
    #[strum(serialize = "chatgpt")]
    ChatGpt,
    /// The Cursor editor.
    Cursor,
    /// OpenAI's Codex CLI.
    Codex,
    /// The OpenCode CLI.
    #[serde(rename = "opencode")]
    #[strum(serialize = "opencode")]
    OpenCode,
}

/// The client a user drives an agent through, as its posts are labelled.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct McpClientLabel {
    /// The client's self-reported registration name, such as "Claude Code";
    /// a display label only.
    pub name: String,
    /// The product the registration was verified as, if any.
    pub kind: Option<McpClientKind>,
}
