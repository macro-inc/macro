//! Compose routine operations from the same session, harness, and persona capabilities.

use std::sync::Arc;

use agent_session::domain::ports::{
    AgentSessionNotificationRecipient, AgentSessionRepo, BotDirectory, SessionOpener,
};
use agent_session::domain::routines::{ConnectedApps, RoutineSessionsService};
use agent_session::domain::service::AgentSessionService;
use agent_session::inbound::routine_sessions::{RoutineSessionsState, routine_sessions_router};
use axum::Router;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::ConnectionStore;

use crate::external_session_requests::BrokerExternalSessionRequests;
use crate::routine_tools::CatalogRoutineTools;

/// Reuse live harness/session instances, the existing external-request
/// adapter, and the in-process tool catalog for routine tool steps.
#[expect(
    clippy::too_many_arguments,
    reason = "the composition root hands over each live capability the service composes"
)]
pub fn router<Bots, Harness, Sessions, Broker, Repo, Connections, Auth>(
    bots: Bots,
    harness: Harness,
    sessions: Sessions,
    broker: Broker,
    repo: Repo,
    connections: Connections,
    tools: CatalogRoutineTools,
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
        BrokerExternalSessionRequests::new(broker, repo),
        sessions,
        harness,
        PipedreamConnectedApps(connections),
    )
    .with_tools(tools);
    routine_sessions_router(RoutineSessionsState::new(Arc::new(service), authorization))
}

/// A user's Pipedream connections, counted as connected the way the egress
/// proxy counts them: enabled rows only.
pub struct PipedreamConnectedApps<Connections>(pub Connections);

impl<Connections: ConnectionStore> ConnectedApps for PipedreamConnectedApps<Connections> {
    async fn connected_app_slugs(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Vec<String>> {
        Ok(self
            .0
            .list(user)
            .await
            .map_err(|error| anyhow::anyhow!("could not list Pipedream connections: {error:?}"))?
            .into_iter()
            .filter(|connection| connection.enabled)
            .map(|connection| connection.app_slug)
            .collect())
    }
}
