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
use notification_inbox::domain::{
    models::{
        InboxChange, InboxDoneOutcome, InboxPage, InboxQuery, InboxRowId, InboxRowTarget,
        InboxScope,
    },
    service::NotificationInboxService,
};
use soup::domain::models::SoupProjectionHydration;

/// Soup-hydrated inbox changes.
type Changes = Vec<InboxChange<SoupProjectionHydration>>;

/// The inbox use cases over Soup-hydrated groups, object-safe so request
/// data can carry them without a schema type parameter.
pub trait NotificationInboxGraphqlService: Send + Sync + 'static {
    /// See [`NotificationInboxService::page`].
    fn page(
        &self,
        viewer: FeedViewer,
        query: InboxQuery,
    ) -> BoxFuture<'_, Result<InboxPage<SoupProjectionHydration>, FeedError>>;

    /// See [`NotificationInboxService::recompute`].
    fn recompute(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        groups: Vec<FeedKey>,
    ) -> BoxFuture<'_, Result<Changes, FeedError>>;

    /// See [`NotificationInboxService::mark_done`].
    fn mark_done(
        &self,
        viewer: FeedViewer,
        targets: Vec<InboxRowTarget>,
    ) -> BoxFuture<'_, Result<InboxDoneOutcome, FeedError>>;

    /// See [`NotificationInboxService::undo_done`].
    fn undo_done(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        receipt: DoneReceipt,
    ) -> BoxFuture<'_, Result<Changes, FeedError>>;

    /// See [`NotificationInboxService::mark_seen`].
    fn mark_seen(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        rows: Vec<InboxRowId>,
    ) -> BoxFuture<'_, Result<Changes, FeedError>>;
}

impl<T> NotificationInboxGraphqlService for T
where
    T: NotificationInboxService<Entity = SoupProjectionHydration>,
{
    fn page(
        &self,
        viewer: FeedViewer,
        query: InboxQuery,
    ) -> BoxFuture<'_, Result<InboxPage<SoupProjectionHydration>, FeedError>> {
        Box::pin(NotificationInboxService::page(self, viewer, query))
    }

    fn recompute(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        groups: Vec<FeedKey>,
    ) -> BoxFuture<'_, Result<Changes, FeedError>> {
        Box::pin(NotificationInboxService::recompute(
            self, viewer, scope, groups,
        ))
    }

    fn mark_done(
        &self,
        viewer: FeedViewer,
        targets: Vec<InboxRowTarget>,
    ) -> BoxFuture<'_, Result<InboxDoneOutcome, FeedError>> {
        Box::pin(NotificationInboxService::mark_done(self, viewer, targets))
    }

    fn undo_done(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        receipt: DoneReceipt,
    ) -> BoxFuture<'_, Result<Changes, FeedError>> {
        Box::pin(NotificationInboxService::undo_done(
            self, viewer, scope, receipt,
        ))
    }

    fn mark_seen(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        rows: Vec<InboxRowId>,
    ) -> BoxFuture<'_, Result<Changes, FeedError>> {
        Box::pin(NotificationInboxService::mark_seen(
            self, viewer, scope, rows,
        ))
    }
}

/// Request data for the inbox fields, inserted by the composition root for
/// HTTP requests and subscription connections alike.
#[derive(Clone)]
pub struct NotificationInboxGraphqlContext {
    /// The inbox's use cases.
    pub(crate) service: Arc<dyn NotificationInboxGraphqlService>,
    /// Realtime changes that may affect a viewer's groups.
    pub(crate) triggers: Arc<dyn FeedTriggers>,
    /// Team access lookup for viewers.
    pub(crate) viewers: Arc<dyn FeedViewerResolver>,
}

impl NotificationInboxGraphqlContext {
    /// Bundle the inbox's capabilities for request data. The triggers and
    /// viewer lookup are shared with the other attention feeds.
    pub fn new(
        service: impl NotificationInboxGraphqlService,
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
                tracing::error!(error = ?error, "notification inbox viewer lookup failed");
                async_graphql::Error::new("the notification inbox is unavailable")
            })
    }
}

/// Map a service error to a client-facing GraphQL error; dependency details
/// are logged, never exposed.
pub(crate) fn to_graphql_error(error: FeedError) -> async_graphql::Error {
    match error {
        FeedError::InvalidInput(message) => async_graphql::Error::new(message),
        FeedError::Unavailable(report) => {
            tracing::error!(error = ?report, "notification inbox request failed");
            async_graphql::Error::new("the notification inbox is unavailable")
        }
    }
}
