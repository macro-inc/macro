//! Who a tool call came from, for hosts that serve more than one kind of caller.

use bot_id::BotId;

/// The caller behind a tool call that a host authenticated. Hosts that serve
/// several kinds of caller (the public MCP) pick one per call; there is no
/// default, so a write never falls back to a bot without saying why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolCaller {
    /// An agent session's call, carrying the agent its credential was signed
    /// for. Writes are attributed to that agent on the user's behalf.
    Agent(BotId),
    /// An OAuth MCP client acting for the user. `name` is the name the client
    /// registered under: self-reported, so a display label only, never an
    /// identity or a permission. The broker bounds its length and characters
    /// and refuses reserved names. Absent for a token the broker issued before
    /// it recorded which client it went to, or whose stored name is reserved.
    McpClient {
        /// The client's registered name, such as "Claude Code".
        name: Option<String>,
    },
    /// A Macro API key the user pasted into a client, which names no client.
    ApiKey,
}

impl ToolCaller {
    /// The client a write made for this caller is shown under, if any. An
    /// MCP client that registered no name is shown as a generic one.
    pub fn via(&self) -> Option<&str> {
        match self {
            Self::McpClient { name } => Some(name.as_deref().unwrap_or("MCP client")),
            Self::Agent(_) | Self::ApiKey => None,
        }
    }
}
