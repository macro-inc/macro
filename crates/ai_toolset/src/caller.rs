//! Who a tool call came from, for hosts that serve more than one kind of caller.

use bot_id::BotId;
use mcp_client_label::McpClientLabel;

/// The caller behind a tool call that a host authenticated. Hosts that serve
/// several kinds of caller (the public MCP) pick one per call; there is no
/// default, so a write never falls back to a bot without saying why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolCaller {
    /// An agent session's call, carrying the agent its credential was signed
    /// for. Writes are attributed to that agent on the user's behalf.
    Agent(BotId),
    /// An OAuth MCP client acting for the user. `client` is the name the
    /// client registered under, self-reported, and the product its
    /// registration was verified as: a display label only, never an identity
    /// or a permission. Absent for a token the broker issued before it
    /// recorded which client it went to.
    McpClient {
        /// The client's registered label, such as "Claude Code".
        client: Option<McpClientLabel>,
    },
    /// A Macro API key the user pasted into a client, which names no client.
    ApiKey,
}

impl ToolCaller {
    /// The client a write made for this caller is shown under, if any. An
    /// MCP client that registered no name is shown as a generic one.
    pub fn via(&self) -> Option<McpClientLabel> {
        match self {
            Self::McpClient {
                client: Some(client),
            } => Some(client.clone()),
            Self::McpClient { client: None } => Some(McpClientLabel {
                name: "MCP client".to_owned(),
                kind: None,
            }),
            Self::Agent(_) | Self::ApiKey => None,
        }
    }
}
