//! The notification inbox use cases: list a page of groups with their rows,
//! recompute known groups, mark rows done or seen, and undo a done. Paging,
//! refill, notification loading and acknowledgment are the shared feed
//! layer's; this service cuts what it loads into rows.

use std::collections::{HashMap, HashSet};

use attention_feed::domain::{
    acknowledge::Acknowledger,
    models::{
        Acknowledgment, CandidateKeying, CandidateRequest, DoneReceipt, FeedError, FeedKey,
        FeedPosition, FeedRevision, FeedViewer, Loaded, MailFacts, unseen_among,
    },
    ports::{CandidateSource, FeedMail, FeedNotifications, FeedSignals},
    reader::FeedReader,
};
use chrono::{DateTime, Utc};
use model_entity::EntityType;
use rootcause::Report;
use uuid::Uuid;

use super::{
    models::{
        ClearProgress, ClearStep, InboxChange, InboxClearOutcome, InboxClearRequest,
        InboxDoneOutcome, InboxEntry, InboxNotificationDoneOutcome, InboxPage, InboxQuery,
        InboxRow, InboxRowId, InboxRowTarget, InboxRowType, InboxScope,
    },
    policy,
    ports::ClearLog,
    rows,
};

#[cfg(test)]
mod test;

/// The notification inbox's use cases.
pub trait NotificationInboxService: Send + Sync + 'static {
    /// The hydrated entity each group carries.
    type Entity: Send + Sync + 'static;

    /// One page of the viewer's inbox, newest group first.
    fn page(
        &self,
        viewer: FeedViewer,
        query: InboxQuery,
    ) -> impl Future<Output = Result<InboxPage<Self::Entity>, FeedError>> + Send;

    /// The current rows of known groups in one inbox: each key comes back
    /// upserted with its placement, or removed.
    fn recompute(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        groups: Vec<FeedKey>,
    ) -> impl Future<Output = Result<Vec<InboxChange<Self::Entity>>, FeedError>> + Send;

    /// Acknowledge what the caller observed on each row: the notifications
    /// it shows and hides, up to its revision, move to done, and an email
    /// row's thread is archived. Underlying tasks, requests and pull
    /// requests are not completed.
    fn mark_done(
        &self,
        viewer: FeedViewer,
        targets: Vec<InboxRowTarget>,
    ) -> impl Future<Output = Result<InboxDoneOutcome, FeedError>> + Send;

    /// Acknowledge one notification a row shows, with the hidden ones it speaks
    /// for, then recompute the row's group for the caller's inbox. The row's
    /// last shown notification completes the row, as `mark_done` does. A
    /// notification the row no longer shows has nothing left to acknowledge.
    fn mark_notification_done(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        row: InboxRowId,
        notification: Uuid,
    ) -> impl Future<Output = Result<InboxNotificationDoneOutcome<Self::Entity>, FeedError>> + Send;

    /// Mark done every row of the inbox the request matches, their shown and
    /// hidden notifications, reading the inbox in batches until it ends. Each
    /// batch is recorded in clear `id`'s log, so `undo_clear` reverses the
    /// whole clear, and an undo stops a clear still running. Clearing doesn't
    /// archive email threads: it clears notifications, and the mail stays
    /// where it is.
    fn clear(
        &self,
        viewer: FeedViewer,
        request: InboxClearRequest,
        id: Uuid,
    ) -> impl Future<Output = Result<InboxClearOutcome, FeedError>> + Send;

    /// How far clear `id` has got; `None` for an unknown or expired clear.
    fn clear_progress(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<ClearProgress>, FeedError>> + Send;

    /// Stop clear `id` if it is still running, reverse everything it changed,
    /// then recompute its groups for the caller's inbox. A clear undone
    /// already, or expired, changes nothing.
    fn undo_clear(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        id: Uuid,
    ) -> impl Future<Output = Result<Vec<InboxChange<Self::Entity>>, FeedError>> + Send;

    /// Reverse exactly what one mark-done changed, then recompute its groups
    /// for the caller's inbox.
    fn undo_done(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        receipt: DoneReceipt,
    ) -> impl Future<Output = Result<Vec<InboxChange<Self::Entity>>, FeedError>> + Send;

    /// Mark the rows' shown and hidden notifications seen, then recompute
    /// their groups for the caller's inbox.
    fn mark_seen(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        rows: Vec<InboxRowId>,
    ) -> impl Future<Output = Result<Vec<InboxChange<Self::Entity>>, FeedError>> + Send;
}

/// The notification inbox service over the shared feed layer.
pub struct NotificationInboxServiceImpl<S, N, M, G, L> {
    reader: FeedReader<S, N>,
    acknowledger: Acknowledger<N, M, G>,
    clear_log: L,
}

impl<S, N, M, G, L> NotificationInboxServiceImpl<S, N, M, G, L>
where
    S: CandidateSource,
    N: FeedNotifications + Clone,
    M: FeedMail,
    G: FeedSignals,
    L: ClearLog,
{
    /// Create the service from its ports; the reader and the acknowledger
    /// share the notification port.
    pub fn new(source: S, notifications: N, mail: M, signals: G, clear_log: L) -> Self {
        Self {
            reader: FeedReader::new(source, notifications.clone()),
            acknowledger: Acknowledger::new(notifications, mail, signals),
            clear_log,
        }
    }
}

/// The candidate request for the viewer's inbox. The reader sets the limit,
/// cursor and key restriction per read.
fn candidate_request(viewer: &FeedViewer) -> CandidateRequest {
    CandidateRequest {
        viewer: viewer.clone(),
        keying: CandidateKeying::FiledEntity,
        own_work: false,
        types: policy::CANDIDATE_TYPES.to_vec(),
        filter: policy::inbox_filter(),
        limit: 0,
        after: None,
        only: None,
    }
}

/// A group cut into every one of its rows.
struct Group<E> {
    key: FeedKey,
    entity: E,
    sort_at: DateTime<Utc>,
    mail: Option<MailFacts>,
    rows: Vec<InboxRow>,
}

impl<E> Group<E> {
    /// Cut a loaded candidate into rows. An email thread outside the inbox
    /// has none: archive is mail's own done.
    fn cut(loaded: Loaded<E>, viewer: &FeedViewer, now: DateTime<Utc>) -> Self {
        let Loaded {
            candidate,
            notifications,
        } = loaded;
        let key = FeedKey::new(candidate.key);
        let mail = candidate.facts.mail;
        let rows = if mail.is_some_and(|mail| !mail.inbox_visible) {
            Vec::new()
        } else {
            rows::rows(&key, &notifications, mail, &viewer.user, now)
        };
        Self {
            key,
            entity: candidate.entity,
            sort_at: candidate.sort_at,
            mail,
            rows,
        }
    }

    /// The group's entry in `scope`; `None` when no row matches.
    fn entry(self, scope: &InboxScope) -> Option<InboxEntry<E>> {
        let rows: Vec<InboxRow> = self
            .rows
            .into_iter()
            .filter(|row| scope.admits(row))
            .collect();
        (!rows.is_empty()).then_some(InboxEntry {
            group: self.key,
            entity: self.entity,
            sort_at: self.sort_at,
            rows,
        })
    }

    fn row(&self, id: &InboxRowId) -> Option<&InboxRow> {
        self.rows.iter().find(|row| row.id == *id)
    }

    /// What a done of `row` up to `observed` acknowledges. Archiving takes the
    /// whole thread out of the inbox, so a done from before newer mail arrived
    /// leaves it there.
    fn row_acknowledgment(&self, row: &InboxRow, observed: FeedRevision) -> Acknowledgment {
        let notification_ids = observed.acknowledged(row.all_notifications());
        let observed_all = notification_ids.len() == row.all_notifications().count();
        Acknowledgment {
            key: self.key.clone(),
            unseen_ids: unseen_among(row.all_notifications(), &notification_ids),
            notification_ids,
            archive_thread: (observed_all
                && row.row_type == InboxRowType::Email
                && self.mail.is_some_and(|mail| mail.inbox_visible))
            .then(|| email_thread_id(&self.key))
            .flatten(),
        }
    }
}

/// Groups one clear batch reads.
const CLEAR_BATCH_GROUPS: u16 = 100;
/// Batches one clear reads at most: far beyond any inbox, a stop for a
/// source that never ends.
const MAX_CLEAR_BATCHES: usize = 1_000;
/// How long an undo waits for a running clear to stop.
const CLEAR_STOP_WAIT: std::time::Duration = std::time::Duration::from_secs(10);
/// How often an undo checks whether the clear has stopped.
const CLEAR_STOP_POLL: std::time::Duration = std::time::Duration::from_millis(100);

/// What one batch of a clear did.
struct ClearBatch {
    rows: usize,
    receipt: DoneReceipt,
    next: Option<FeedPosition>,
}

/// One receipt for everything a clear's batches changed.
fn merge_receipts(receipts: Vec<DoneReceipt>) -> DoneReceipt {
    let mut merged = DoneReceipt::default();
    for receipt in receipts {
        merged.keys.extend(receipt.keys);
        merged.notification_ids.extend(receipt.notification_ids);
        merged.unseen_ids.extend(receipt.unseen_ids);
        merged.archived_threads.extend(receipt.archived_threads);
    }
    merged.keys = unique(merged.keys);
    merged
}

/// What clearing one group acknowledges.
struct ClearedGroup {
    key: FeedKey,
    sort_at: DateTime<Utc>,
    rows: usize,
    notification_ids: Vec<Uuid>,
    unseen_ids: Vec<Uuid>,
}

impl InboxClearRequest {
    /// Whether the request clears `row`.
    fn clears(&self, row: &InboxRow) -> bool {
        self.scope.admits(row)
            && self
                .since
                .is_none_or(|since| row.latest().created_at >= since)
    }
}

/// Values deduplicated in first-seen order.
fn unique<T: Clone + Eq + std::hash::Hash>(values: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

/// An email thread group's thread id.
fn email_thread_id(key: &FeedKey) -> Option<Uuid> {
    (key.entity().entity_type == EntityType::EmailThread)
        .then(|| Uuid::parse_str(key.entity().entity_id.as_ref()).ok())
        .flatten()
}

impl<S, N, M, G, L> NotificationInboxServiceImpl<S, N, M, G, L>
where
    S: CandidateSource,
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
    L: ClearLog,
{
    /// Every row of each current group in `keys`, keyed by group.
    async fn current(
        &self,
        viewer: &FeedViewer,
        keys: &[FeedKey],
    ) -> Result<HashMap<FeedKey, Group<S::Entity>>, Report> {
        let now = Utc::now();
        Ok(self
            .reader
            .current(candidate_request(viewer), keys)
            .await?
            .into_iter()
            .map(|(key, loaded)| (key, Group::cut(loaded, viewer, now)))
            .collect())
    }

    /// Clear batch after batch, recording each, until the inbox ends, the
    /// clear passes `since`, or an undo asks it to stop.
    async fn clear_batches(
        &self,
        viewer: &FeedViewer,
        request: &InboxClearRequest,
        id: Uuid,
    ) -> Result<InboxClearOutcome, FeedError> {
        let mut after = None;
        let mut rows = 0;
        for batch_number in 1..=MAX_CLEAR_BATCHES {
            let batch = self.clear_batch(viewer, request, after).await?;
            rows += batch.rows;
            let step = self
                .clear_log
                .record(&viewer.user, id, batch.rows, &batch.receipt)
                .await?;
            tracing::Span::current().record("batches", batch_number);
            match step {
                ClearStep::Continue => {}
                ClearStep::Stop => {
                    return Ok(InboxClearOutcome {
                        rows,
                        cancelled: true,
                    });
                }
                // The log is gone, so no undo will cover this batch;
                // reverse it here.
                ClearStep::Orphaned => {
                    self.acknowledger.undo(viewer, &batch.receipt).await?;
                    return Ok(InboxClearOutcome {
                        rows: rows - batch.rows,
                        cancelled: true,
                    });
                }
            }
            match batch.next {
                Some(next) => after = Some(next),
                None => break,
            }
        }
        Ok(InboxClearOutcome {
            rows,
            cancelled: false,
        })
    }

    #[tracing::instrument(
        name = "notification_inbox.clear_batch",
        skip_all,
        fields(
            user = %viewer.user,
            rows = tracing::field::Empty,
            notifications = tracing::field::Empty,
            has_next = tracing::field::Empty,
        ),
        err
    )]
    async fn clear_batch(
        &self,
        viewer: &FeedViewer,
        request: &InboxClearRequest,
        after: Option<FeedPosition>,
    ) -> Result<ClearBatch, FeedError> {
        let candidates = CandidateRequest {
            limit: CLEAR_BATCH_GROUPS,
            after,
            ..candidate_request(viewer)
        };
        let now = Utc::now();
        // Every group read comes back, cleared or not, so the batch knows how
        // far it walked.
        let page = self
            .reader
            .page(candidates, |loaded| {
                let group = Group::cut(loaded, viewer, now);
                let cleared: Vec<&InboxRow> = group
                    .rows
                    .iter()
                    .filter(|row| request.clears(row))
                    .collect();
                let notification_ids: Vec<Uuid> = cleared
                    .iter()
                    .flat_map(|row| row.all_notifications().map(|n| n.notification_id))
                    .collect();
                Some(ClearedGroup {
                    rows: cleared.len(),
                    unseen_ids: unseen_among(
                        cleared.iter().flat_map(|row| row.all_notifications()),
                        &notification_ids,
                    ),
                    notification_ids,
                    key: group.key,
                    sort_at: group.sort_at,
                })
            })
            .await?;
        // Groups are newest first, so one older than `since` ends the clear.
        let past_since = request.since.is_some_and(|since| {
            page.entries
                .last()
                .is_some_and(|group| group.sort_at < since)
        });
        let next = if past_since { None } else { page.next };
        let rows = page.entries.iter().map(|group| group.rows).sum();
        let acknowledgments: Vec<Acknowledgment> = page
            .entries
            .into_iter()
            .filter(|group| !group.notification_ids.is_empty())
            .map(|group| Acknowledgment {
                key: group.key,
                notification_ids: group.notification_ids,
                unseen_ids: group.unseen_ids,
                archive_thread: None,
            })
            .collect();
        let receipt = if acknowledgments.is_empty() {
            DoneReceipt::default()
        } else {
            self.acknowledger
                .acknowledge(viewer, acknowledgments)
                .await?
        };
        let span = tracing::Span::current();
        span.record("rows", rows);
        span.record("notifications", receipt.notification_ids.len());
        span.record("has_next", next.is_some());
        Ok(ClearBatch {
            rows,
            receipt,
            next,
        })
    }

    async fn recompute_groups(
        &self,
        viewer: &FeedViewer,
        scope: &InboxScope,
        keys: Vec<FeedKey>,
    ) -> Result<Vec<InboxChange<S::Entity>>, Report> {
        let keys = unique(keys);
        if keys.is_empty() {
            return Ok(Vec::new());
        }
        let mut current = self.current(viewer, &keys).await?;
        Ok(keys
            .into_iter()
            .map(
                |key| match current.remove(&key).and_then(|group| group.entry(scope)) {
                    Some(entry) => InboxChange::Upserted(entry),
                    None => InboxChange::Removed(key),
                },
            )
            .collect())
    }
}

impl<S, N, M, G, L> NotificationInboxService for NotificationInboxServiceImpl<S, N, M, G, L>
where
    S: CandidateSource,
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
    L: ClearLog,
{
    type Entity = S::Entity;

    #[tracing::instrument(
        name = "notification_inbox.page",
        skip_all,
        fields(
            user = %viewer.user,
            limit = query.limit,
            row_types = query.scope.row_types.len(),
            unread_only = query.scope.unread_only,
            groups = tracing::field::Empty,
            rows = tracing::field::Empty,
        ),
        err
    )]
    async fn page(
        &self,
        viewer: FeedViewer,
        query: InboxQuery,
    ) -> Result<InboxPage<Self::Entity>, FeedError> {
        let request = CandidateRequest {
            limit: query.limit,
            after: query.after,
            ..candidate_request(&viewer)
        };
        let now = Utc::now();
        let page = self
            .reader
            .page(request, |loaded| {
                Group::cut(loaded, &viewer, now).entry(&query.scope)
            })
            .await?;
        let span = tracing::Span::current();
        span.record("groups", page.entries.len());
        span.record(
            "rows",
            page.entries
                .iter()
                .map(|entry| entry.rows.len())
                .sum::<usize>(),
        );
        Ok(InboxPage {
            entries: page.entries,
            next: page.next,
        })
    }

    #[tracing::instrument(
        name = "notification_inbox.recompute",
        skip_all,
        fields(user = %viewer.user, groups = groups.len()),
        err
    )]
    async fn recompute(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        groups: Vec<FeedKey>,
    ) -> Result<Vec<InboxChange<Self::Entity>>, FeedError> {
        Ok(self.recompute_groups(&viewer, &scope, groups).await?)
    }

    #[tracing::instrument(
        name = "notification_inbox.mark_done",
        skip_all,
        fields(
            user = %viewer.user,
            rows = targets.len(),
            row_types = tracing::field::Empty,
            notifications = tracing::field::Empty,
        ),
        err
    )]
    async fn mark_done(
        &self,
        viewer: FeedViewer,
        targets: Vec<InboxRowTarget>,
    ) -> Result<InboxDoneOutcome, FeedError> {
        let mut planned = HashSet::new();
        let targets: Vec<InboxRowTarget> = targets
            .into_iter()
            .filter(|target| planned.insert(target.id.clone()))
            .collect();
        if targets.is_empty() {
            return Ok(InboxDoneOutcome {
                rows: Vec::new(),
                receipt: DoneReceipt::default(),
            });
        }
        // Rows are found among every row of their group, whatever inbox the
        // caller was looking at, so done acknowledges what they observed.
        let groups = unique(targets.iter().map(|target| target.id.group.clone()));
        let current = self.current(&viewer, &groups).await?;

        let rows: Vec<InboxRowId> = targets.iter().map(|target| target.id.clone()).collect();
        let mut found = Vec::new();
        let mut acknowledgments = Vec::with_capacity(targets.len());
        for target in targets {
            // A row already gone, or outside the viewer's groups, has nothing
            // left to acknowledge but is still reported done.
            let current_row = current
                .get(&target.id.group)
                .and_then(|group| Some((group, group.row(&target.id)?)));
            let acknowledgment = match current_row {
                Some((group, row)) => {
                    found.push(row.row_type);
                    group.row_acknowledgment(row, target.revision.unwrap_or_else(|| row.revision()))
                }
                None => Acknowledgment {
                    key: target.id.group,
                    notification_ids: Vec::new(),
                    unseen_ids: Vec::new(),
                    archive_thread: None,
                },
            };
            acknowledgments.push(acknowledgment);
        }
        let span = tracing::Span::current();
        span.record("row_types", tracing::field::debug(unique(found)));

        let receipt = self
            .acknowledger
            .acknowledge(&viewer, acknowledgments)
            .await?;
        span.record("notifications", receipt.notification_ids.len());
        Ok(InboxDoneOutcome { rows, receipt })
    }

    #[tracing::instrument(
        name = "notification_inbox.mark_notification_done",
        skip_all,
        fields(
            user = %viewer.user,
            row = %row.id(),
            notification = %notification,
            acknowledged = tracing::field::Empty,
        ),
        err
    )]
    async fn mark_notification_done(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        row: InboxRowId,
        notification: Uuid,
    ) -> Result<InboxNotificationDoneOutcome<Self::Entity>, FeedError> {
        let groups = vec![row.group.clone()];
        let current = self.current(&viewer, &groups).await?;
        let acknowledgment = match current.get(&row.group).and_then(|group| {
            let found = group.row(&row)?;
            Some((group, found))
        }) {
            Some((group, found)) if found.shows_only(notification) => {
                group.row_acknowledgment(found, found.revision())
            }
            Some((group, found)) => {
                let notification_ids = rows::speaks_for(found, notification, &viewer.user);
                Acknowledgment {
                    key: group.key.clone(),
                    unseen_ids: unseen_among(found.all_notifications(), &notification_ids),
                    notification_ids,
                    archive_thread: None,
                }
            }
            None => Acknowledgment {
                key: row.group.clone(),
                notification_ids: Vec::new(),
                unseen_ids: Vec::new(),
                archive_thread: None,
            },
        };
        let receipt = self
            .acknowledger
            .acknowledge(&viewer, vec![acknowledgment])
            .await?;
        tracing::Span::current().record("acknowledged", receipt.notification_ids.len());
        let changes = self.recompute_groups(&viewer, &scope, groups).await?;
        Ok(InboxNotificationDoneOutcome { changes, receipt })
    }

    #[tracing::instrument(
        name = "notification_inbox.clear",
        skip_all,
        fields(
            user = %viewer.user,
            clear = %id,
            row_types = request.scope.row_types.len(),
            unread_only = request.scope.unread_only,
            since = request.since.is_some(),
            batches = tracing::field::Empty,
            rows = tracing::field::Empty,
            cancelled = tracing::field::Empty,
        ),
        err
    )]
    async fn clear(
        &self,
        viewer: FeedViewer,
        request: InboxClearRequest,
        id: Uuid,
    ) -> Result<InboxClearOutcome, FeedError> {
        self.clear_log.begin(&viewer.user, id).await?;
        let result = self.clear_batches(&viewer, &request, id).await;
        // Close the log however the clear ended, so an undo waiting on it
        // reverses what it did.
        if let Err(error) = self.clear_log.finish(&viewer.user, id).await {
            tracing::warn!(error = ?error, "failed to close the clear log");
        }
        let outcome = result?;
        let span = tracing::Span::current();
        span.record("rows", outcome.rows);
        span.record("cancelled", outcome.cancelled);
        Ok(outcome)
    }

    async fn clear_progress(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> Result<Option<ClearProgress>, FeedError> {
        Ok(self.clear_log.progress(&viewer.user, id).await?)
    }

    #[tracing::instrument(
        name = "notification_inbox.undo_clear",
        skip_all,
        fields(
            user = %viewer.user,
            clear = %id,
            waited_ms = tracing::field::Empty,
            notifications = tracing::field::Empty,
        ),
        err
    )]
    async fn undo_clear(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        id: Uuid,
    ) -> Result<Vec<InboxChange<Self::Entity>>, FeedError> {
        self.clear_log.cancel(&viewer.user, id).await?;
        // A clear still running stops after its current batch; wait for it so
        // the log holds everything it changed. Past the wait, keep the log and
        // ask the caller to undo again.
        let started = tokio::time::Instant::now();
        let mut finished = false;
        while started.elapsed() < CLEAR_STOP_WAIT {
            match self.clear_log.progress(&viewer.user, id).await? {
                Some(progress) if !progress.finished => {
                    tokio::time::sleep(CLEAR_STOP_POLL).await;
                }
                _ => {
                    finished = true;
                    break;
                }
            }
        }
        let span = tracing::Span::current();
        span.record("waited_ms", started.elapsed().as_millis() as u64);
        if !finished {
            return Err(FeedError::Busy(
                "the clear is still stopping; undo it again",
            ));
        }
        let receipt = merge_receipts(self.clear_log.receipts(&viewer.user, id).await?);
        span.record("notifications", receipt.notification_ids.len());
        let changes = if receipt.keys.is_empty() {
            Vec::new()
        } else {
            // A failed reversal keeps the log, so the undo can be retried.
            self.undo_done(viewer.clone(), scope, receipt).await?
        };
        self.clear_log.remove(&viewer.user, id).await?;
        Ok(changes)
    }

    #[tracing::instrument(
        name = "notification_inbox.undo",
        skip_all,
        fields(user = %viewer.user, groups = receipt.keys.len()),
        err
    )]
    async fn undo_done(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        receipt: DoneReceipt,
    ) -> Result<Vec<InboxChange<Self::Entity>>, FeedError> {
        let groups = self.acknowledger.undo(&viewer, &receipt).await?;
        Ok(self.recompute_groups(&viewer, &scope, groups).await?)
    }

    #[tracing::instrument(
        name = "notification_inbox.mark_seen",
        skip_all,
        fields(user = %viewer.user, rows = rows.len(), notifications = tracing::field::Empty),
        err
    )]
    async fn mark_seen(
        &self,
        viewer: FeedViewer,
        scope: InboxScope,
        rows: Vec<InboxRowId>,
    ) -> Result<Vec<InboxChange<Self::Entity>>, FeedError> {
        let rows = unique(rows);
        let groups = unique(rows.iter().map(|row| row.group.clone()));
        if groups.is_empty() {
            return Ok(Vec::new());
        }
        let current = self.current(&viewer, &groups).await?;
        let notification_ids: Vec<Uuid> = rows
            .iter()
            .filter_map(|id| current.get(&id.group)?.row(id))
            .flat_map(|row| row.all_notifications().map(|n| n.notification_id))
            .collect();
        let changed = self
            .acknowledger
            .mark_seen(&viewer, &groups, notification_ids)
            .await?;
        tracing::Span::current().record("notifications", changed.len());
        Ok(self.recompute_groups(&viewer, &scope, groups).await?)
    }
}
