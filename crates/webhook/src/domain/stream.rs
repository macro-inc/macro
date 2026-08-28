//! Live webhook event streaming: broker events in, per-subscriber SSE out.
//!
//! `WebhookEventStreamService` is the inbound port driven by the SSE handler
//! in `crate::inbound::stream_router`. Unlike ingestion — which matches
//! persisted webhook subscriptions and enqueues durable deliveries — a stream
//! is ephemeral: the caller supplies [`WebhookFilters`] on the request, each
//! candidate event is checked against the caller's own entity access, and
//! nothing is persisted.
//!
//! Delivery is at-least-once within [`MAX_REPLAY_WINDOW`]: every event carries
//! its UUIDv7 broker event id, and a reconnecting client resumes by presenting
//! the last id it saw. A cursor older than the window is rejected outright —
//! the client must resync out of band and reconnect without a cursor — so a
//! stale cursor can neither replay arbitrarily far back nor fake continuity.
//! Events near the cursor may be re-delivered; clients must deduplicate by
//! event id.

#[cfg(test)]
mod test;

use crate::domain::models::{NormalizedWebhookEvent, WebhookFilters};
use crate::domain::ports::WebhookWorkspaceResolver;
use chrono::Utc;
use entity_access::domain::models::EntityType;
use entity_access::domain::ports::EntityAccessService;
use futures::StreamExt as _;
use futures::stream::BoxStream;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Furthest back a reconnecting subscriber may resume; older cursors are
/// rejected as bad requests.
///
/// Replay re-runs the per-event access checks below, so this window bounds the
/// database load a resume can cause.
pub const MAX_REPLAY_WINDOW: Duration = Duration::from_secs(10 * 60);

/// Maximum concurrent event streams per subscriber.
///
/// Purely a resource bound — every stream owns a broker consumer. Reconnect
/// overlap (a client reconnecting before its dead stream is reaped) must never
/// brush against this for a reasonable workload.
pub const MAX_STREAMS_PER_USER: usize = 10;

/// How long one connection trusts a per-entity access decision.
///
/// Bounds access-lookup load for busy entities; also the staleness window in
/// which a subscriber can still see events for an entity whose access was just
/// revoked.
const ACCESS_CACHE_TTL: Duration = Duration::from_secs(30);

/// Where a newly opened stream source begins reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamStart {
    /// Only events published after the source opens.
    Latest,
    /// The earliest retained event at or after this Unix-epoch millisecond
    /// timestamp.
    AtTimestampMs(i64),
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
    /// Anyone whose personal or team webhook workspace is this workspace.
    Workspace {
        /// Owning workspace id.
        workspace_id: String,
    },
}

/// One normalized broker event plus whose access gates it.
#[derive(Debug, Clone)]
pub struct StreamCandidateEvent {
    /// Normalized event, matched against filters and delivered verbatim.
    pub event: NormalizedWebhookEvent,
    /// Whose access decides visibility.
    pub audience: StreamAudience,
}

/// Webhook event stream error.
#[derive(Debug, thiserror::Error)]
pub enum WebhookStreamError {
    /// The request's filters or resume cursor are invalid.
    #[error("{0}")]
    BadRequest(String),
    /// The subscriber already holds [`MAX_STREAMS_PER_USER`] streams.
    #[error("too many concurrent event streams")]
    TooManyStreams,
    /// Adapter or infrastructure failure.
    #[error("internal stream failure")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for WebhookStreamError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}

/// Outbound port: an open, positioned source of candidate events.
pub trait WebhookStreamSource: Send + 'static {
    /// Await the next decodable candidate event.
    ///
    /// Implementations skip undecodable or non-deliverable records internally;
    /// an error is terminal for the source.
    fn next_event(
        &mut self,
    ) -> impl Future<Output = Result<StreamCandidateEvent, rootcause::Report>> + Send;
}

/// Outbound port: opens one positioned [`WebhookStreamSource`] per stream.
pub trait WebhookStreamSourceFactory: Clone + Send + Sync + 'static {
    /// Source type opened by this factory.
    type Source: WebhookStreamSource;

    /// Open a source positioned at `start`.
    fn open(
        &self,
        start: StreamStart,
    ) -> impl Future<Output = Result<Self::Source, rootcause::Report>> + Send;
}

/// Inbound port for opening filtered, access-checked event streams.
pub trait WebhookEventStreamService: Clone + Send + Sync + 'static {
    /// Open an event stream for `subscriber`.
    ///
    /// `last_event_id` is the UUIDv7 broker event id of the last event the
    /// subscriber saw; when present, the stream resumes from that event's
    /// timestamp. A cursor older than [`MAX_REPLAY_WINDOW`] is rejected as a
    /// bad request rather than silently truncated. The stream ends on any
    /// internal failure — subscribers reconnect and resume by id.
    fn open_stream(
        &self,
        subscriber: MacroUserIdStr<'static>,
        filters: WebhookFilters,
        last_event_id: Option<Uuid>,
    ) -> impl Future<Output = Result<BoxStream<'static, NormalizedWebhookEvent>, WebhookStreamError>>
    + Send;
}

/// Return whether any filter element matches the event.
///
/// Mirrors the persisted-webhook matching semantics: the event name and the
/// entity id must match within the same filter element, and an element without
/// `ids` matches every entity id.
pub fn filters_match(filters: &WebhookFilters, event_name: &str, entity_id: &str) -> bool {
    filters.iter().any(|filter| {
        filter.events.iter().any(|event| event == event_name)
            && filter
                .ids
                .as_ref()
                .is_none_or(|ids| ids.iter().any(|id| id == entity_id))
    })
}

/// Resolve where a stream should start, rejecting cursors older than the
/// replay window.
fn stream_start(
    last_event_id: Option<Uuid>,
    now_ms: i64,
) -> Result<StreamStart, WebhookStreamError> {
    let Some(last_event_id) = last_event_id else {
        return Ok(StreamStart::Latest);
    };
    let timestamp = last_event_id.get_timestamp().ok_or_else(|| {
        WebhookStreamError::BadRequest("last event id must be a UUIDv7 broker event id".to_string())
    })?;
    let (seconds, nanoseconds) = timestamp.to_unix();
    let event_ms = i64::try_from(seconds)
        .ok()
        .and_then(|seconds| seconds.checked_mul(1000))
        .map(|millis| millis + i64::from(nanoseconds / 1_000_000))
        .ok_or_else(|| {
            WebhookStreamError::BadRequest("last event id timestamp is out of range".to_string())
        })?;
    let floor_ms = now_ms - i64::try_from(MAX_REPLAY_WINDOW.as_millis()).unwrap_or(i64::MAX);
    if event_ms < floor_ms {
        return Err(WebhookStreamError::BadRequest(format!(
            "last event id is older than the {}-second replay window; \
             resync and reconnect without Last-Event-ID",
            MAX_REPLAY_WINDOW.as_secs()
        )));
    }
    Ok(StreamStart::AtTimestampMs(event_ms))
}

/// Concurrent stream count per subscriber, shared across a service's streams.
#[derive(Clone, Default)]
struct StreamSlots(Arc<Mutex<HashMap<String, usize>>>);

impl StreamSlots {
    /// Reserve one slot, failing when the subscriber is at the cap.
    fn acquire(
        &self,
        subscriber: &MacroUserIdStr<'static>,
    ) -> Result<StreamSlot, WebhookStreamError> {
        let key = subscriber.to_string();
        let mut counts = self.0.lock().expect("stream slot lock poisoned");
        let count = counts.entry(key.clone()).or_insert(0);
        if *count >= MAX_STREAMS_PER_USER {
            return Err(WebhookStreamError::TooManyStreams);
        }
        *count += 1;
        drop(counts);
        Ok(StreamSlot {
            slots: self.clone(),
            key,
        })
    }
}

/// RAII reservation of one concurrent stream; dropping releases the slot.
struct StreamSlot {
    slots: StreamSlots,
    key: String,
}

impl Drop for StreamSlot {
    fn drop(&mut self) {
        let mut counts = self.slots.0.lock().expect("stream slot lock poisoned");
        if let Some(count) = counts.get_mut(&self.key) {
            *count -= 1;
            if *count == 0 {
                counts.remove(&self.key);
            }
        }
    }
}

/// Webhook event stream service implementation.
pub struct WebhookEventStreamServiceImpl<F, A, R> {
    source_factory: F,
    entity_access_service: Arc<A>,
    workspace_resolver: R,
    slots: StreamSlots,
}

impl<F: Clone, A, R: Clone> Clone for WebhookEventStreamServiceImpl<F, A, R> {
    fn clone(&self) -> Self {
        Self {
            source_factory: self.source_factory.clone(),
            entity_access_service: self.entity_access_service.clone(),
            workspace_resolver: self.workspace_resolver.clone(),
            slots: self.slots.clone(),
        }
    }
}

impl<F, A, R> WebhookEventStreamServiceImpl<F, A, R> {
    /// Create a webhook event stream service.
    pub fn new(source_factory: F, entity_access_service: Arc<A>, workspace_resolver: R) -> Self {
        Self {
            source_factory,
            entity_access_service,
            workspace_resolver,
            slots: StreamSlots::default(),
        }
    }
}

/// Owned per-stream state advanced by the unfold loop.
struct StreamState<Src, A> {
    source: Src,
    entity_access_service: Arc<A>,
    subscriber: MacroUserIdStr<'static>,
    workspace_ids: Vec<String>,
    filters: WebhookFilters,
    access_cache: HashMap<String, (Instant, bool)>,
    _slot: StreamSlot,
}

impl<Src, A> StreamState<Src, A>
where
    Src: WebhookStreamSource,
    A: EntityAccessService,
{
    /// Whether the subscriber may see an event with this audience.
    async fn subscriber_in_audience(
        &mut self,
        audience: &StreamAudience,
    ) -> Result<bool, rootcause::Report> {
        match audience {
            StreamAudience::Workspace { workspace_id } => {
                Ok(self.workspace_ids.contains(workspace_id))
            }
            StreamAudience::Entity {
                entity_id,
                entity_type,
            } => {
                let cache_key = format!("{entity_type:?}:{entity_id}");
                if let Some((decided_at, allowed)) = self.access_cache.get(&cache_key)
                    && decided_at.elapsed() < ACCESS_CACHE_TTL
                {
                    return Ok(*allowed);
                }
                let allowed = self
                    .entity_access_service
                    .get_access_level(Some(&self.subscriber), entity_id, *entity_type)
                    .await
                    .map_err(|error| rootcause::report!(error))?
                    .is_some();
                self.access_cache
                    .insert(cache_key, (Instant::now(), allowed));
                Ok(allowed)
            }
        }
    }

    /// Await the next event that matches the filters and passes access.
    ///
    /// Returns `None` when the source or an access check fails: the stream
    /// ends and the subscriber reconnects with its resume cursor, which
    /// re-delivers anything in flight — at-least-once, not at-most-once.
    async fn next_delivered(&mut self) -> Option<NormalizedWebhookEvent> {
        loop {
            let candidate = match self.source.next_event().await {
                Ok(candidate) => candidate,
                Err(error) => {
                    tracing::error!(error = ?error, "webhook event stream source failed; ending stream");
                    return None;
                }
            };
            if !filters_match(
                &self.filters,
                &candidate.event.event_name,
                &candidate.event.entity_id,
            ) {
                continue;
            }
            match self.subscriber_in_audience(&candidate.audience).await {
                Ok(true) => return Some(candidate.event),
                Ok(false) => continue,
                Err(error) => {
                    tracing::error!(error = ?error, "webhook event stream access check failed; ending stream");
                    return None;
                }
            }
        }
    }
}

/// Reject filters that could never match or that name nothing.
fn validate_filters(filters: &WebhookFilters) -> Result<(), WebhookStreamError> {
    if filters.is_empty() {
        return Err(WebhookStreamError::BadRequest(
            "at least one filter is required".to_string(),
        ));
    }
    for filter in filters {
        if filter.events.is_empty() || filter.events.iter().any(String::is_empty) {
            return Err(WebhookStreamError::BadRequest(
                "every filter must name at least one non-empty event".to_string(),
            ));
        }
        if let Some(ids) = &filter.ids
            && (ids.is_empty() || ids.iter().any(String::is_empty))
        {
            return Err(WebhookStreamError::BadRequest(
                "filter ids, when present, must be non-empty".to_string(),
            ));
        }
    }
    Ok(())
}

impl<F, A, R> WebhookEventStreamService for WebhookEventStreamServiceImpl<F, A, R>
where
    F: WebhookStreamSourceFactory,
    A: EntityAccessService,
    R: WebhookWorkspaceResolver,
{
    #[tracing::instrument(skip(self, filters), fields(filter_count = filters.len()))]
    async fn open_stream(
        &self,
        subscriber: MacroUserIdStr<'static>,
        filters: WebhookFilters,
        last_event_id: Option<Uuid>,
    ) -> Result<BoxStream<'static, NormalizedWebhookEvent>, WebhookStreamError> {
        validate_filters(&filters)?;
        let slot = self.slots.acquire(&subscriber)?;
        let start = stream_start(last_event_id, Utc::now().timestamp_millis())?;

        let workspace_ids = self
            .workspace_resolver
            .resolve_workspace_ids(vec![subscriber.clone()])
            .await
            .map_err(|error| {
                let error: anyhow::Error = error.into();
                WebhookStreamError::Internal(rootcause::report!(
                    "failed to resolve subscriber workspaces: {error:?}"
                ))
            })?;

        let source = self.source_factory.open(start).await?;

        let state = StreamState {
            source,
            entity_access_service: self.entity_access_service.clone(),
            subscriber,
            workspace_ids,
            filters,
            access_cache: HashMap::new(),
            _slot: slot,
        };
        Ok(futures::stream::unfold(state, |mut state| async move {
            state.next_delivered().await.map(|event| (event, state))
        })
        .boxed())
    }
}
