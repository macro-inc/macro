//! Live webhook event streaming: broker events in, per-subscriber SSE out.
//!
//! `WebhookEventStreamService` is the inbound port driven by the SSE handler
//! in `crate::inbound::stream_router`. Unlike ingestion — which matches
//! persisted webhook subscriptions and enqueues durable deliveries — a stream
//! is ephemeral: the caller supplies [`WebhookFilters`] on the request, each
//! candidate event is checked against the caller's own entity access, and
//! nothing is persisted.
//!
//! Delivery is best-effort through a process-local broadcast channel. Slow or
//! disconnected subscribers may miss events and must resync out of band when
//! continuity matters.

#[cfg(test)]
mod test;

use crate::domain::models::{NormalizedWebhookEvent, WebhookFilters, WebhookScope};
use crate::domain::ports::WebhookWorkspaceResolver;
use entity_access::domain::models::EntityType;
use entity_access::domain::ports::EntityAccessService;
use futures::StreamExt as _;
use futures::stream::BoxStream;
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Number of events retained for each active subscriber before it starts
/// missing events.
pub const WEBHOOK_STREAM_CHANNEL_CAPACITY: usize = 1_024;

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
    ///
    fn open_stream(
        &self,
        subscriber: MacroUserIdStr<'static>,
        scope: WebhookScope,
        filters: WebhookFilters,
    ) -> impl Future<Output = Result<BoxStream<'static, NormalizedWebhookEvent>, WebhookStreamError>>
    + Send;
}

/// Webhook event stream service implementation.
pub struct WebhookEventStreamServiceImpl<A, R> {
    sender: broadcast::Sender<StreamCandidateEvent>,
    entity_access_service: Arc<A>,
    workspace_resolver: R,
}

impl<A, R: Clone> Clone for WebhookEventStreamServiceImpl<A, R> {
    fn clone(&self) -> Self {
        Self {
            sender: self.sender.clone(),
            entity_access_service: self.entity_access_service.clone(),
            workspace_resolver: self.workspace_resolver.clone(),
        }
    }
}

impl<A, R> WebhookEventStreamServiceImpl<A, R> {
    /// Create a webhook event stream service.
    pub fn new(
        sender: broadcast::Sender<StreamCandidateEvent>,
        entity_access_service: Arc<A>,
        workspace_resolver: R,
    ) -> Self {
        Self {
            sender,
            entity_access_service,
            workspace_resolver,
        }
    }
}

/// Owned per-stream state advanced by the unfold loop.
struct StreamState<A> {
    receiver: broadcast::Receiver<StreamCandidateEvent>,
    entity_access_service: Arc<A>,
    subscriber: MacroUserIdStr<'static>,
    workspace_id: String,
    filters: WebhookFilters,
}

impl<A> StreamState<A>
where
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
            } => Ok(self
                .entity_access_service
                .get_access_level(Some(&self.subscriber), entity_id, *entity_type)
                .await
                .map_err(|error| rootcause::report!(error))?
                .is_some()),
        }
    }

    /// Await the next event that matches the filters and passes access.
    ///
    /// Returns `None` when the channel closes or an access check fails.
    async fn next_delivered(&mut self) -> Option<NormalizedWebhookEvent> {
        loop {
            let candidate = match self.receiver.recv().await {
                Ok(candidate) => candidate,
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

impl<A, R> WebhookEventStreamService for WebhookEventStreamServiceImpl<A, R>
where
    A: EntityAccessService,
    R: WebhookWorkspaceResolver,
{
    #[tracing::instrument(skip(self, filters), fields(filter_count = filters.len()))]
    async fn open_stream(
        &self,
        subscriber: MacroUserIdStr<'static>,
        scope: WebhookScope,
        filters: WebhookFilters,
    ) -> Result<BoxStream<'static, NormalizedWebhookEvent>, WebhookStreamError> {
        validate_filters(&filters)?;

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

        let state = StreamState {
            receiver: self.sender.subscribe(),
            entity_access_service: self.entity_access_service.clone(),
            subscriber,
            workspace_id,
            filters,
        };
        Ok(futures::stream::unfold(state, |mut state| async move {
            state.next_delivered().await.map(|event| (event, state))
        })
        .boxed())
    }
}
