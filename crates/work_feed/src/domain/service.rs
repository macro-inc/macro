//! The work feed use cases: list a page, recompute known items, mark items
//! done, and undo a done. Paging, refill, notification loading and
//! acknowledgment are the shared feed layer's; this service builds Home's
//! items from what it loads.

use std::collections::{HashMap, HashSet};

use attention_feed::domain::{
    acknowledge::Acknowledger,
    models::{
        Acknowledgment, CandidateKeying, CandidateRequest, DoneReceipt, EntityFacts, FeedError,
        FeedKey, FeedViewer, Loaded, counts_as_unseen,
    },
    ports::{CandidateSource, FeedMail, FeedNotifications, FeedSignals},
    reader::FeedReader,
};
use model_entity::EntityType;
use model_notifications::NotifEvent;
use rootcause::Report;
use uuid::Uuid;

use super::{
    models::{
        WorkFeedChange, WorkFeedDoneOutcome, WorkFeedDoneTarget, WorkFeedEntry, WorkFeedItem,
        WorkFeedItemState, WorkFeedPage, WorkFeedPrimaryReason, WorkFeedQuery, WorkFeedScope,
    },
    policy, stacking,
};

#[cfg(test)]
mod test;

/// The work feed's use cases.
pub trait WorkFeedService: Send + Sync + 'static {
    /// The hydrated entity each item carries.
    type Entity: Send + Sync + 'static;

    /// One page of the viewer's feed, newest first.
    fn page(
        &self,
        viewer: FeedViewer,
        query: WorkFeedQuery,
    ) -> impl Future<Output = Result<WorkFeedPage<Self::Entity>, FeedError>> + Send;

    /// The current membership and content of known items in one feed: each
    /// key comes back upserted with its placement, or removed.
    fn recompute(
        &self,
        viewer: FeedViewer,
        scope: WorkFeedScope,
        keys: Vec<FeedKey>,
    ) -> impl Future<Output = Result<Vec<WorkFeedChange<Self::Entity>>, FeedError>> + Send;

    /// Acknowledge the attention the caller observed on each item: its
    /// notifications move to done and its inbox email is archived. Own work
    /// is not acknowledged, so an item the viewer also worked on stays in the
    /// work feed, seen, at its own-work time. Underlying tasks, discussions
    /// and pull requests are not completed.
    fn mark_done(
        &self,
        viewer: FeedViewer,
        targets: Vec<WorkFeedDoneTarget>,
    ) -> impl Future<Output = Result<WorkFeedDoneOutcome, FeedError>> + Send;

    /// Reverse exactly what one mark-done changed, then recompute its items
    /// for the caller's feed.
    fn undo_done(
        &self,
        viewer: FeedViewer,
        scope: WorkFeedScope,
        receipt: DoneReceipt,
    ) -> impl Future<Output = Result<Vec<WorkFeedChange<Self::Entity>>, FeedError>> + Send;
}

/// The work feed service over the shared feed layer.
pub struct WorkFeedServiceImpl<S, N, M, G> {
    reader: FeedReader<S, N>,
    acknowledger: Acknowledger<N, M, G>,
}

impl<S, N, M, G> WorkFeedServiceImpl<S, N, M, G>
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

/// An entry with the facts done needs about it.
struct Assembled<E> {
    entry: WorkFeedEntry<E>,
    facts: EntityFacts,
}

/// The candidate request for one feed scope. The reader sets the limit,
/// cursor and key restriction per read.
fn candidate_request(viewer: &FeedViewer, scope: &WorkFeedScope) -> CandidateRequest {
    CandidateRequest {
        viewer: viewer.clone(),
        keying: CandidateKeying::ThreadScoped,
        own_work: scope.mode.own_work(),
        types: policy::candidate_types(&scope.types),
        filter: policy::signal_filter(&viewer.user, scope.include_snippets),
        limit: 0,
        after: None,
        only: None,
    }
}

/// Build one item from its loaded candidate. Returns `None` when, after
/// scoping, the item has no reason left.
fn assemble_item<E>(loaded: Loaded<E>) -> Option<Assembled<E>> {
    let Loaded {
        candidate: item,
        notifications: available,
    } = loaded;
    let mut scoped = match item.key.entity_type {
        EntityType::Channel => stacking::scope_channel(&available),
        EntityType::ChannelMessage => {
            stacking::scope_channel_thread(&available, item.key.entity_id.as_ref())
        }
        _ => available,
    };
    // An email's attention lasts while it is in the inbox: archive is mail's
    // own done, whatever its notifications' states.
    if item.facts.mail.is_some_and(|mail| !mail.inbox_visible) {
        scoped.clear();
    }
    if scoped.is_empty() && item.touched_at.is_none() {
        return None;
    }

    let stacks = stacking::stack(&scoped);
    let attention_at = scoped.first().map(|notification| notification.created_at);
    let unseen = match item.facts.mail {
        // Mail is unseen while it has unread messages or an unseen reminder;
        // new-mail notifications follow the mailbox's own read state.
        Some(mail) => {
            !mail.is_read
                || scoped.iter().any(|notification| {
                    matches!(notification.notification_metadata, NotifEvent::Reminder(_))
                        && counts_as_unseen(notification)
                })
        }
        None => scoped
            .iter()
            .any(|notification| counts_as_unseen(notification)),
    };
    let primary = match (attention_at, item.touched_at) {
        (Some(attention), Some(touched)) if touched >= attention => WorkFeedPrimaryReason::OwnWork,
        (Some(_), _) if !stacks.is_empty() => WorkFeedPrimaryReason::Attention { stack: 0 },
        _ => WorkFeedPrimaryReason::OwnWork,
    };

    Some(Assembled {
        entry: WorkFeedEntry {
            sort_at: item.sort_at,
            item: WorkFeedItem {
                key: FeedKey::new(item.key),
                entity: item.entity,
                state: if unseen {
                    WorkFeedItemState::Unseen
                } else {
                    WorkFeedItemState::Seen
                },
                attention_at,
                touched_at: item.touched_at,
                notifications: scoped,
                stacks,
                primary,
            },
        },
        facts: item.facts,
    })
}

impl<S, N, M, G> WorkFeedServiceImpl<S, N, M, G>
where
    S: CandidateSource,
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
{
    /// Current items for `keys` in `scope`, keyed by item.
    async fn current(
        &self,
        viewer: &FeedViewer,
        scope: &WorkFeedScope,
        keys: &[FeedKey],
    ) -> Result<HashMap<FeedKey, Assembled<S::Entity>>, Report> {
        Ok(self
            .reader
            .current(candidate_request(viewer, scope), keys)
            .await?
            .into_iter()
            .filter_map(|(key, loaded)| assemble_item(loaded).map(|assembled| (key, assembled)))
            .collect())
    }
}

/// Keys deduplicated in first-seen order.
fn unique_keys(keys: impl IntoIterator<Item = FeedKey>) -> Vec<FeedKey> {
    let mut seen = HashSet::new();
    keys.into_iter()
        .filter(|key| seen.insert(key.clone()))
        .collect()
}

/// An email thread item's thread id.
fn email_thread_id(key: &FeedKey) -> Option<Uuid> {
    (key.entity().entity_type == EntityType::EmailThread)
        .then(|| Uuid::parse_str(key.entity().entity_id.as_ref()).ok())
        .flatten()
}

impl<S, N, M, G> WorkFeedService for WorkFeedServiceImpl<S, N, M, G>
where
    S: CandidateSource,
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
{
    type Entity = S::Entity;

    #[tracing::instrument(err, skip(self, viewer), fields(user = %viewer.user))]
    async fn page(
        &self,
        viewer: FeedViewer,
        query: WorkFeedQuery,
    ) -> Result<WorkFeedPage<Self::Entity>, FeedError> {
        let request = CandidateRequest {
            limit: query.limit,
            after: query.after,
            ..candidate_request(&viewer, &query.scope)
        };
        let page = self
            .reader
            .page(request, |loaded| {
                assemble_item(loaded).map(|assembled| assembled.entry)
            })
            .await?;
        Ok(WorkFeedPage {
            entries: page.entries,
            next: page.next,
        })
    }

    #[tracing::instrument(err, skip(self, viewer, keys), fields(user = %viewer.user, keys = keys.len()))]
    async fn recompute(
        &self,
        viewer: FeedViewer,
        scope: WorkFeedScope,
        keys: Vec<FeedKey>,
    ) -> Result<Vec<WorkFeedChange<Self::Entity>>, FeedError> {
        let keys = unique_keys(keys);
        if keys.is_empty() {
            return Ok(Vec::new());
        }
        let mut current = self.current(&viewer, &scope, &keys).await?;
        Ok(keys
            .into_iter()
            .map(|key| match current.remove(&key) {
                Some(assembled) => WorkFeedChange::Upserted(assembled.entry),
                None => WorkFeedChange::Removed(key),
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self, viewer, targets), fields(user = %viewer.user, targets = targets.len()))]
    async fn mark_done(
        &self,
        viewer: FeedViewer,
        targets: Vec<WorkFeedDoneTarget>,
    ) -> Result<WorkFeedDoneOutcome, FeedError> {
        let keys = unique_keys(targets.iter().map(|target| target.key.clone()));
        if keys.is_empty() {
            return Ok(WorkFeedDoneOutcome {
                items: Vec::new(),
                receipt: DoneReceipt::default(),
            });
        }
        // Evaluate each item in every feed's scope, whatever feed the caller
        // was looking at, so done acknowledges what they observed.
        let mut current = self
            .current(&viewer, &WorkFeedScope::everything(), &keys)
            .await?;

        let mut acknowledgments = Vec::with_capacity(keys.len());
        let mut planned = HashSet::new();
        for target in targets {
            if !planned.insert(target.key.clone()) {
                continue;
            }
            // An item already gone from every feed has nothing left to
            // acknowledge, but is still reported done.
            let acknowledgment = match current.remove(&target.key) {
                Some(assembled) => {
                    let item = &assembled.entry.item;
                    let observed = target.revision.unwrap_or_else(|| item.revision());
                    Acknowledgment {
                        notification_ids: observed.acknowledged(&item.notifications),
                        archive_thread: assembled
                            .facts
                            .mail
                            .is_some_and(|mail| mail.inbox_visible)
                            .then(|| email_thread_id(&target.key))
                            .flatten(),
                        key: target.key,
                    }
                }
                None => Acknowledgment {
                    key: target.key,
                    notification_ids: Vec::new(),
                    archive_thread: None,
                },
            };
            acknowledgments.push(acknowledgment);
        }

        let receipt = self
            .acknowledger
            .acknowledge(&viewer, acknowledgments)
            .await?;
        Ok(WorkFeedDoneOutcome {
            items: keys,
            receipt,
        })
    }

    #[tracing::instrument(err, skip(self, viewer, receipt), fields(user = %viewer.user))]
    async fn undo_done(
        &self,
        viewer: FeedViewer,
        scope: WorkFeedScope,
        receipt: DoneReceipt,
    ) -> Result<Vec<WorkFeedChange<Self::Entity>>, FeedError> {
        let keys = self.acknowledger.undo(&viewer, &receipt).await?;
        self.recompute(viewer, scope, keys).await
    }
}
