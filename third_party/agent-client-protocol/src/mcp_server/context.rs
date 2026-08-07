use crate::{ConnectionTo, role::Role};

/// Context about the ACP and MCP connection available to an MCP server.
#[derive(Clone, Debug)]
pub struct McpConnectionTo<Counterpart: Role> {
    pub(super) acp_id: String,
    pub(super) connection: ConnectionTo<Counterpart>,
}

impl<Counterpart: Role> McpConnectionTo<Counterpart> {
    /// The ACP identifier for this MCP server (e.g., `"acp:UUID"`).
    pub fn acp_id(&self) -> String {
        self.acp_id.clone()
    }

    /// The `acp:UUID` that was given.
    #[deprecated(since = "0.12.0", note = "renamed to `acp_id()`")]
    pub fn acp_url(&self) -> String {
        self.acp_id()
    }

    /// The host connection context.
    ///
    /// If this MCP server is hosted inside of an ACP context, this will be the ACP connection context.
    pub fn connection_to(&self) -> ConnectionTo<Counterpart> {
        self.connection.clone()
    }
}
