//! Live webhook event streaming: broker events in, per-subscriber SSE out.
//!
//! `WebhookEventStreamService` is the inbound port driven by the SSE handler
//! in `crate::inbound::stream_router`. Unlike ingestion — which matches
//! persisted webhook subscriptions and enqueues durable deliveries — a stream
//! is ephemeral: the caller supplies [`WebhookFilters`] on the request, each
//! candidate event is checked against the same accessor set persisted
//! webhooks fan out to (`get_users_by_entity`), and nothing is persisted.
//! Team-scoped workspace events use `get_user_team_workspace_id` and
//! re-check membership per event.
//!
//! Delivery goes through a process-local [`StreamFeed`], which also keeps the
//! last two minutes of events. A subscriber that reopens with the id of the
//! last event it saw ([`StreamCursor`]) is first sent every retained event
//! after it, so a reconnect, or a stream opened just after the event it was
//! waiting for, loses nothing. Events older than the retention, or published
//! while this process was not consuming, are still missed.
//!
//! While the broker consumer is making progress it sends a heartbeat through
//! the feed ([`StreamFeed::heartbeat`]). Every subscriber passes it on in order
//! after the events queued before it, so a client that stops hearing them
//! knows its stream is dead even while the connection stays open. A resuming
//! subscriber that falls too far behind ends its stream, so its client
//! reconnects and replays from its cursor instead of silently missing events;
//! one that cannot replay skips them and continues.

#[cfg(test)]
mod test;

use crate::domain::models::{NormalizedWebhookEvent, WebhookFilters, WebhookScope};
use crate::domain::ports::{WebhookContactChecker, WebhookWorkspaceResolver};
use chrono::{DateTime, Utc};
use entity_access::domain::models::{AccessError, EntityType};
use entity_access::domain::ports::EntityAccessService;
use futures::StreamExt as _;
use futures::stream::BoxStream;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::VecDeque;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tokio::sync::broadcast;
use uuid::Uuid;

/// Number of events retained for each active subscriber before it falls
/// behind.
pub const WEBHOOK_STREAM_CHANNEL_CAPACITY: usize = 1_024;

/// Most events the feed keeps for subscribers resuming from a cursor.
pub const WEBHOOK_STREAM_REPLAY_CAPACITY: usize = 4_096;

/// How long the feed keeps an event for subscribers resuming from a cursor.
/// Covers a reconnect's backoff, and the gap between a runtime learning of a
/// newly bound agent and its stream covering that agent.
pub const WEBHOOK_STREAM_REPLAY_RETENTION: Duration = Duration::from_secs(120);

/// How far before its cursor a resumed stream starts: events minted that
/// close before it may still reach this replica after it.
pub const WEBHOOK_STREAM_REPLAY_LOOKBACK: Duration = Duration::from_secs(5);

/// When an event was minted, from its UUIDv7 id.
fn minted(candidate: &StreamCandidateEvent) -> Option<DateTime<Utc>> {
    StreamCursor::parse(&candidate.event.event_id)
        .ok()
        .and_then(StreamCursor::time)
}

/// Where a subscriber resumes: the id of the last event it saw, sent back as
/// SSE `Last-Event-ID`.
///
/// Broker event ids are UUIDv7. A stream resumed from one replays every
/// retained event minted from a few seconds before it on, except the cursor's
/// own event, so the subscriber drops repeats by id. A cursor minted from a
/// timestamp works the same way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamCursor(Uuid);

impl StreamCursor {
    /// Parse the `Last-Event-ID` a subscriber sent back.
    pub fn parse(last_event_id: &str) -> Result<Self, WebhookStreamError> {
        let id = Uuid::parse_str(last_event_id.trim()).map_err(|_| {
            WebhookStreamError::BadRequest("`Last-Event-ID` must be an event id".to_string())
        })?;
        if id.get_version_num() != 7 {
            return Err(WebhookStreamError::BadRequest(
                "`Last-Event-ID` must be a UUIDv7 event id".to_string(),
            ));
        }
        Ok(Self(id))
    }

    /// When the cursor's event was minted.
    fn time(self) -> Option<DateTime<Utc>> {
        let (seconds, nanos) = self.0.get_timestamp()?.to_unix();
        DateTime::from_timestamp(i64::try_from(seconds).ok()?, nanos)
    }
}

/// An event the feed keeps for resuming subscribers.
struct Retained {
    /// When this process published it.
    at: DateTime<Utc>,
    candidate: Arc<StreamCandidateEvent>,
}

/// The process-local feed every stream reads: a broadcast for live
/// subscribers, plus the recent events a resuming subscriber replays.
///
/// Publishing and subscribing take one lock, so a subscriber's replay and its
/// live receiver meet exactly: no event lands in both, and none in neither.
#[derive(Clone)]
pub struct StreamFeed {
    inner: Arc<Mutex<FeedInner>>,
}

/// What the feed broadcasts to live subscribers.
#[derive(Clone)]
pub(crate) enum FeedItem {
    Event(Arc<StreamCandidateEvent>),
    Heartbeat,
}

struct FeedInner {
    sender: broadcast::Sender<FeedItem>,
    recent: VecDeque<Retained>,
    replay_capacity: usize,
}

impl StreamFeed {
    /// A feed whose live subscribers buffer `channel_capacity` events and
    /// which keeps up to `replay_capacity` recent events for resuming ones.
    pub fn new(channel_capacity: usize, replay_capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(channel_capacity);
        Self {
            inner: Arc::new(Mutex::new(FeedInner {
                sender,
                recent: VecDeque::with_capacity(replay_capacity),
                replay_capacity,
            })),
        }
    }

    fn lock(&self) -> MutexGuard<'_, FeedInner> {
        // Every mutation under the lock is a single push or pop, so a panic
        // cannot leave the queue half-changed.
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Hand `candidate` to every live subscriber and keep it for resuming
    /// ones.
    pub fn publish(&self, candidate: StreamCandidateEvent) {
        // Shared, not copied: a resuming subscriber takes its replay under
        // this lock, and copying envelopes there would stall publishing.
        let candidate = Arc::new(candidate);
        let now = Utc::now();
        let oldest_kept = now - WEBHOOK_STREAM_REPLAY_RETENTION;
        let mut inner = self.lock();
        while let Some(oldest) = inner.recent.front()
            && (oldest.at < oldest_kept || inner.recent.len() >= inner.replay_capacity)
        {
            inner.recent.pop_front();
        }
        if inner.replay_capacity > 0 {
            inner.recent.push_back(Retained {
                at: now,
                candidate: Arc::clone(&candidate),
            });
        }
        // Having no active subscribers is expected.
        let _ = inner.sender.send(FeedItem::Event(candidate));
    }

    /// Tell every live subscriber that the feed is alive. Never kept for
    /// replay. Send only while the broker consumer is making progress: a
    /// heartbeat says that events published now will arrive.
    pub fn heartbeat(&self) {
        // Having no active subscribers is expected.
        let _ = self.lock().sender.send(FeedItem::Heartbeat);
    }

    /// Subscribe to live events, and take the retained ones after `after`.
    pub(crate) fn subscribe_after(
        &self,
        after: Option<StreamCursor>,
    ) -> (
        VecDeque<Arc<StreamCandidateEvent>>,
        broadcast::Receiver<FeedItem>,
    ) {
        let inner = self.lock();
        let receiver = inner.sender.subscribe();
        let Some(after) = after else {
            return (VecDeque::new(), receiver);
        };
        // Pruning happens on publish, so a quiet feed can still hold events
        // past the retention; never replay those.
        let oldest_kept = Utc::now() - WEBHOOK_STREAM_REPLAY_RETENTION;
        let Some(since) = after
            .time()
            .map(|minted| minted - WEBHOOK_STREAM_REPLAY_LOOKBACK)
        else {
            return (VecDeque::new(), receiver);
        };
        // By when each event was minted, not where it sits here: replicas
        // consume the topics in their own order, so the events after a cursor
        // on one can sit before it on another. Looking back a little more
        // repeats some the subscriber saw, which it drops by id.
        let cursor = after.0.to_string();
        let replay = inner
            .recent
            .iter()
            .filter(|retained| retained.at >= oldest_kept)
            .filter(|retained| retained.candidate.event.event_id != cursor)
            .filter(|retained| minted(&retained.candidate).unwrap_or(retained.at) >= since)
            .map(|retained| retained.candidate.clone())
            .collect();
        (replay, receiver)
    }
}

/// Whose access decides who may see one candidate event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamAudience {
    /// Anyone with access to this entity.
    Entity {
        /// Entity whose access list gates the event.
        entity_id: String,
        /// Access entity type of `entity_id`.
        entity_type: EntityType,
    },
    /// The subscriber themself, in whatever scope they stream. A requester's
    /// own request reaches the team-scoped stream of a team-shared runtime,
    /// and no other member of that team.
    Person {
        /// The one user who may see the event.
        user_id: String,
    },
    /// The intended recipient of a private notification.
    User {
        /// Intended recipient.
        user_id: String,
    },
    /// Anyone whose personal or team webhook workspace is this workspace.
    Workspace {
        /// Owning workspace id.
        workspace_id: String,
    },
    /// The user themself and everyone who has the user in their directory.
    /// Decided per subscriber with one exact lookup of the user in the
    /// subscriber's directory, never by listing the user's contacts.
    ContactsOf {
        /// User whose contacts (and self) may see the event.
        user_id: String,
    },
    /// Anyone in any of these audiences. Used when an event belongs to more
    /// than one grant at once, such as a departed session whose owner keeps
    /// ownership even after losing access to the parent it came from.
    Any(Vec<StreamAudience>),
}

/// One normalized broker event plus whose access gates it.
#[derive(Debug, Clone)]
pub struct StreamCandidateEvent {
    /// Normalized event, matched against filters and delivered verbatim.
    pub event: NormalizedWebhookEvent,
    /// Whose access decides visibility.
    pub audience: StreamAudience,
}

/// What a subscriber's stream yields.
#[derive(Debug, Clone)]
#[expect(
    clippy::large_enum_variant,
    reason = "nearly every item is an event; boxing it would allocate per event to shrink the rare heartbeat"
)]
pub enum StreamItem {
    /// A matching event the subscriber may see.
    Event(NormalizedWebhookEvent),
    /// The feed is alive: every event published before it was already
    /// considered for this subscriber.
    Heartbeat,
}

/// Webhook event stream error.
#[derive(Debug, thiserror::Error)]
pub enum WebhookStreamError {
    /// The request's filters or scope are invalid.
    #[error("{0}")]
    BadRequest(String),
    /// Adapter or infrastructure failure.
    #[error("internal stream failure")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for WebhookStreamError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}

/// Inbound port for opening filtered, access-checked event streams.
pub trait WebhookEventStreamService: Clone + Send + Sync + 'static {
    /// Open an event stream for `subscriber`.
    ///
    /// `scope` selects the subscriber's personal or current team workspace for
    /// webhook lifecycle events. Entity events remain gated by entity access.
    /// With `after`, the stream first replays the retained events after that
    /// cursor, through the same filters and access checks.
    fn open_stream(
        &self,
        subscriber: MacroUserIdStr<'static>,
        scope: WebhookScope,
        filters: WebhookFilters,
        after: Option<StreamCursor>,
    ) -> impl Future<Output = Result<BoxStream<'static, StreamItem>, WebhookStreamError>> + Send;
}

/// Webhook event stream service implementation.
pub struct WebhookEventStreamServiceImpl<A, R, C> {
    feed: StreamFeed,
    entity_access_service: Arc<A>,
    workspace_resolver: R,
    contact_checker: C,
}

impl<A, R: Clone, C: Clone> Clone for WebhookEventStreamServiceImpl<A, R, C> {
    fn clone(&self) -> Self {
        Self {
            feed: self.feed.clone(),
            entity_access_service: self.entity_access_service.clone(),
            workspace_resolver: self.workspace_resolver.clone(),
            contact_checker: self.contact_checker.clone(),
        }
    }
}

impl<A, R, C> WebhookEventStreamServiceImpl<A, R, C> {
    /// Create a webhook event stream service.
    pub fn new(
        feed: StreamFeed,
        entity_access_service: Arc<A>,
        workspace_resolver: R,
        contact_checker: C,
    ) -> Self {
        Self {
            feed,
            entity_access_service,
            workspace_resolver,
            contact_checker,
        }
    }
}

/// Owned per-stream state advanced by the unfold loop.
struct StreamState<A, R, C> {
    /// Retained events after the subscriber's cursor, delivered first.
    replay: VecDeque<Arc<StreamCandidateEvent>>,
    receiver: broadcast::Receiver<FeedItem>,
    /// Whether falling behind ends the stream: only a subscriber that
    /// resumed from a cursor can reopen and replay what it missed.
    ends_when_behind: bool,
    entity_access_service: Arc<A>,
    workspace_resolver: R,
    contact_checker: C,
    subscriber: MacroUserIdStr<'static>,
    scope: WebhookScope,
    filters: WebhookFilters,
}

impl<A, R, C> StreamState<A, R, C>
where
    A: EntityAccessService,
    R: WebhookWorkspaceResolver,
    C: WebhookContactChecker,
{
    /// The workspace this stream currently represents for webhook.* events.
    ///
    /// Re-resolved per event so a revoked team membership cannot keep
    /// receiving workspace lifecycle payloads on a held connection.
    async fn scoped_workspace_id(&self) -> Result<Option<String>, rootcause::Report> {
        match self.scope {
            WebhookScope::User => Ok(Some(self.subscriber.as_ref().to_string())),
            WebhookScope::Team => self
                .workspace_resolver
                .get_user_team_workspace_id(self.subscriber.clone())
                .await
                .map_err(|error| {
                    let error: anyhow::Error = error.into();
                    rootcause::report!("failed to resolve subscriber team workspace: {error:?}")
                }),
        }
    }

    /// Whether the subscriber may see an event with this audience.
    async fn subscriber_in_audience(
        &mut self,
        audience: &StreamAudience,
    ) -> Result<bool, rootcause::Report> {
        match audience {
            StreamAudience::Person { user_id } => Ok(self.subscriber.as_ref() == user_id.as_str()),
            StreamAudience::User { user_id } => Ok(
                self.scope == WebhookScope::User && self.subscriber.as_ref() == user_id.as_str()
            ),
            StreamAudience::ContactsOf { user_id } => {
                if self.scope != WebhookScope::User {
                    return Ok(false);
                }
                if self.subscriber.as_ref() == user_id.as_str() {
                    return Ok(true);
                }
                // An unparseable id cannot be anyone's contact.
                let Ok(user) = MacroUserIdStr::try_from(user_id.clone()) else {
                    return Ok(false);
                };
                // The subscriber sees the event when the user is in the
                // subscriber's directory, which need not hold the other way.
                self.contact_checker
                    .is_contact(self.subscriber.clone(), user)
                    .await
                    .map_err(|error| {
                        let error: anyhow::Error = error.into();
                        rootcause::report!("failed to check stream contact audience: {error:?}")
                    })
            }
            StreamAudience::Any(audiences) => {
                for audience in audiences {
                    if Box::pin(self.subscriber_in_audience(audience)).await? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            StreamAudience::Workspace { workspace_id } => {
                let current = self.scoped_workspace_id().await?;
                if self.scope == WebhookScope::Team && current.is_none() {
                    return Err(rootcause::report!(
                        "team-scoped stream lost team membership"
                    ));
                }
                Ok(current.as_deref() == Some(workspace_id.as_str()))
            }
            StreamAudience::Entity {
                entity_id,
                entity_type,
            } => {
                // Same accessor set persisted webhooks fan out to. PUBLIC/TEAM
                // link-share is View via `get_access_level` but is not an
                // accessor, so it must not open the live firehose.
                match self
                    .entity_access_service
                    .get_users_by_entity(entity_id, *entity_type)
                    .await
                {
                    Ok(accessors) => Ok(accessors
                        .iter()
                        .any(|user| user.as_ref() == self.subscriber.as_ref())),
                    // Agent sessions (and other non-fanout types) have no
                    // accessor expansion. Fall back to the subscriber's own
                    // access level so existing-session triggers still reach
                    // an authorized listener.
                    Err(AccessError::BadRequest(_)) => Ok(self
                        .entity_access_service
                        .get_access_level(Some(&self.subscriber), entity_id, *entity_type)
                        .await
                        .map_err(|error| rootcause::report!(error).into_dynamic())?
                        .is_some()),
                    Err(error) => Err(rootcause::report!(error).into_dynamic()),
                }
            }
        }
    }

    /// Await the next heartbeat, or event that matches the filters and passes
    /// access.
    ///
    /// Returns `None` when the channel closes, a resuming subscriber fell
    /// behind, or an access check fails.
    async fn next_delivered(&mut self) -> Option<StreamItem> {
        loop {
            let next = match self.replay.pop_front() {
                Some(candidate) => Ok(FeedItem::Event(candidate)),
                None => self.receiver.recv().await,
            };
            let candidate = match next {
                Ok(FeedItem::Event(candidate)) => candidate,
                Ok(FeedItem::Heartbeat) => return Some(StreamItem::Heartbeat),
                // Ending lets a resuming client reconnect from its cursor and
                // replay what it missed. Any other client could not replay
                // them, and the SDK listener does not reopen an ended stream.
                Err(broadcast::error::RecvError::Lagged(skipped)) if self.ends_when_behind => {
                    tracing::warn!(
                        skipped,
                        "webhook event stream subscriber fell behind; ending the stream"
                    );
                    return None;
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "webhook event stream subscriber missed events");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    return None;
                }
            };
            if !self.filters.iter().any(|filter| {
                filter.accepts(&candidate.event.event_name, &candidate.event.entity_id)
                    || filter.accepts("*", &candidate.event.entity_id)
            }) {
                continue;
            }
            match self.subscriber_in_audience(&candidate.audience).await {
                Ok(true) => return Some(StreamItem::Event(candidate.event.clone())),
                Ok(false) => continue,
                Err(error) => {
                    tracing::error!(error = ?error, "webhook event stream access check failed; ending stream");
                    return None;
                }
            }
        }
    }
}

/// Reject filter sets a persisted webhook could not be created with.
///
/// Streams share the persisted-webhook validation rules exactly, so a filter
/// set is either valid for both delivery mechanisms or neither.
fn validate_filters(filters: &WebhookFilters) -> Result<(), WebhookStreamError> {
    crate::domain::service::validate_filters(filters).map_err(|error| match error {
        crate::domain::ports::WebhookError::BadRequest(message) => {
            WebhookStreamError::BadRequest(message)
        }
        other => WebhookStreamError::BadRequest(other.to_string()),
    })
}

impl<A, R, C> WebhookEventStreamService for WebhookEventStreamServiceImpl<A, R, C>
where
    A: EntityAccessService,
    R: WebhookWorkspaceResolver,
    C: WebhookContactChecker,
{
    #[tracing::instrument(
        skip(self, filters),
        fields(filter_count = filters.len(), replayed = tracing::field::Empty)
    )]
    async fn open_stream(
        &self,
        subscriber: MacroUserIdStr<'static>,
        scope: WebhookScope,
        filters: WebhookFilters,
        after: Option<StreamCursor>,
    ) -> Result<BoxStream<'static, StreamItem>, WebhookStreamError> {
        validate_filters(&filters)?;

        if scope == WebhookScope::Team {
            let team_workspace_id = self
                .workspace_resolver
                .get_user_team_workspace_id(subscriber.clone())
                .await
                .map_err(|error| {
                    let error: anyhow::Error = error.into();
                    WebhookStreamError::Internal(rootcause::report!(
                        "failed to resolve subscriber team workspace: {error:?}"
                    ))
                })?;
            if team_workspace_id.is_none() {
                return Err(WebhookStreamError::BadRequest(
                    "team scope requires the user to belong to a team".to_string(),
                ));
            }
        }

        let (replay, receiver) = self.feed.subscribe_after(after);
        tracing::Span::current().record("replayed", replay.len());
        let state = StreamState {
            replay,
            receiver,
            ends_when_behind: after.is_some(),
            entity_access_service: self.entity_access_service.clone(),
            workspace_resolver: self.workspace_resolver.clone(),
            contact_checker: self.contact_checker.clone(),
            subscriber,
            scope,
            filters,
        };
        Ok(futures::stream::unfold(state, |mut state| async move {
            state.next_delivered().await.map(|item| (item, state))
        })
        .boxed())
    }
}
