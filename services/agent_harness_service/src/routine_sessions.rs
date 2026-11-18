//! Compose routine operations from the same session, harness, and persona capabilities.

use std::sync::Arc;

use agent_session::domain::ports::{
    AgentSessionNotificationRecipient, AgentSessionRepo, BotDirectory, SessionOpener,
};
use agent_session::domain::routines::{ConnectedApps, RoutineSessionsService};
use agent_session::domain::service::AgentSessionService;
use agent_session::inbound::routine_sessions::{RoutineSessionsState, routine_sessions_router};
use axum::Router;
use bots::domain::models::AgentMcpServer;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::{ConnectionProvider, PipedreamConnection};
use pipedream_mcp::domain::ports::{ConnectRollout, ConnectionStore, ConnectorOverlays};
use scheduled_action::domain::ports::DraftApps;

use crate::external_session_requests::BrokerExternalSessionRequests;

/// Reuse live harness/session instances and the existing external-request adapter.
pub fn router<Bots, Harness, Sessions, Broker, Repo, Connections, Auth>(
    bots: Bots,
    harness: Harness,
    sessions: Sessions,
    external_requests: BrokerExternalSessionRequests<Broker, Repo>,
    apps: PipedreamConnectedApps<Connections>,
    authorization: MacroAuthorizationState<Auth>,
) -> Router
where
    Bots: BotDirectory,
    Harness: SessionOpener + AgentSessionNotificationRecipient + Clone,
    Sessions: AgentSessionService,
    Broker: MacroEventBroker,
    Repo: AgentSessionRepo,
    Connections: ConnectionStore,
    Auth: MacroAuthorizationService,
{
    let service = RoutineSessionsService::new(
        bots,
        harness.clone(),
        external_requests,
        sessions,
        harness,
        apps,
    );
    routine_sessions_router(RoutineSessionsState::new(Arc::new(service), authorization))
}

/// A user's Pipedream connections, counted as connected the way connector
/// dispatch counts them: enabled rows, and only Macro Connect grants for a
/// user on Connect alone, whose Pipedream grants dispatch refuses.
pub struct PipedreamConnectedApps<Connections> {
    connections: Connections,
    /// Whether a user is on Macro Connect alone; `None` where Macro Connect
    /// isn't configured or no rollout puts anyone on it.
    connect_only: Option<ConnectRollout>,
}

impl<Connections: ConnectionStore> PipedreamConnectedApps<Connections> {
    /// Count `connections`, putting the users `connect_only` answers `true`
    /// for on their Macro Connect grants alone.
    pub fn new(connections: Connections, connect_only: Option<ConnectRollout>) -> Self {
        Self {
            connections,
            connect_only,
        }
    }

    /// `user`'s connections a session can use.
    async fn usable(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Vec<PipedreamConnection>> {
        let connect_only = match &self.connect_only {
            Some(rollout) => rollout(user.clone()).await,
            None => false,
        };
        Ok(self
            .connections
            .list(user)
            .await
            .map_err(|error| anyhow::anyhow!("could not list Pipedream connections: {error:?}"))?
            .into_iter()
            .filter(|connection| {
                connection.enabled
                    && (!connect_only || connection.provider == ConnectionProvider::Connect)
            })
            .collect())
    }
}

impl<Connections: ConnectionStore> ConnectedApps for PipedreamConnectedApps<Connections> {
    async fn connected_app_slugs(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Vec<String>> {
        Ok(self
            .usable(user)
            .await?
            .into_iter()
            .map(|connection| connection.app_slug)
            .collect())
    }
}

/// The same connections, as the apps a routine's draft may require.
#[async_trait::async_trait]
impl<Connections> DraftApps for PipedreamConnectedApps<Connections>
where
    Connections: ConnectionStore + ConnectorOverlays,
{
    async fn connected(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Vec<AgentMcpServer>> {
        Ok(self
            .usable(owner)
            .await?
            .into_iter()
            .map(|connection| AgentMcpServer {
                app_slug: connection.app_slug,
                server_name: connection.server_name,
            })
            .collect())
    }

    /// An overlaid app connects to its own MCP server, never to a row these
    /// connections count, so a routine can't require it.
    async fn requirable(&self, apps: Vec<AgentMcpServer>) -> anyhow::Result<Vec<AgentMcpServer>> {
        let mut requirable = Vec::with_capacity(apps.len());
        for app in apps {
            if self.connections.overlay(&app.app_slug).await?.is_none() {
                requirable.push(app);
            }
        }
        Ok(requirable)
    }
}

#[cfg(test)]
mod test;
