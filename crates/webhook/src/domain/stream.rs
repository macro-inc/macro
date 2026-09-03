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
//! Delivery is best-effort through a process-local broadcast channel. Slow or
//! disconnected subscribers may miss events and must resync out of band when
//! continuity matters.

#[cfg(test)]
mod test;

use crate::domain::models::{NormalizedWebhookEvent, WebhookFilters, WebhookScope};
use crate::domain::ports::WebhookWorkspaceResolver;
use entity_access::domain::models::{AccessError, EntityType};
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
struct StreamState<A, R> {
    receiver: broadcast::Receiver<StreamCandidateEvent>,
    entity_access_service: Arc<A>,
    workspace_resolver: R,
    subscriber: MacroUserIdStr<'static>,
    scope: WebhookScope,
    filters: WebhookFilters,
}

impl<A, R> StreamState<A, R>
where
    A: EntityAccessService,
    R: WebhookWorkspaceResolver,
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

        let state = StreamState {
            receiver: self.sender.subscribe(),
            entity_access_service: self.entity_access_service.clone(),
            workspace_resolver: self.workspace_resolver.clone(),
            subscriber,
            scope,
            filters,
        };
        Ok(futures::stream::unfold(state, |mut state| async move {
            state.next_delivered().await.map(|event| (event, state))
        })
        .boxed())
    }
}
