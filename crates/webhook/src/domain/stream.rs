//! Live webhook event streaming: broker events in, per-subscriber SSE out.
//!
//! `WebhookEventStreamService` is the inbound port driven by the SSE handler
//! in `crate::inbound::stream_router`. Unlike ingestion — which matches
//! persisted webhook subscriptions and enqueues durable deliveries — a stream
//! is ephemeral: the caller supplies [`WebhookFilters`] on the request, each
//! candidate event is checked against the caller's own entity access, and
//! nothing is persisted.
//!
//! Replay is best-effort from one process's retained history: every event carries
//! its UUIDv7 broker event id, and a reconnecting client resumes by presenting
//! the last id it saw. Cursors older than [`MAX_REPLAY_WINDOW`] or absent from
//! the local replay log require an out-of-band resync. A Kafka reconnect or
//! request routed to another replica may leave an undetectable gap; clients must
//! resync when continuity matters and always deduplicate by event id.

#[cfg(test)]
mod test;

use crate::domain::models::{NormalizedWebhookEvent, WebhookFilters, WebhookScope};
use crate::domain::ports::WebhookWorkspaceResolver;
use chrono::Utc;
use entity_access::domain::models::EntityType;
use entity_access::domain::ports::EntityAccessService;
use futures::StreamExt as _;
use futures::stream::BoxStream;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Furthest back a reconnecting subscriber may resume; older cursors are
/// rejected as bad requests.
///
/// Replay re-runs the per-event access checks below, so this window bounds the
/// database load a resume can cause.
pub const MAX_REPLAY_WINDOW: Duration = Duration::from_secs(10 * 60);

/// How long one connection trusts a per-entity access decision.
///
/// Bounds access-lookup load for busy entities; also the staleness window in
/// which a subscriber can still see events for an entity whose access was just
/// revoked.
const ACCESS_CACHE_TTL: Duration = Duration::from_secs(30);
/// Hard bound on per-connection entity authorization cache entries.
const MAX_ACCESS_CACHE_ENTRIES: usize = 10_000;
/// Producer clock skew tolerated when validating UUIDv7 resume cursors.
const MAX_CURSOR_CLOCK_SKEW: Duration = Duration::from_secs(60);

/// Where a newly opened stream source begins reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamStart {
    /// Only events published after the source opens.
    Latest,
    /// Verify this broker event is retained, then replay retained history.
    AtEvent {
        /// UUIDv7 broker event id supplied by the subscriber.
        event_id: Uuid,
    },
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

/// Sink for candidates consumed once and multiplexed to local subscribers.
pub trait WebhookStreamCandidateSink: Send + Sync + 'static {
    /// Publish one normalized candidate into the local stream source.
    fn publish(&self, candidate: StreamCandidateEvent);
}

/// Failure to open a positioned stream source.
#[derive(Debug, thiserror::Error)]
pub enum WebhookStreamSourceOpenError {
    /// The requested cursor predates the history retained by this process.
    #[error(
        "resume cursor does not identify a retained webhook event; resync and reconnect without Last-Event-ID"
    )]
    ReplayUnavailable,
}

/// Webhook event stream error.
#[derive(Debug, thiserror::Error)]
pub enum WebhookStreamError {
    /// The request's filters or resume cursor are invalid.
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
    ) -> impl Future<Output = Result<Self::Source, WebhookStreamSourceOpenError>> + Send;
}

/// Inbound port for opening filtered, access-checked event streams.
pub trait WebhookEventStreamService: Clone + Send + Sync + 'static {
    /// Open an event stream for `subscriber`.
    ///
    /// `scope` selects the subscriber's personal or current team workspace for
    /// webhook lifecycle events. Entity events remain gated by entity access.
    ///
    /// `last_event_id` is the UUIDv7 broker event id of the last event the
    /// subscriber saw; when present, the source verifies that event is retained
    /// and conservatively replays its retained history. An unavailable cursor
    /// is rejected as a bad request rather than silently truncated. The stream
    /// ends on any internal failure so subscribers reconnect and resume by id.
    fn open_stream(
        &self,
        subscriber: MacroUserIdStr<'static>,
        scope: WebhookScope,
        filters: WebhookFilters,
        last_event_id: Option<Uuid>,
    ) -> impl Future<Output = Result<BoxStream<'static, NormalizedWebhookEvent>, WebhookStreamError>>
    + Send;
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
    if last_event_id.get_version_num() != 7 {
        return Err(WebhookStreamError::BadRequest(
            "last event id must be a UUIDv7 broker event id".to_string(),
        ));
    }
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
    let max_future_ms =
        now_ms.saturating_add(i64::try_from(MAX_CURSOR_CLOCK_SKEW.as_millis()).unwrap_or(i64::MAX));
    if event_ms > max_future_ms {
        return Err(WebhookStreamError::BadRequest(
            "last event id cannot be in the future".to_string(),
        ));
    }
    Ok(StreamStart::AtEvent {
        event_id: last_event_id,
    })
}

/// Webhook event stream service implementation.
pub struct WebhookEventStreamServiceImpl<F, A, R> {
    source_factory: F,
    entity_access_service: Arc<A>,
    workspace_resolver: R,
}

impl<F: Clone, A, R: Clone> Clone for WebhookEventStreamServiceImpl<F, A, R> {
    fn clone(&self) -> Self {
        Self {
            source_factory: self.source_factory.clone(),
            entity_access_service: self.entity_access_service.clone(),
            workspace_resolver: self.workspace_resolver.clone(),
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
        }
    }
}

/// Owned per-stream state advanced by the unfold loop.
struct StreamState<Src, A> {
    source: Src,
    entity_access_service: Arc<A>,
    subscriber: MacroUserIdStr<'static>,
    workspace_id: String,
    filters: WebhookFilters,
    access_cache: HashMap<String, (Instant, bool)>,
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
                Ok(self.workspace_id.as_str() == workspace_id.as_str())
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
                if self.access_cache.len() >= MAX_ACCESS_CACHE_ENTRIES {
                    self.access_cache
                        .retain(|_, (decided_at, _)| decided_at.elapsed() < ACCESS_CACHE_TTL);
                    if self.access_cache.len() >= MAX_ACCESS_CACHE_ENTRIES {
                        self.access_cache.clear();
                    }
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
            if !self.filters.iter().any(|filter| {
                filter.accepts(&candidate.event.event_name, &candidate.event.entity_id)
            }) {
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
        scope: WebhookScope,
        filters: WebhookFilters,
        last_event_id: Option<Uuid>,
    ) -> Result<BoxStream<'static, NormalizedWebhookEvent>, WebhookStreamError> {
        validate_filters(&filters)?;
        let start = stream_start(last_event_id, Utc::now().timestamp_millis())?;

        let workspace_id = match scope {
            WebhookScope::User => subscriber.as_ref().to_string(),
            WebhookScope::Team => self
                .workspace_resolver
                .resolve_workspace_ids(vec![subscriber.clone()])
                .await
                .map_err(|error| {
                    let error: anyhow::Error = error.into();
                    WebhookStreamError::Internal(rootcause::report!(
                        "failed to resolve subscriber team workspace: {error:?}"
                    ))
                })?
                .into_iter()
                .find(|workspace_id| workspace_id != subscriber.as_ref())
                .ok_or_else(|| {
                    WebhookStreamError::BadRequest(
                        "team scope requires the user to belong to a team".to_string(),
                    )
                })?,
        };

        let source = self
            .source_factory
            .open(start)
            .await
            .map_err(|error| WebhookStreamError::BadRequest(error.to_string()))?;

        let state = StreamState {
            source,
            entity_access_service: self.entity_access_service.clone(),
            subscriber,
            workspace_id,
            filters,
            access_cache: HashMap::new(),
        };
        Ok(futures::stream::unfold(state, |mut state| async move {
            state.next_delivered().await.map(|event| (event, state))
        })
        .boxed())
    }
}
