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
    /// identity or a permission. Absent for a token the broker issued before
    /// it recorded which client it went to.
    McpClient {
        /// The client's registered name, such as "Claude Code".
        name: Option<String>,
    },
    /// A Macro API key the user pasted into a client, which names no client.
    ApiKey,
}

impl ToolCaller {
    /// The label a write made for this caller is shown "via", if any.
    pub fn via(&self) -> Option<&str> {
        match self {
            Self::McpClient { name } => name.as_deref(),
            Self::Agent(_) | Self::ApiKey => None,
        }
    }
}
