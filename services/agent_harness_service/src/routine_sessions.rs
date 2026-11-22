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
use connectors::domain::models::{ConnectorId, ConnectorKey};
use connectors::domain::service::{ConnectionManagementService, McpConnectionsService};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use scheduled_action::domain::ports::DraftApps;

use crate::external_session_requests::BrokerExternalSessionRequests;

/// Reuse live harness/session instances and the existing external-request adapter.
pub fn router<Bots, Harness, Sessions, Broker, Repo, S, Auth>(
    bots: Bots,
    harness: Harness,
    sessions: Sessions,
    external_requests: BrokerExternalSessionRequests<Broker, Repo>,
    apps: RoutineConnectedApps<S>,
    authorization: MacroAuthorizationState<Auth>,
) -> Router
where
    Bots: BotDirectory,
    Harness: SessionOpener + AgentSessionNotificationRecipient + Clone,
    Sessions: AgentSessionService,
    Broker: MacroEventBroker,
    Repo: AgentSessionRepo,
    S: McpConnectionsService + ConnectionManagementService,
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

/// The apps a user has connected, counted as chat and the egress proxy
/// count them: the connections the rules leave usable.
pub struct RoutineConnectedApps<S> {
    connectors: Arc<S>,
}

impl<S> Clone for RoutineConnectedApps<S> {
    fn clone(&self) -> Self {
        Self {
            connectors: Arc::clone(&self.connectors),
        }
    }
}

impl<S> RoutineConnectedApps<S>
where
    S: McpConnectionsService + ConnectionManagementService,
{
    /// Count `connectors`' answers.
    pub fn new(connectors: Arc<S>) -> Self {
        Self { connectors }
    }

    /// `user`'s usable app connections, by app and display name. Servers
    /// added by URL are not apps a routine can name.
    async fn usable(&self, user: &MacroUserIdStr<'static>) -> anyhow::Result<Vec<AgentMcpServer>> {
        let connections = self
            .connectors
            .connections(user)
            .await
            .map_err(|error| anyhow::anyhow!("could not list connections: {error:?}"))?;
        Ok(connections
            .handles()
            .filter_map(|handle| match handle.key() {
                ConnectorKey::App(app) => Some(AgentMcpServer {
                    app_slug: app.as_str().to_owned(),
                    server_name: handle.name().to_owned(),
                }),
                ConnectorKey::Server(_) => None,
            })
            .collect())
    }
}

impl<S> ConnectedApps for RoutineConnectedApps<S>
where
    S: McpConnectionsService + ConnectionManagementService,
{
    async fn connected_app_slugs(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Vec<String>> {
        Ok(self
            .usable(user)
            .await?
            .into_iter()
            .map(|app| app.app_slug)
            .collect())
    }
}

/// The same connections, as the apps a routine's draft may require.
#[async_trait::async_trait]
impl<S> DraftApps for RoutineConnectedApps<S>
where
    S: McpConnectionsService + ConnectionManagementService,
{
    async fn connected(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Vec<AgentMcpServer>> {
        self.usable(owner).await
    }

    /// The catalog apps among `apps`: once connected, through whichever
    /// source counts for the owner, each is an app the owner's routines
    /// count as connected.
    async fn requirable(
        &self,
        _owner: &MacroUserIdStr<'static>,
        apps: Vec<AgentMcpServer>,
    ) -> anyhow::Result<Vec<AgentMcpServer>> {
        let mut requirable = Vec::with_capacity(apps.len());
        for app in apps {
            let Ok(id) = ConnectorId::parse(&app.app_slug) else {
                continue;
            };
            let connectable = self
                .connectors
                .connectable(&id)
                .await
                .map_err(|error| anyhow::anyhow!("could not read the catalog: {error:?}"))?;
            if connectable {
                requirable.push(app);
            }
        }
        Ok(requirable)
    }
}

#[cfg(test)]
mod test;
