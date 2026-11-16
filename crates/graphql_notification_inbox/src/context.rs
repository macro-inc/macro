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
        ClearAction, ClearRun, InboxChange, InboxClearRequest, InboxDoneOutcome,
        InboxNotificationDoneOutcome, InboxPage, InboxQuery, InboxRowId, InboxRowTarget,
        InboxScope, StartedClear,
    },
    service::NotificationInboxService,
};
use soup::domain::models::SoupProjectionHydration;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument;
use uuid::Uuid;

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

    /// See [`NotificationInboxService::mark_notification_done`].
    fn mark_notification_done(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        row: InboxRowId,
        notification: Uuid,
    ) -> BoxFuture<'_, Result<InboxNotificationDoneOutcome<SoupProjectionHydration>, FeedError>>;

    /// See [`NotificationInboxService::start_clear`].
    fn start_clear(
        &self,
        viewer: FeedViewer,
        request: InboxClearRequest,
        id: Uuid,
    ) -> BoxFuture<'_, Result<StartedClear, FeedError>>;

    /// See [`NotificationInboxService::undo_clear`].
    fn undo_clear(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> BoxFuture<'_, Result<Option<StartedClear>, FeedError>>;

    /// See [`NotificationInboxService::run_clear`].
    fn run_clear(
        &self,
        viewer: FeedViewer,
        run: ClearRun,
        stop: CancellationToken,
    ) -> BoxFuture<'_, Result<ClearAction, FeedError>>;

    /// See [`NotificationInboxService::clear_action`].
    fn clear_action(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> BoxFuture<'_, Result<Option<ClearAction>, FeedError>>;

    /// See [`NotificationInboxService::running_clears`].
    fn running_clears(
        &self,
        viewer: FeedViewer,
    ) -> BoxFuture<'_, Result<Vec<ClearAction>, FeedError>>;

    /// See [`NotificationInboxService::claim_stalled_clears`].
    fn claim_stalled_clears(&self) -> BoxFuture<'_, Result<Vec<ClearRun>, FeedError>>;

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

    fn mark_notification_done(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        row: InboxRowId,
        notification: Uuid,
    ) -> BoxFuture<'_, Result<InboxNotificationDoneOutcome<SoupProjectionHydration>, FeedError>>
    {
        Box::pin(NotificationInboxService::mark_notification_done(
            self,
            viewer,
            scope,
            row,
            notification,
        ))
    }

    fn start_clear(
        &self,
        viewer: FeedViewer,
        request: InboxClearRequest,
        id: Uuid,
    ) -> BoxFuture<'_, Result<StartedClear, FeedError>> {
        Box::pin(NotificationInboxService::start_clear(
            self, viewer, request, id,
        ))
    }

    fn undo_clear(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> BoxFuture<'_, Result<Option<StartedClear>, FeedError>> {
        Box::pin(NotificationInboxService::undo_clear(self, viewer, id))
    }

    fn run_clear(
        &self,
        viewer: FeedViewer,
        run: ClearRun,
        stop: CancellationToken,
    ) -> BoxFuture<'_, Result<ClearAction, FeedError>> {
        Box::pin(NotificationInboxService::run_clear(self, viewer, run, stop))
    }

    fn clear_action(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> BoxFuture<'_, Result<Option<ClearAction>, FeedError>> {
        Box::pin(NotificationInboxService::clear_action(self, viewer, id))
    }

    fn running_clears(
        &self,
        viewer: FeedViewer,
    ) -> BoxFuture<'_, Result<Vec<ClearAction>, FeedError>> {
        Box::pin(NotificationInboxService::running_clears(self, viewer))
    }

    fn claim_stalled_clears(&self) -> BoxFuture<'_, Result<Vec<ClearRun>, FeedError>> {
        Box::pin(NotificationInboxService::claim_stalled_clears(self))
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

/// How long a request waits for the clear or undo it started before
/// replying with how far it has got. Most finish well inside it; the rest
/// carry on after the reply.
const CLEAR_REPLY_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

/// How often a server looks for clears whose worker stopped. With the
/// store's lease, a clear cut off by a crash or deploy resumes within about
/// a minute.
const CLEAR_RECOVERY_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15);

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
    /// The clears running in this process, so shutdown can wait for their
    /// open chunk.
    clear_tasks: TaskTracker,
    /// Fires at shutdown: a running clear stops after its open chunk and
    /// hands itself over.
    shutdown: CancellationToken,
}

impl NotificationInboxGraphqlContext {
    /// Bundle the inbox's capabilities for request data. The triggers and
    /// viewer lookup are shared with the other attention feeds. Clears run
    /// on `clear_tasks` and stop at `shutdown`.
    pub fn new(
        service: impl NotificationInboxGraphqlService,
        triggers: Arc<dyn FeedTriggers>,
        viewers: Arc<dyn FeedViewerResolver>,
        clear_tasks: TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            service: Arc::new(service),
            triggers,
            viewers,
            clear_tasks,
            shutdown,
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

    /// Run the work a clear or undo request started, apart from the request
    /// so a closed tab or dropped connection doesn't stop it, and wait a
    /// short while for it. Returns the clear as it then stands: finished, or
    /// still running in this process. A run that fails is not lost: the
    /// clear is claimed again from where it stopped.
    pub(crate) async fn run_started_clear(
        &self,
        viewer: FeedViewer,
        started: StartedClear,
    ) -> async_graphql::Result<ClearAction> {
        let StartedClear { action, run } = started;
        let Some(run) = run else {
            return Ok(action);
        };
        let service = self.service.clone();
        let stop = self.shutdown.clone();
        let runner = viewer.clone();
        let task = self
            .clear_tasks
            .spawn(async move { service.run_clear(runner, run, stop).await }.in_current_span());
        match tokio::time::timeout(CLEAR_REPLY_WAIT, task).await {
            Ok(Ok(Ok(finished))) => return Ok(finished),
            Ok(Ok(Err(error))) => {
                tracing::error!(error = ?error, clear = %action.id, "notification inbox clear run failed");
            }
            Ok(Err(error)) => {
                tracing::error!(error = ?error, clear = %action.id, "notification inbox clear task failed");
            }
            Err(_) => {}
        }
        Ok(self
            .service
            .clear_action(viewer, action.id)
            .await
            .map_err(to_graphql_error)?
            .unwrap_or(action))
    }

    /// Until shutdown, take over clears whose worker stopped (a crashed or
    /// redeployed server, on any instance) and run them to the end. The
    /// composition root spawns this once.
    pub async fn recover_clears(self) {
        let mut ticks = tokio::time::interval(CLEAR_RECOVERY_INTERVAL);
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                () = self.shutdown.cancelled() => break,
                _ = ticks.tick() => {}
            }
            let runs = match self.service.claim_stalled_clears().await {
                Ok(runs) => runs,
                Err(error) => {
                    tracing::warn!(error = ?error, "failed to claim stalled notification inbox clears");
                    continue;
                }
            };
            for run in runs {
                let viewer = match resolve_viewer(self.viewers.as_ref(), run.user().clone()).await {
                    Ok(viewer) => viewer,
                    Err(error) => {
                        // The lease runs out and the clear is claimed again.
                        tracing::warn!(error = ?error, "stalled clear viewer lookup failed");
                        continue;
                    }
                };
                let service = self.service.clone();
                let stop = self.shutdown.clone();
                let clear = run.action().id;
                self.clear_tasks.spawn(
                    async move {
                        if let Err(error) = service.run_clear(viewer, run, stop).await {
                            tracing::error!(error = ?error, "resumed notification inbox clear failed");
                        }
                    }
                    .instrument(tracing::info_span!(
                        "notification_inbox.resume_clear",
                        clear = %clear,
                    )),
                );
            }
        }
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
