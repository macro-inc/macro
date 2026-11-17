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
use notification::domain::bulk_action::{
    ApplyChunk, BulkAction, BulkActionItem, BulkActionLease, BulkActionStatus, BulkActionStore,
    ChunkOutcome, CreatedBulkAction, NewBulkAction, UndoRequested,
};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{
    models::{
        ClearAction, ClearCursor, ClearPass, ClearRun, InboxChange, InboxClearRequest,
        InboxDoneOutcome, InboxEntry, InboxNotificationDoneOutcome, InboxPage, InboxQuery,
        InboxRow, InboxRowId, InboxRowTarget, InboxRowType, InboxScope, StartedClear,
    },
    policy,
    ports::ClearUpdates,
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

    /// Start clearing the inbox: store clear `id` with what it covers, frozen
    /// now, and hand back the work to run. Every row the request matches is
    /// then marked done, its shown and hidden notifications, in chunks; only
    /// notifications that had arrived when the clear started are cleared.
    /// Email threads are not archived: a clear clears notifications, and the
    /// mail stays where it is. Starting the same id again starts nothing.
    fn start_clear(
        &self,
        viewer: FeedViewer,
        request: InboxClearRequest,
        id: Uuid,
    ) -> impl Future<Output = Result<StartedClear, FeedError>> + Send;

    /// Start undoing clear `id`, stopping it first if it is still running,
    /// and hand back the work to run: every notification the clear changed
    /// returns to the state it had, unless the viewer changed it since.
    /// `None` for a clear the viewer doesn't have.
    fn undo_clear(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<StartedClear>, FeedError>> + Send;

    /// Run a clear's remaining chunks, forward or as an undo, until it
    /// finishes, another worker or an undo takes it over, or `stop` fires.
    /// Returns the clear as this run left it. A run that fails or is dropped
    /// loses nothing: the clear is claimed again from where it stopped.
    fn run_clear(
        &self,
        viewer: FeedViewer,
        run: ClearRun,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<ClearAction, FeedError>> + Send;

    /// The viewer's clear `id`; `None` once it is forgotten.
    fn clear_action(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<ClearAction>, FeedError>> + Send;

    /// The viewer's clears and undos still running, oldest first.
    fn running_clears(
        &self,
        viewer: FeedViewer,
    ) -> impl Future<Output = Result<Vec<ClearAction>, FeedError>> + Send;

    /// Take over clears, of any user, whose worker stopped, and delete the
    /// records of clears finished long ago. Each run returned is the
    /// caller's to finish.
    fn claim_stalled_clears(&self)
    -> impl Future<Output = Result<Vec<ClearRun>, FeedError>> + Send;

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
pub struct NotificationInboxServiceImpl<S, N, M, G, A, U> {
    reader: FeedReader<S, N>,
    acknowledger: Acknowledger<N, M, G>,
    clears: A,
    clear_updates: U,
}

impl<S, N, M, G, A, U> NotificationInboxServiceImpl<S, N, M, G, A, U>
where
    S: CandidateSource,
    N: FeedNotifications + Clone,
    M: FeedMail,
    G: FeedSignals,
    A: BulkActionStore,
    U: ClearUpdates,
{
    /// Create the service from its ports; the reader and the acknowledger
    /// share the notification port. Clears are stored in `clears`, and
    /// `clear_updates` tells the viewer's sessions about them.
    pub fn new(
        source: S,
        notifications: N,
        mail: M,
        signals: G,
        clears: A,
        clear_updates: U,
    ) -> Self {
        Self {
            reader: FeedReader::new(source, notifications.clone()),
            acknowledger: Acknowledger::new(notifications, mail, signals),
            clears,
            clear_updates,
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

/// Groups one chunk of a clear reads. A chunk is one short transaction, so
/// a server stopping mid-clear loses at most this much work.
const CLEAR_CHUNK_GROUPS: u16 = 100;
/// Ledger rows one chunk of an undo reopens.
const UNDO_CHUNK_NOTIFICATIONS: u16 = 500;
/// How often a running clear tells the viewer's sessions how far it has got.
const CLEAR_UPDATE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);
/// Stalled clears one claim takes over.
const STALLED_CLEAR_CLAIMS: u16 = 10;
/// How long a finished clear is kept, so it can still be undone.
const CLEAR_RETENTION: chrono::Duration = chrono::Duration::hours(24);
/// Finished clears one claim deletes.
const CLEAR_PURGE_BATCH: u16 = 100;

/// What a clear covers, as its stored action keeps it.
#[derive(Debug, Serialize, Deserialize)]
struct StoredClearScope {
    row_types: Vec<InboxRowType>,
    unread_only: bool,
    since: Option<DateTime<Utc>>,
}

impl ClearAction {
    /// Read a stored action as a clear.
    fn from_stored(action: BulkAction) -> Result<Self, Report> {
        let scope: StoredClearScope = serde_json::from_value(action.scope)
            .map_err(|error| rootcause::report!("unreadable clear scope: {error}"))?;
        Ok(Self {
            id: action.id,
            status: action.status,
            scope: InboxScope {
                row_types: scope.row_types,
                unread_only: scope.unread_only,
            },
            since: scope.since,
            as_of: action.as_of,
            rows: action.units,
            notifications: action.applied,
            restored: action.restored,
            revision: action.revision,
        })
    }
}

impl ClearRun {
    /// The run that continues a stored action from its cursor.
    fn from_stored(action: BulkAction, lease: BulkActionLease) -> Result<Self, Report> {
        let cursor = match action.cursor.clone() {
            Some(cursor) => serde_json::from_value(cursor)
                .map_err(|error| rootcause::report!("unreadable clear cursor: {error}"))?,
            None => ClearCursor::default(),
        };
        Ok(Self {
            lease,
            action: ClearAction::from_stored(action)?,
            cursor,
        })
    }
}

/// What clearing one group marks done.
struct ClearedGroup {
    key: FeedKey,
    sort_at: DateTime<Utc>,
    rows: usize,
    notification_ids: Vec<Uuid>,
}

/// Where a clear goes after a chunk that read up to `last` and has more
/// groups from `next`: the next cursor, or `None` when the clear is over.
///
/// The walk reads the inbox newest first. A group that gets new activity
/// while the walk runs moves ahead of it and would be skipped, so a walk of
/// more than one chunk ends with a second look at the groups whose newest
/// notification is newer than the clear.
fn next_cursor(
    cursor: &ClearCursor,
    action: &ClearAction,
    last: Option<DateTime<Utc>>,
    next: Option<FeedPosition>,
) -> Option<ClearCursor> {
    let after = |pass, next: FeedPosition| ClearCursor {
        pass,
        after: Some(next.encode()),
    };
    match cursor.pass {
        ClearPass::Walk => {
            // Groups are newest first, so one older than `since` ends the walk.
            let past_since = action
                .since
                .is_some_and(|since| last.is_some_and(|last| last < since));
            match next {
                Some(next) if !past_since => Some(after(ClearPass::Walk, next)),
                // One chunk read everything; nothing could move ahead of it.
                _ if cursor.after.is_none() => None,
                _ => Some(ClearCursor {
                    pass: ClearPass::Recheck,
                    after: None,
                }),
            }
        }
        ClearPass::Recheck => {
            // Groups with nothing newer than the clear were the walk's.
            let past_clear = last.is_none_or(|last| last <= action.as_of);
            match next {
                Some(next) if !past_clear => Some(after(ClearPass::Recheck, next)),
                _ => None,
            }
        }
    }
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

impl<S, N, M, G, A, U> NotificationInboxServiceImpl<S, N, M, G, A, U>
where
    S: CandidateSource,
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
    A: BulkActionStore,
    U: ClearUpdates,
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

    /// Apply one chunk of a clear: read the next groups, mark their
    /// matching rows' notifications done and move the cursor, in one
    /// transaction. `None` when the clear is no longer this run's.
    #[tracing::instrument(
        name = "notification_inbox.clear_chunk",
        skip_all,
        fields(
            user = %viewer.user,
            clear = %action.id,
            pass = ?cursor.pass,
            rows = tracing::field::Empty,
            notifications = tracing::field::Empty,
            finished = tracing::field::Empty,
        ),
        err
    )]
    async fn apply_clear_chunk(
        &self,
        viewer: &FeedViewer,
        lease: &BulkActionLease,
        action: &ClearAction,
        cursor: &ClearCursor,
    ) -> Result<Option<(ClearAction, ClearCursor)>, FeedError> {
        let after = cursor
            .after
            .as_deref()
            .map(FeedPosition::decode)
            .transpose()
            .map_err(|_| rootcause::report!("unreadable clear cursor position"))?;
        let candidates = CandidateRequest {
            limit: CLEAR_CHUNK_GROUPS,
            after,
            ..candidate_request(viewer)
        };
        let request = InboxClearRequest {
            scope: action.scope.clone(),
            since: action.since,
        };
        let as_of = action.as_of;
        let now = Utc::now();
        // Every group read comes back, cleared or not, so the chunk knows how
        // far it walked.
        let page = self
            .reader
            .page(candidates, |mut loaded| {
                // The clear covers the inbox as it was when it started.
                loaded
                    .notifications
                    .retain(|notification| notification.created_at <= as_of);
                let group = Group::cut(loaded, viewer, now);
                let cleared: Vec<&InboxRow> = group
                    .rows
                    .iter()
                    .filter(|row| request.clears(row))
                    .collect();
                Some(ClearedGroup {
                    rows: cleared.len(),
                    notification_ids: cleared
                        .iter()
                        .flat_map(|row| row.all_notifications().map(|n| n.notification_id))
                        .collect(),
                    key: group.key,
                    sort_at: group.sort_at,
                })
            })
            .await?;
        let last = page.entries.last().map(|group| group.sort_at);
        let next = next_cursor(cursor, action, last, page.next);
        let rows: usize = page.entries.iter().map(|group| group.rows).sum();
        let items: Vec<BulkActionItem> = page
            .entries
            .iter()
            .flat_map(|group| {
                let group_key = group.key.id();
                group.notification_ids.iter().map(move |id| BulkActionItem {
                    notification_id: *id,
                    group_key: group_key.clone(),
                })
            })
            .collect();
        let chunk = ApplyChunk {
            items,
            units: u32::try_from(rows).unwrap_or(u32::MAX),
            cursor: Some(
                serde_json::to_value(next.clone().unwrap_or_default())
                    .map_err(|error| rootcause::report!("unwritable clear cursor: {error}"))?,
            ),
            finished: next.is_none(),
        };
        let applied = match self.clears.apply_chunk(lease, chunk).await? {
            ChunkOutcome::Committed(applied) => applied,
            ChunkOutcome::Stopped => return Ok(None),
        };
        let changed: HashSet<Uuid> = applied.changed.iter().copied().collect();
        let keys: Vec<FeedKey> = page
            .entries
            .into_iter()
            .filter(|group| group.notification_ids.iter().any(|id| changed.contains(id)))
            .map(|group| group.key)
            .collect();
        self.acknowledger.signal(&viewer.user, &keys).await;
        let span = tracing::Span::current();
        span.record("rows", rows);
        span.record("notifications", changed.len());
        span.record("finished", next.is_none());
        Ok(Some((
            ClearAction::from_stored(applied.action)?,
            next.unwrap_or_default(),
        )))
    }

    /// Undo one chunk of a clear: reopen the next ledger rows to the state
    /// each notification had. `None` when the undo is no longer this run's.
    #[tracing::instrument(
        name = "notification_inbox.undo_clear_chunk",
        skip_all,
        fields(user = %viewer.user, clear = %lease.action_id, groups = tracing::field::Empty),
        err
    )]
    async fn undo_clear_chunk(
        &self,
        viewer: &FeedViewer,
        lease: &BulkActionLease,
    ) -> Result<Option<ClearAction>, FeedError> {
        let reverted = match self
            .clears
            .revert_chunk(lease, UNDO_CHUNK_NOTIFICATIONS)
            .await?
        {
            ChunkOutcome::Committed(reverted) => reverted,
            ChunkOutcome::Stopped => return Ok(None),
        };
        let keys: Vec<FeedKey> = reverted
            .groups
            .iter()
            .filter_map(|group| FeedKey::parse(group).ok())
            .collect();
        tracing::Span::current().record("groups", keys.len());
        self.acknowledger.signal(&viewer.user, &keys).await;
        Ok(Some(ClearAction::from_stored(reverted.action)?))
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

impl<S, N, M, G, A, U> NotificationInboxService for NotificationInboxServiceImpl<S, N, M, G, A, U>
where
    S: CandidateSource,
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
    A: BulkActionStore,
    U: ClearUpdates,
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
        name = "notification_inbox.start_clear",
        skip_all,
        fields(
            user = %viewer.user,
            clear = %id,
            row_types = request.scope.row_types.len(),
            unread_only = request.scope.unread_only,
            since = request.since.is_some(),
            created = tracing::field::Empty,
        ),
        err
    )]
    async fn start_clear(
        &self,
        viewer: FeedViewer,
        request: InboxClearRequest,
        id: Uuid,
    ) -> Result<StartedClear, FeedError> {
        // An inbox scope with no kinds lists every kind; a clear must name
        // the kinds it takes, so hiding every kind can't clear everything.
        if request.scope.row_types.is_empty() {
            return Err(FeedError::InvalidInput(
                "a clear names the row kinds it clears",
            ));
        }
        let scope = serde_json::to_value(StoredClearScope {
            row_types: unique(request.scope.row_types),
            unread_only: request.scope.unread_only,
            since: request.since,
        })
        .map_err(|error| rootcause::report!("unwritable clear scope: {error}"))?;
        let created = self
            .clears
            .create(NewBulkAction {
                id,
                user_id: viewer.user.clone(),
                scope,
            })
            .await?;
        let span = tracing::Span::current();
        match created {
            CreatedBulkAction::Created(action, lease) => {
                span.record("created", true);
                let run = ClearRun::from_stored(action, lease)?;
                self.clear_updates.updated(&viewer.user, &run.action).await;
                Ok(StartedClear {
                    action: run.action.clone(),
                    run: Some(run),
                })
            }
            CreatedBulkAction::Existing(action) => {
                span.record("created", false);
                Ok(StartedClear {
                    action: ClearAction::from_stored(action)?,
                    run: None,
                })
            }
            CreatedBulkAction::Conflict => Err(FeedError::InvalidInput(
                "this clear id was used for another clear",
            )),
        }
    }

    #[tracing::instrument(
        name = "notification_inbox.undo_clear",
        skip_all,
        fields(user = %viewer.user, clear = %id, started = tracing::field::Empty),
        err
    )]
    async fn undo_clear(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> Result<Option<StartedClear>, FeedError> {
        let span = tracing::Span::current();
        Ok(match self.clears.request_undo(&viewer.user, id).await? {
            None => None,
            Some(UndoRequested::Started(action, lease)) => {
                span.record("started", true);
                let run = ClearRun::from_stored(action, lease)?;
                self.clear_updates.updated(&viewer.user, &run.action).await;
                Some(StartedClear {
                    action: run.action.clone(),
                    run: Some(run),
                })
            }
            Some(UndoRequested::Already(action)) => {
                span.record("started", false);
                Some(StartedClear {
                    action: ClearAction::from_stored(action)?,
                    run: None,
                })
            }
        })
    }

    #[tracing::instrument(
        name = "notification_inbox.run_clear",
        skip_all,
        fields(
            user = %viewer.user,
            clear = %run.action.id,
            undo = run.action.status == BulkActionStatus::Undoing,
            chunks = tracing::field::Empty,
            rows = tracing::field::Empty,
            outcome = tracing::field::Empty,
        ),
        err
    )]
    async fn run_clear(
        &self,
        viewer: FeedViewer,
        run: ClearRun,
        stop: CancellationToken,
    ) -> Result<ClearAction, FeedError> {
        let ClearRun {
            lease,
            mut action,
            mut cursor,
        } = run;
        let span = tracing::Span::current();
        let mut chunks = 0_u32;
        let mut told = tokio::time::Instant::now();
        let outcome = loop {
            if stop.is_cancelled() {
                // Hand the clear over now rather than when the lease runs out.
                if let Err(error) = self.clears.release(&lease).await {
                    tracing::warn!(error = ?error, "failed to release a clear's lease");
                }
                break "released";
            }
            let step = if action.status == BulkActionStatus::Undoing {
                self.undo_clear_chunk(&viewer, &lease)
                    .await?
                    .map(|action| (action, ClearCursor::default()))
            } else {
                self.apply_clear_chunk(&viewer, &lease, &action, &cursor)
                    .await?
            };
            let Some((stepped, next)) = step else {
                break "taken over";
            };
            chunks += 1;
            action = stepped;
            cursor = next;
            if !action.status.is_running() {
                self.clear_updates.updated(&viewer.user, &action).await;
                break "finished";
            }
            if told.elapsed() >= CLEAR_UPDATE_INTERVAL {
                self.clear_updates.updated(&viewer.user, &action).await;
                told = tokio::time::Instant::now();
            }
        };
        span.record("chunks", chunks);
        span.record("rows", action.rows);
        span.record("outcome", outcome);
        Ok(action)
    }

    async fn clear_action(
        &self,
        viewer: FeedViewer,
        id: Uuid,
    ) -> Result<Option<ClearAction>, FeedError> {
        Ok(self
            .clears
            .get(&viewer.user, id)
            .await?
            .map(ClearAction::from_stored)
            .transpose()?)
    }

    async fn running_clears(&self, viewer: FeedViewer) -> Result<Vec<ClearAction>, FeedError> {
        Ok(self
            .clears
            .running(&viewer.user)
            .await?
            .into_iter()
            .map(ClearAction::from_stored)
            .collect::<Result<_, _>>()?)
    }

    #[tracing::instrument(
        name = "notification_inbox.claim_stalled_clears",
        skip_all,
        fields(claimed = tracing::field::Empty, purged = tracing::field::Empty),
        err
    )]
    async fn claim_stalled_clears(&self) -> Result<Vec<ClearRun>, FeedError> {
        let purged = self
            .clears
            .purge_finished(Utc::now() - CLEAR_RETENTION, CLEAR_PURGE_BATCH)
            .await?;
        let runs: Vec<ClearRun> = self
            .clears
            .claim_stalled(STALLED_CLEAR_CLAIMS)
            .await?
            .into_iter()
            .filter_map(|(action, lease)| {
                // An unreadable clear stays claimed until it is given up.
                ClearRun::from_stored(action, lease)
                    .inspect_err(
                        |error| tracing::error!(error = ?error, "unreadable stalled clear"),
                    )
                    .ok()
            })
            .collect();
        let span = tracing::Span::current();
        span.record("claimed", runs.len());
        span.record("purged", purged);
        Ok(runs)
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
