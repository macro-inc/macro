//! The notification inbox use cases: list a page of groups with their rows,
//! recompute known groups, mark rows done or seen, and undo a done. Paging,
//! refill, notification loading and acknowledgment are the shared feed
//! layer's; this service cuts what it loads into rows.

use std::collections::{HashMap, HashSet};

use attention_feed::domain::{
    acknowledge::Acknowledger,
    models::{
        Acknowledgment, CandidateKeying, CandidateRequest, DoneReceipt, FeedError, FeedKey,
        FeedViewer, Loaded, MailFacts,
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
        InboxChange, InboxDoneOutcome, InboxEntry, InboxPage, InboxQuery, InboxRow, InboxRowId,
        InboxRowTarget, InboxRowType, InboxScope,
    },
    policy, rows,
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
pub struct NotificationInboxServiceImpl<S, N, M, G> {
    reader: FeedReader<S, N>,
    acknowledger: Acknowledger<N, M, G>,
}

impl<S, N, M, G> NotificationInboxServiceImpl<S, N, M, G>
where
    S: CandidateSource,
    N: FeedNotifications + Clone,
    M: FeedMail,
    G: FeedSignals,
{
    /// Create the service from its ports; the reader and the acknowledger
    /// share the notification port.
    pub fn new(source: S, notifications: N, mail: M, signals: G) -> Self {
        Self {
            reader: FeedReader::new(source, notifications.clone()),
            acknowledger: Acknowledger::new(notifications, mail, signals),
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
            .filter(|row| scope.admits(row.row_type))
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

impl<S, N, M, G> NotificationInboxServiceImpl<S, N, M, G>
where
    S: CandidateSource,
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
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

impl<S, N, M, G> NotificationInboxService for NotificationInboxServiceImpl<S, N, M, G>
where
    S: CandidateSource,
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
{
    type Entity = S::Entity;

    #[tracing::instrument(
        name = "notification_inbox.page",
        skip_all,
        fields(
            user = %viewer.user,
            limit = query.limit,
            row_types = query.scope.row_types.len(),
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
                    let observed = target.revision.unwrap_or_else(|| row.revision());
                    Acknowledgment {
                        key: group.key.clone(),
                        notification_ids: observed.acknowledged(row.all_notifications()),
                        archive_thread: (row.row_type == InboxRowType::Email
                            && group.mail.is_some_and(|mail| mail.inbox_visible))
                        .then(|| email_thread_id(&group.key))
                        .flatten(),
                    }
                }
                None => Acknowledgment {
                    key: target.id.group,
                    notification_ids: Vec::new(),
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
