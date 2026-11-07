use std::sync::Arc;

use agent_session::domain::{
    error::AgentSessionError,
    model::AgentSessionId,
    work_registration::{WorkRegistration, WorkRegistrationChanges, WorkRegistrations},
};
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use soup_realtime_core::{models::Patch, ports::SoupRealtimeSubscriptionService};
use tokio::sync::mpsc::Receiver;

/// Reads of work registrations, object-safe so request data can carry them
/// without a schema type parameter.
pub trait RegisteredWorkGraphqlService: Send + Sync + 'static {
    /// See [`WorkRegistrations::visible_registrations`].
    fn visible_registrations<'a>(
        &'a self,
        viewer: &'a MacroUserIdStr<'static>,
        accounts: &'a [MacroUserIdStr<'static>],
    ) -> BoxFuture<'a, Result<Vec<WorkRegistration>, AgentSessionError>>;

    /// See [`WorkRegistrations::changes`].
    fn changes<'a>(
        &'a self,
        viewer: &'a MacroUserIdStr<'static>,
        accounts: &'a [MacroUserIdStr<'static>],
        sessions: &'a [AgentSessionId],
        ended_after: DateTime<Utc>,
    ) -> BoxFuture<'a, Result<WorkRegistrationChanges, AgentSessionError>>;
}

impl<T: WorkRegistrations> RegisteredWorkGraphqlService for T {
    fn visible_registrations<'a>(
        &'a self,
        viewer: &'a MacroUserIdStr<'static>,
        accounts: &'a [MacroUserIdStr<'static>],
    ) -> BoxFuture<'a, Result<Vec<WorkRegistration>, AgentSessionError>> {
        Box::pin(WorkRegistrations::visible_registrations(
            self, viewer, accounts,
        ))
    }

    fn changes<'a>(
        &'a self,
        viewer: &'a MacroUserIdStr<'static>,
        accounts: &'a [MacroUserIdStr<'static>],
        sessions: &'a [AgentSessionId],
        ended_after: DateTime<Utc>,
    ) -> BoxFuture<'a, Result<WorkRegistrationChanges, AgentSessionError>> {
        Box::pin(WorkRegistrations::changes(
            self,
            viewer,
            accounts,
            sessions,
            ended_after,
        ))
    }
}

/// Request data for the registered work fields, inserted by the composition
/// root for HTTP requests and subscription connections alike.
#[derive(Clone)]
pub struct RegisteredWorkGraphqlContext {
    /// Reads of registrations.
    pub(crate) service: Arc<dyn RegisteredWorkGraphqlService>,
    /// The Soup patches addressed to a viewer, which announce session changes.
    soup: Arc<dyn SoupRealtimeSubscriptionService>,
}

impl RegisteredWorkGraphqlContext {
    /// Bundle the registered work capabilities for request data.
    pub fn new(
        service: impl RegisteredWorkGraphqlService,
        soup: Arc<dyn SoupRealtimeSubscriptionService>,
    ) -> Self {
        Self {
            service: Arc::new(service),
            soup,
        }
    }

    /// The Soup patches addressed to `viewer` from now on.
    pub(crate) fn patches(
        &self,
        viewer: MacroUserIdStr<'static>,
    ) -> Receiver<Patch<Entity<'static>>> {
        self.soup.subscribe(viewer)
    }
}

/// Map a service error to a client-facing GraphQL error; details are logged,
/// never exposed.
pub(crate) fn to_graphql_error(error: AgentSessionError) -> async_graphql::Error {
    tracing::error!(error = ?error, "registered work request failed");
    async_graphql::Error::new("registered work is unavailable")
}
