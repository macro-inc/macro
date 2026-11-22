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
use connectors::outbound::pipedream::domain::models::{ConnectionProvider, PipedreamConnection};
use connectors::outbound::pipedream::domain::ports::{
    ConnectionStore, ConnectorOverlays, MacroConnect,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use scheduled_action::domain::ports::DraftApps;
use tracing::Instrument as _;

use crate::external_session_requests::BrokerExternalSessionRequests;

/// Reuse live harness/session instances and the existing external-request adapter.
pub fn router<Bots, Harness, Sessions, Broker, Repo, Connections, Connect, Auth>(
    bots: Bots,
    harness: Harness,
    sessions: Sessions,
    external_requests: BrokerExternalSessionRequests<Broker, Repo>,
    apps: PipedreamConnectedApps<Connections, Connect>,
    authorization: MacroAuthorizationState<Auth>,
) -> Router
where
    Bots: BotDirectory,
    Harness: SessionOpener + AgentSessionNotificationRecipient + Clone,
    Sessions: AgentSessionService,
    Broker: MacroEventBroker,
    Repo: AgentSessionRepo,
    Connections: ConnectionStore,
    Connect: MacroConnect,
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
/// dispatch (`ConnectorBackends`) counts them: enabled rows; a Macro Connect
/// grant only where Connect is configured; and a Pipedream grant only for a
/// user not on Connect alone, whose Pipedream grants dispatch refuses.
pub struct PipedreamConnectedApps<Connections, Connect> {
    connections: Connections,
    /// The connector backends dispatch uses, where Macro Connect is
    /// configured: who is on Connect alone, and which apps it serves.
    connect: Option<Arc<Connect>>,
}

impl<Connections, Connect> PipedreamConnectedApps<Connections, Connect>
where
    Connections: ConnectionStore,
    Connect: MacroConnect,
{
    /// Count `connections` as `connect`, the connector backends, dispatches
    /// them; `None` where Macro Connect isn't configured.
    pub fn new(connections: Connections, connect: Option<Arc<Connect>>) -> Self {
        Self {
            connections,
            connect,
        }
    }

    /// Whether `user` is on Macro Connect alone. The rollout can wait on
    /// PostHog when its answer isn't cached, so the wait has its own span.
    async fn connect_only(&self, user: &MacroUserIdStr<'static>) -> bool {
        let Some(connect) = &self.connect else {
            return false;
        };
        let span = tracing::info_span!(
            "pipedream.connect_only",
            pipedream.connect_only = tracing::field::Empty
        );
        let connect_only = connect.connect_only(user).instrument(span.clone()).await;
        span.record("pipedream.connect_only", connect_only);
        connect_only
    }

    /// `user`'s connections a session can use.
    async fn usable(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Vec<PipedreamConnection>> {
        let connect_configured = self.connect.is_some();
        let connect_only = self.connect_only(user).await;
        Ok(self
            .connections
            .list(user)
            .await
            .map_err(|error| anyhow::anyhow!("could not list Pipedream connections: {error:?}"))?
            .into_iter()
            .filter(|connection| {
                connection.enabled
                    && match connection.provider {
                        ConnectionProvider::Connect => connect_configured,
                        ConnectionProvider::Pipedream => !connect_only,
                    }
            })
            .collect())
    }
}

impl<Connections, Connect> ConnectedApps for PipedreamConnectedApps<Connections, Connect>
where
    Connections: ConnectionStore,
    Connect: MacroConnect,
{
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
impl<Connections, Connect> DraftApps for PipedreamConnectedApps<Connections, Connect>
where
    Connections: ConnectionStore + ConnectorOverlays,
    Connect: MacroConnect,
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

    /// An owner on Macro Connect alone connects every app through Connect,
    /// so they can connect only the apps Connect serves, overlaid or not:
    /// they never see an overlay, and connecting writes a Connect grant.
    /// Anyone else connects through Pipedream, except an overlaid app, which
    /// connects to its vendor's own MCP server, never to a grant these
    /// connections count, so a routine can't require it.
    async fn requirable(
        &self,
        owner: &MacroUserIdStr<'static>,
        apps: Vec<AgentMcpServer>,
    ) -> anyhow::Result<Vec<AgentMcpServer>> {
        let connect_only = self.connect_only(owner).await;
        let served_by = self.connect.as_ref().filter(|_| connect_only);
        let mut requirable = Vec::with_capacity(apps.len());
        for app in apps {
            let kept = match served_by {
                Some(connect) => connect.app_for_slug(&app.app_slug).await?.is_some(),
                None => self.connections.overlay(&app.app_slug).await?.is_none(),
            };
            if kept {
                requirable.push(app);
            }
        }
        Ok(requirable)
    }
}

#[cfg(test)]
mod test;
