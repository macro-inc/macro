//! A running execution's route to the session agent's connected apps.
//!
//! A program reaches the same apps and custom MCP servers the session's
//! agent was given, through the harness's credential-stamping egress: the
//! sandbox never sees a token. The program spends the one account its
//! execution was approved for, and only while that execution runs in the
//! turn it was started for.

use agent_session::domain::model::AgentSessionId;
use ai_toolset::actor::ToolActor;
use async_trait::async_trait;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::inbound::toolset::{ConnectMcpServer, ConnectMcpServerResponse};
use pipedream_mcp::domain::service::discovery::DiscoveryRequest;
use pipedream_mcp::inbound::toolset::DiscoverConnectorsResponse;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

use super::{CodeModeError, ExecutionId, ExecutionStatus, ExecutionStore, ExecutionTurns};

#[cfg(test)]
mod test;

/// Which store a connected app comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConnectedAppKind {
    /// An app connected through Macro Connect or Pipedream, keyed by its slug.
    App,
    /// A custom MCP server the owner added by URL, keyed by a digest of the URL.
    Custom,
}

/// Names one connected app: the key is its slug or its URL digest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedAppRef {
    /// Which store the app comes from.
    pub kind: ConnectedAppKind,
    /// The app's slug, or its custom server key.
    pub key: String,
}

/// A connected app the session's agent may use.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedApp {
    /// Which store the app comes from.
    pub kind: ConnectedAppKind,
    /// The app's slug, or its custom server key.
    pub key: String,
    /// Display name, e.g. `Slack` or the owner's name for a custom server.
    pub name: String,
}

/// One tool a connected app serves.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedTool {
    /// The tool's name on its server.
    pub name: String,
    /// What the server says the tool does.
    pub description: Option<String>,
    /// JSON Schema for the tool's arguments.
    #[schema(value_type = Object)]
    pub input_schema: serde_json::Value,
}

/// One tool found by a search across the agent's connected apps.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedToolMatch {
    /// The app serving the tool.
    pub app: ConnectedApp,
    /// The tool.
    pub tool: ConnectedTool,
}

/// The best matches across the agent's connected apps, and the apps whose
/// tools could not be listed, which the search did not cover.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedToolSearch {
    /// At most [`MAX_TOOL_MATCHES`] tools, best first.
    pub matches: Vec<ConnectedToolMatch>,
    /// Apps whose tools could not be listed.
    pub unsearched: Vec<ConnectedApp>,
}

/// Most tools one search returns.
pub const MAX_TOOL_MATCHES: usize = 20;

/// Call one tool of a connected app.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CallConnectedTool {
    /// The tool's name on its server.
    pub tool: String,
    /// The tool's arguments, matching its input schema.
    #[serde(default)]
    #[schema(value_type = Object)]
    pub arguments: serde_json::Map<String, serde_json::Value>,
}

/// A connected tool's answer: MCP's `CallToolResult`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedToolResult {
    /// The tool failed, or could not run; `content` says why.
    pub is_error: bool,
    /// MCP content blocks, e.g. `{type: "text", text}`.
    #[schema(value_type = Vec<Object>)]
    pub content: Vec<serde_json::Value>,
    /// Structured output, for tools that declare an output schema.
    #[schema(value_type = Option<Object>)]
    pub structured_content: Option<serde_json::Value>,
}

/// The accounts a session's turn can act as.
#[derive(Clone, Debug)]
pub struct SessionAccounts {
    /// The session owner.
    pub owner: MacroUserIdStr<'static>,
    /// The person behind the running turn; `None` for a system turn.
    pub requester: Option<MacroUserIdStr<'static>>,
}

/// A running execution's admitted use: the account its calls spend.
#[derive(Clone, Debug)]
pub struct ConnectedAppUse {
    /// The execution's session.
    pub session: AgentSessionId,
    /// The account choice the execution was approved for.
    pub acting_as: ToolActor,
    /// That choice resolved against the current turn.
    pub user: MacroUserIdStr<'static>,
}

/// The session agent's connected apps, reached through the harness egress.
#[async_trait]
pub trait ConnectedAppTools: Send + Sync + 'static {
    /// The accounts the session's current turn can act as.
    async fn accounts(&self, session: AgentSessionId) -> Result<SessionAccounts, CodeModeError>;
    /// The apps the session's agent was given, without contacting any of them.
    async fn apps(&self, usage: &ConnectedAppUse) -> Result<Vec<ConnectedApp>, CodeModeError>;
    /// The tools `app` serves.
    async fn tools(
        &self,
        usage: &ConnectedAppUse,
        app: &ConnectedAppRef,
    ) -> Result<Vec<ConnectedTool>, CodeModeError>;
    /// Call one of `app`'s tools as the execution's account. In a turn
    /// somebody other than the owner prompted, a call spending the owner's
    /// access waits for the owner to approve it.
    async fn call(
        &self,
        usage: &ConnectedAppUse,
        app: &ConnectedAppRef,
        call: CallConnectedTool,
    ) -> Result<ConnectedToolResult, CodeModeError>;
    /// Search the connectable app catalog, or inspect one app's tools and
    /// connection status: what the `DiscoverConnectors` tool does.
    async fn discover(
        &self,
        usage: &ConnectedAppUse,
        request: DiscoveryRequest,
    ) -> Result<DiscoverConnectorsResponse, CodeModeError>;
    /// Add a custom MCP server to the account's connections: what the
    /// `ConnectMcpServer` tool does.
    async fn add_server(
        &self,
        usage: &ConnectedAppUse,
        server: ConnectMcpServer,
    ) -> Result<ConnectMcpServerResponse, CodeModeError>;
}

/// Admits a running execution's connected-app requests.
#[derive(Clone)]
pub struct ConnectedAppService {
    store: Arc<dyn ExecutionStore>,
    turns: Arc<dyn ExecutionTurns>,
    tools: Arc<dyn ConnectedAppTools>,
}

impl ConnectedAppService {
    /// Bind the execution records, shared turn state and the egress adapter.
    pub fn new(
        store: Arc<dyn ExecutionStore>,
        turns: Arc<dyn ExecutionTurns>,
        tools: Arc<dyn ConnectedAppTools>,
    ) -> Self {
        Self {
            store,
            turns,
            tools,
        }
    }

    /// Admit only a running execution of the session's current turn, so a
    /// finished program, a replayed one or another turn cannot spend it, and
    /// only a caller holding the account that execution was approved to act
    /// as: its credential names that account, and nobody else's may spend it.
    async fn admit(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
    ) -> Result<ConnectedAppUse, CodeModeError> {
        let session =
            super::reviews::session_id(access.entity().entity_type, &access.entity().entity_id)?;
        if access.acting_user_id() != Some(caller) {
            return Err(CodeModeError::Forbidden);
        }
        let record = self.store.get(session, execution).await?;
        let active = self.turns.active(session).await?;
        let (Some(acting_as), Some(turn)) = (record.acting_as, record.turn_id) else {
            return Err(CodeModeError::Forbidden);
        };
        if record.status != ExecutionStatus::Running || active != Some(turn) {
            return Err(CodeModeError::Forbidden);
        }

        let accounts = self.tools.accounts(session).await?;
        let user = acting_as
            .resolve(&accounts.owner, accounts.requester.as_ref())
            .map_err(|_| CodeModeError::Forbidden)?;
        if user != caller {
            return Err(CodeModeError::Forbidden);
        }
        Ok(ConnectedAppUse {
            session,
            acting_as,
            user: caller.clone(),
        })
    }

    /// The apps the session's agent was given.
    pub async fn apps(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
    ) -> Result<Vec<ConnectedApp>, CodeModeError> {
        let usage = self.admit(access, caller, execution).await?;
        self.tools.apps(&usage).await
    }

    /// The tools one of those apps serves.
    pub async fn tools(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
        app: ConnectedAppRef,
    ) -> Result<Vec<ConnectedTool>, CodeModeError> {
        let usage = self.admit(access, caller, execution).await?;
        self.tools.tools(&usage, &app).await
    }

    /// Call one of an app's tools.
    pub async fn call(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
        app: ConnectedAppRef,
        call: CallConnectedTool,
    ) -> Result<ConnectedToolResult, CodeModeError> {
        let usage = self.admit(access, caller, execution).await?;
        self.tools.call(&usage, &app, call).await
    }

    /// Search or inspect connectable apps.
    pub async fn discover(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
        request: DiscoveryRequest,
    ) -> Result<DiscoverConnectorsResponse, CodeModeError> {
        let usage = self.admit(access, caller, execution).await?;
        self.tools.discover(&usage, request).await
    }

    /// Add a custom MCP server to the account's connections.
    pub async fn add_server(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
        server: ConnectMcpServer,
    ) -> Result<ConnectMcpServerResponse, CodeModeError> {
        let usage = self.admit(access, caller, execution).await?;
        self.tools.add_server(&usage, server).await
    }

    /// Find tools across every app the agent was given by keywords matched
    /// against tool names and descriptions, ranked the way `SearchTools`
    /// ranks: by how many terms match. An app whose tools cannot be listed
    /// is reported, not fatal.
    pub async fn search_tools(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
        query: &str,
    ) -> Result<ConnectedToolSearch, CodeModeError> {
        let usage = self.admit(access, caller, execution).await?;
        let apps = self.tools.apps(&usage).await?;
        let listings = futures::future::join_all(apps.iter().map(|app| {
            let reference = ConnectedAppRef {
                kind: app.kind,
                key: app.key.clone(),
            };
            let usage = &usage;
            async move { self.tools.tools(usage, &reference).await }
        }))
        .await;

        let mut catalog = Vec::new();
        let mut unsearched = Vec::new();
        for (app, listing) in apps.into_iter().zip(listings) {
            match listing {
                Ok(tools) => catalog.extend(tools.into_iter().map(|tool| ConnectedToolMatch {
                    app: app.clone(),
                    tool,
                })),
                Err(error) => {
                    tracing::warn!(?error, app = %app.key, "could not list a connected app's tools");
                    unsearched.push(app);
                }
            }
        }
        let matches = ai_toolset::tool_search::rank(&catalog, query, |found| {
            (
                found.tool.name.as_str(),
                found.tool.description.as_deref().unwrap_or_default(),
            )
        })
        .into_iter()
        .take(MAX_TOOL_MATCHES)
        .cloned()
        .collect();
        Ok(ConnectedToolSearch {
            matches,
            unsearched,
        })
    }
}
