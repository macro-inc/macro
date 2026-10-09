use std::sync::Arc;

use entity_access::{
    domain::{
        models::{EntityAccessReceipt, MemberTeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::user_team_receipt,
};
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use soup::domain::models::SoupProjectionHydration;
use work_feed::domain::{
    models::{
        WorkFeedChange, WorkFeedDoneOutcome, WorkFeedDoneReceipt, WorkFeedDoneTarget,
        WorkFeedError, WorkFeedItemKey, WorkFeedPage, WorkFeedQuery, WorkFeedScope, WorkFeedViewer,
    },
    ports::WorkFeedTriggers,
    service::WorkFeedService,
};

/// The work feed use cases over Soup-hydrated items, object-safe so request
/// data can carry them without a schema type parameter.
pub trait WorkFeedGraphqlService: Send + Sync + 'static {
    /// See [`WorkFeedService::page`].
    fn page(
        &self,
        viewer: WorkFeedViewer,
        query: WorkFeedQuery,
    ) -> BoxFuture<'_, Result<WorkFeedPage<SoupProjectionHydration>, WorkFeedError>>;

    /// See [`WorkFeedService::recompute`].
    fn recompute(
        &self,
        viewer: WorkFeedViewer,
        scope: WorkFeedScope,
        keys: Vec<WorkFeedItemKey>,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, WorkFeedError>>;

    /// See [`WorkFeedService::mark_done`].
    fn mark_done(
        &self,
        viewer: WorkFeedViewer,
        targets: Vec<WorkFeedDoneTarget>,
    ) -> BoxFuture<'_, Result<WorkFeedDoneOutcome, WorkFeedError>>;

    /// See [`WorkFeedService::undo_done`].
    fn undo_done(
        &self,
        viewer: WorkFeedViewer,
        scope: WorkFeedScope,
        receipt: WorkFeedDoneReceipt,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, WorkFeedError>>;
}

impl<T> WorkFeedGraphqlService for T
where
    T: WorkFeedService<Entity = SoupProjectionHydration>,
{
    fn page(
        &self,
        viewer: WorkFeedViewer,
        query: WorkFeedQuery,
    ) -> BoxFuture<'_, Result<WorkFeedPage<SoupProjectionHydration>, WorkFeedError>> {
        Box::pin(WorkFeedService::page(self, viewer, query))
    }

    fn recompute(
        &self,
        viewer: WorkFeedViewer,
        scope: WorkFeedScope,
        keys: Vec<WorkFeedItemKey>,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, WorkFeedError>> {
        Box::pin(WorkFeedService::recompute(self, viewer, scope, keys))
    }

    fn mark_done(
        &self,
        viewer: WorkFeedViewer,
        targets: Vec<WorkFeedDoneTarget>,
    ) -> BoxFuture<'_, Result<WorkFeedDoneOutcome, WorkFeedError>> {
        Box::pin(WorkFeedService::mark_done(self, viewer, targets))
    }

    fn undo_done(
        &self,
        viewer: WorkFeedViewer,
        scope: WorkFeedScope,
        receipt: WorkFeedDoneReceipt,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, WorkFeedError>> {
        Box::pin(WorkFeedService::undo_done(self, viewer, scope, receipt))
    }
}

/// Resolves the team access a work feed request is evaluated with. Requests
/// and subscriptions alike only carry the authenticated user, so the team
/// receipt is minted from it at the entity access boundary.
pub trait WorkFeedViewerResolver: Send + Sync + 'static {
    /// The user's qualifying team receipt, if any.
    fn team(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, rootcause::Report>>;
}

/// Mints viewer team receipts through the entity access service.
pub struct EntityAccessWorkFeedViewers<S>(pub Arc<S>);

impl<S> WorkFeedViewerResolver for EntityAccessWorkFeedViewers<S>
where
    S: EntityAccessService,
{
    fn team(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, rootcause::Report>> {
        Box::pin(async move {
            user_team_receipt::<MemberTeamRole, S>(self.0.as_ref(), user)
                .await
                .map_err(|error| rootcause::report!("failed to resolve team access: {error}"))
        })
    }
}

/// Request data for the work feed fields, inserted by the composition root
/// for HTTP requests and subscription connections alike.
#[derive(Clone)]
pub struct WorkFeedGraphqlContext {
    /// The feed's use cases.
    pub(crate) service: Arc<dyn WorkFeedGraphqlService>,
    /// Realtime changes that may affect a viewer's items.
    pub(crate) triggers: Arc<dyn WorkFeedTriggers>,
    /// Team access lookup for viewers.
    pub(crate) viewers: Arc<dyn WorkFeedViewerResolver>,
}

impl WorkFeedGraphqlContext {
    /// Bundle the work feed's capabilities for request data.
    pub fn new(
        service: impl WorkFeedGraphqlService,
        triggers: impl WorkFeedTriggers,
        viewers: impl WorkFeedViewerResolver,
    ) -> Self {
        Self {
            service: Arc::new(service),
            triggers: Arc::new(triggers),
            viewers: Arc::new(viewers),
        }
    }

    /// The viewer a request for `user` is evaluated as.
    pub(crate) async fn viewer(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> async_graphql::Result<WorkFeedViewer> {
        let team = self.viewers.team(user.clone()).await.map_err(|error| {
            tracing::error!(error = ?error, "work feed viewer lookup failed");
            async_graphql::Error::new("the work feed is unavailable")
        })?;
        Ok(WorkFeedViewer { user, team })
    }
}

/// Map a service error to a client-facing GraphQL error; dependency details
/// are logged, never exposed.
pub(crate) fn to_graphql_error(error: WorkFeedError) -> async_graphql::Error {
    match error {
        WorkFeedError::InvalidInput(message) => async_graphql::Error::new(message),
        WorkFeedError::Unavailable(report) => {
            tracing::error!(error = ?report, "work feed request failed");
            async_graphql::Error::new("the work feed is unavailable")
        }
    }
}
