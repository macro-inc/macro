use std::sync::Arc;

use attention_feed::{
    domain::{
        models::{DoneReceipt, FeedError, FeedKey, FeedViewer},
        ports::FeedTriggers,
    },
    inbound::viewers::{FeedViewerResolver, resolve_viewer},
};
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use soup::domain::models::SoupProjectionHydration;
use work_feed::domain::{
    models::{
        WorkFeedChange, WorkFeedDoneOutcome, WorkFeedDoneTarget, WorkFeedPage, WorkFeedQuery,
        WorkFeedScope,
    },
    service::WorkFeedService,
};

/// The work feed use cases over Soup-hydrated items, object-safe so request
/// data can carry them without a schema type parameter.
pub trait WorkFeedGraphqlService: Send + Sync + 'static {
    /// See [`WorkFeedService::page`].
    fn page(
        &self,
        viewer: FeedViewer,
        query: WorkFeedQuery,
    ) -> BoxFuture<'_, Result<WorkFeedPage<SoupProjectionHydration>, FeedError>>;

    /// See [`WorkFeedService::recompute`].
    fn recompute(
        &self,
        viewer: FeedViewer,
        scope: WorkFeedScope,
        keys: Vec<FeedKey>,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, FeedError>>;

    /// See [`WorkFeedService::mark_done`].
    fn mark_done(
        &self,
        viewer: FeedViewer,
        targets: Vec<WorkFeedDoneTarget>,
    ) -> BoxFuture<'_, Result<WorkFeedDoneOutcome, FeedError>>;

    /// See [`WorkFeedService::undo_done`].
    fn undo_done(
        &self,
        viewer: FeedViewer,
        scope: WorkFeedScope,
        receipt: DoneReceipt,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, FeedError>>;
}

impl<T> WorkFeedGraphqlService for T
where
    T: WorkFeedService<Entity = SoupProjectionHydration>,
{
    fn page(
        &self,
        viewer: FeedViewer,
        query: WorkFeedQuery,
    ) -> BoxFuture<'_, Result<WorkFeedPage<SoupProjectionHydration>, FeedError>> {
        Box::pin(WorkFeedService::page(self, viewer, query))
    }

    fn recompute(
        &self,
        viewer: FeedViewer,
        scope: WorkFeedScope,
        keys: Vec<FeedKey>,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, FeedError>> {
        Box::pin(WorkFeedService::recompute(self, viewer, scope, keys))
    }

    fn mark_done(
        &self,
        viewer: FeedViewer,
        targets: Vec<WorkFeedDoneTarget>,
    ) -> BoxFuture<'_, Result<WorkFeedDoneOutcome, FeedError>> {
        Box::pin(WorkFeedService::mark_done(self, viewer, targets))
    }

    fn undo_done(
        &self,
        viewer: FeedViewer,
        scope: WorkFeedScope,
        receipt: DoneReceipt,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, FeedError>> {
        Box::pin(WorkFeedService::undo_done(self, viewer, scope, receipt))
    }
}

/// Request data for the work feed fields, inserted by the composition root
/// for HTTP requests and subscription connections alike.
#[derive(Clone)]
pub struct WorkFeedGraphqlContext {
    /// The feed's use cases.
    pub(crate) service: Arc<dyn WorkFeedGraphqlService>,
    /// Realtime changes that may affect a viewer's items.
    pub(crate) triggers: Arc<dyn FeedTriggers>,
    /// Team access lookup for viewers.
    pub(crate) viewers: Arc<dyn FeedViewerResolver>,
}

impl WorkFeedGraphqlContext {
    /// Bundle the work feed's capabilities for request data. The triggers
    /// and viewer lookup are shared with the other attention feeds.
    pub fn new(
        service: impl WorkFeedGraphqlService,
        triggers: Arc<dyn FeedTriggers>,
        viewers: Arc<dyn FeedViewerResolver>,
    ) -> Self {
        Self {
            service: Arc::new(service),
            triggers,
            viewers,
        }
    }

    /// The viewer a request for `user` is evaluated as.
    pub(crate) async fn viewer(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> async_graphql::Result<FeedViewer> {
        resolve_viewer(self.viewers.as_ref(), user)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, "work feed viewer lookup failed");
                async_graphql::Error::new("the work feed is unavailable")
            })
    }
}

/// Map a service error to a client-facing GraphQL error; dependency details
/// are logged, never exposed.
pub(crate) fn to_graphql_error(error: FeedError) -> async_graphql::Error {
    match error {
        FeedError::InvalidInput(message) => async_graphql::Error::new(message),
        FeedError::Unavailable(report) => {
            tracing::error!(error = ?report, "work feed request failed");
            async_graphql::Error::new("the work feed is unavailable")
        }
    }
}
