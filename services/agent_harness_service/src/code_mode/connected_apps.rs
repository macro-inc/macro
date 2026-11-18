//! A code execution's connected apps, served through the session's egress.
//!
//! The program is handed the apps its agent was given (the same listing a
//! session's runtime is), and its calls go through the egress service's
//! credential resolution and actor transport, so no upstream credential
//! ever reaches the sandbox. The account a call spends is the one the
//! execution was approved for when its credential was minted, which
//! `ConnectedAppService` settles before calling here.

use agent_code_mode::domain::CodeModeError;
use agent_code_mode::domain::connected_apps::{
    CallConnectedTool, ConnectedApp, ConnectedAppKind, ConnectedAppRef, ConnectedAppTools,
    ConnectedAppUse, ConnectedTool, ConnectedToolResult, SessionAccounts,
};
use agent_egress::domain::error::EgressError;
use agent_egress::domain::model::{
    CustomMcpServerKey, McpDestination, McpServerSlug, SessionGrant,
};
use agent_egress::domain::service::SessionMcpExchange;
use agent_harness::outbound::egress::EgressProvisioner;
use agent_inmem::domain::tool_gate::{NativeToolGate, NativeToolVerdict};
use agent_session::domain::model::{AgentSessionId, TurnPrompter};
use agent_session::domain::ports::AgentSessionRepo;
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use mcp_client::domain::service::{AddServerError, AddedBy};
use mcp_client::inbound::toolset::{ConnectMcpServer, ConnectMcpServerResponse};
use pipedream_mcp::domain::ports::{ConnectionStore, ConnectorOverlays};
use pipedream_mcp::domain::service::discovery::DiscoveryRequest;
use pipedream_mcp::inbound::toolset::DiscoverConnectorsResponse;
use serde_json::{Value, json};
use std::sync::Arc;

/// Most `tools/list` pages read for one app.
const MAX_TOOL_PAGES: usize = 20;

pub struct SessionConnectedApps<Egress, Connections, Servers, Sessions> {
    pub egress: Arc<Egress>,
    pub provisioner: EgressProvisioner<Connections, Servers>,
    pub sessions: Sessions,
    /// The gate native tools pass, so discovery and adding a server wait for
    /// the owner exactly as `DiscoverConnectors` and `ConnectMcpServer` do.
    pub gate: Arc<dyn NativeToolGate>,
    pub connectors: ai_tools::ToolConnectorToolContext,
    pub mcp_servers: ai_tools::ToolMcpServerToolContext,
}

/// A use settled against the session: its grant, the account it spends and
/// the apps its agent was given.
struct Settled {
    grant: SessionGrant,
    user: MacroUserIdStr<'static>,
    apps: Vec<ConnectedApp>,
}

impl<Egress, Connections, Servers, Sessions>
    SessionConnectedApps<Egress, Connections, Servers, Sessions>
where
    Egress: SessionMcpExchange + 'static,
    Connections: ConnectionStore + ConnectorOverlays,
    Servers: McpServerStore,
    Sessions: AgentSessionRepo,
{
    async fn settle(&self, usage: &ConnectedAppUse) -> Result<Settled, CodeModeError> {
        let grant = self
            .egress
            .session_grant(usage.session)
            .await
            .map_err(egress_error)?;
        let user = usage.user.clone();

        let session = self
            .sessions
            .get(usage.session)
            .await
            .map_err(|_| CodeModeError::Forbidden)?;
        let (slugs, custom) = self
            .provisioner
            .advertised_all(&grant.owner, &session.mcp_servers)
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not list a session's connected apps");
                CodeModeError::Unavailable
            })?;
        let mut apps: Vec<ConnectedApp> = slugs
            .iter()
            .map(|slug| ConnectedApp {
                kind: ConnectedAppKind::App,
                key: slug.as_str().to_owned(),
                name: grant.display_name(slug),
            })
            .collect();
        apps.extend(custom.into_iter().map(|server| ConnectedApp {
            kind: ConnectedAppKind::Custom,
            key: server.key.as_str().to_owned(),
            name: server.name,
        }));

        Ok(Settled { grant, user, apps })
    }

    /// The destination for `app`, only when the agent was given it.
    fn destination(
        settled: &Settled,
        app: &ConnectedAppRef,
    ) -> Result<McpDestination, CodeModeError> {
        let given = settled
            .apps
            .iter()
            .any(|given| given.kind == app.kind && given.key == app.key);
        if !given {
            return Err(CodeModeError::NotFound);
        }

        let destination = match app.kind {
            ConnectedAppKind::App => McpServerSlug::parse(&app.key).map(McpDestination::Connected),
            ConnectedAppKind::Custom => {
                CustomMcpServerKey::parse(&app.key).map(McpDestination::Custom)
            }
        };
        destination.ok_or(CodeModeError::NotFound)
    }

    /// Pass `tool`'s call through the native tool gate under the execution's
    /// account choice: in a turn somebody else prompted, a call as the owner
    /// waits for their approval.
    async fn gate(
        &self,
        usage: &ConnectedAppUse,
        tool: &str,
        mut arguments: Value,
    ) -> Result<(), CodeModeError> {
        arguments[ai_toolset::actor::ACTING_AS] = json!(usage.acting_as);
        match self.gate.check(usage.session, tool, &arguments).await {
            NativeToolVerdict::Run => Ok(()),
            NativeToolVerdict::RunAs(user) if user == usage.user => Ok(()),
            NativeToolVerdict::RunAs(_) => Err(CodeModeError::Forbidden),
            NativeToolVerdict::Refuse(reason) => Err(CodeModeError::Invalid(reason)),
        }
    }
}

#[async_trait]
impl<Egress, Connections, Servers, Sessions> ConnectedAppTools
    for SessionConnectedApps<Egress, Connections, Servers, Sessions>
where
    Egress: SessionMcpExchange + 'static,
    Connections: ConnectionStore + ConnectorOverlays + 'static,
    Servers: McpServerStore + 'static,
    Sessions: AgentSessionRepo + 'static,
{
    async fn accounts(&self, session: AgentSessionId) -> Result<SessionAccounts, CodeModeError> {
        let grant = self
            .egress
            .session_grant(session)
            .await
            .map_err(egress_error)?;
        let requester = grant
            .prompter
            .as_ref()
            .and_then(TurnPrompter::acting_user)
            .cloned();
        Ok(SessionAccounts {
            owner: grant.owner,
            requester,
        })
    }

    async fn apps(&self, usage: &ConnectedAppUse) -> Result<Vec<ConnectedApp>, CodeModeError> {
        Ok(self.settle(usage).await?.apps)
    }

    async fn tools(
        &self,
        usage: &ConnectedAppUse,
        app: &ConnectedAppRef,
    ) -> Result<Vec<ConnectedTool>, CodeModeError> {
        let settled = self.settle(usage).await?;
        let destination = Self::destination(&settled, app)?;

        let mut tools = Vec::new();
        let mut cursor: Option<Value> = None;
        for page in 0..MAX_TOOL_PAGES {
            let params = match &cursor {
                Some(cursor) => json!({ "cursor": cursor }),
                None => json!({}),
            };
            let request =
                json!({"jsonrpc": "2.0", "id": page, "method": "tools/list", "params": params});
            let result = self
                .egress
                .exchange_as(&settled.grant, &settled.user, &destination, request)
                .await
                .map_err(egress_error)?;
            tools.extend(listed_tools(&result));

            cursor = result
                .get("nextCursor")
                .filter(|next| !next.is_null())
                .cloned();
            if cursor.is_none() {
                break;
            }
        }
        Ok(tools)
    }

    async fn call(
        &self,
        usage: &ConnectedAppUse,
        app: &ConnectedAppRef,
        call: CallConnectedTool,
    ) -> Result<ConnectedToolResult, CodeModeError> {
        let settled = self.settle(usage).await?;
        let destination = Self::destination(&settled, app)?;

        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": call.tool, "arguments": call.arguments},
        });
        let result = self
            .egress
            .exchange_as(&settled.grant, &settled.user, &destination, request)
            .await
            .map_err(egress_error)?;
        Ok(ConnectedToolResult {
            is_error: result["isError"].as_bool().unwrap_or(false),
            content: result["content"].as_array().cloned().unwrap_or_default(),
            structured_content: result
                .get("structuredContent")
                .filter(|content| !content.is_null())
                .cloned(),
        })
    }

    async fn discover(
        &self,
        usage: &ConnectedAppUse,
        request: DiscoveryRequest,
    ) -> Result<DiscoverConnectorsResponse, CodeModeError> {
        let arguments = json!({ "request": &request });
        self.gate(usage, "DiscoverConnectors", arguments).await?;
        let result = self
            .connectors
            .service
            .discover(&usage.user, &request)
            .await
            .map_err(|error| CodeModeError::Invalid(error.to_string()))?;
        Ok(DiscoverConnectorsResponse::from(result))
    }

    async fn add_server(
        &self,
        usage: &ConnectedAppUse,
        server: ConnectMcpServer,
    ) -> Result<ConnectMcpServerResponse, CodeModeError> {
        let arguments = json!({ "url": &server.url, "serverName": &server.server_name });
        self.gate(usage, "ConnectMcpServer", arguments).await?;
        let directory = self
            .mcp_servers
            .servers
            .as_ref()
            .ok_or(CodeModeError::Unavailable)?;
        let added = directory
            .add(
                usage.user.clone(),
                &server.url,
                &server.server_name,
                AddedBy::Agent,
            )
            .await
            .map_err(|error| match error {
                AddServerError::InvalidUrl(_)
                | AddServerError::NonPublicDestination(_)
                | AddServerError::EmptyName => CodeModeError::Invalid(error.to_string()),
                AddServerError::Store(error) => {
                    tracing::error!(?error, "could not save an MCP server");
                    CodeModeError::Unavailable
                }
            })?;
        Ok(ConnectMcpServerResponse::from(added))
    }
}

/// The tools a `tools/list` result names, skipping entries with no name.
fn listed_tools(result: &Value) -> Vec<ConnectedTool> {
    let Some(tools) = result["tools"].as_array() else {
        return Vec::new();
    };
    tools
        .iter()
        .filter_map(|tool| {
            Some(ConnectedTool {
                name: tool["name"].as_str()?.to_owned(),
                description: tool["description"].as_str().map(str::to_owned),
                input_schema: tool
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or_else(|| json!({"type": "object"})),
            })
        })
        .collect()
}

fn egress_error(error: EgressError) -> CodeModeError {
    match error {
        EgressError::Unauthenticated(_) | EgressError::SessionClosed => CodeModeError::Forbidden,
        EgressError::UnknownServer(_)
        | EgressError::UnknownCustomServer(_)
        | EgressError::Unroutable(_) => CodeModeError::NotFound,
        EgressError::Upstream(_) => {
            tracing::warn!(%error, "a connected app could not be reached");
            CodeModeError::ConnectedAppUnreachable
        }
        error => {
            tracing::error!(%error, "a connected app could not be reached");
            CodeModeError::Unavailable
        }
    }
}

#[cfg(test)]
mod test;
