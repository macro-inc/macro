//! Webhook event ingestion: broker events in, matching queue messages out.
//!
//! `WebhookEventIngestionService` is the inbound port driven by broker
//! consumers (see `crate::inbound::kafka_consumer`). It is intentionally
//! separate from `WebhookService`, which is the CRUD surface for webhook
//! creation and edits.

#[cfg(feature = "stream")]
pub(crate) mod stream;
#[cfg(test)]
mod test;

use crate::domain::{
    events::WebhookTopicEvent,
    models::{NormalizedWebhookEvent, WebhookEventQueueMessage},
    ports::{WebhookEventEnqueuer, WebhookRepo, WebhookWorkspaceResolver},
};
use agent_session::domain::events::AgentSessionLifecycleEvent;
use agent_trigger::domain::broker_events::AgentTriggerTopicEvent;
use call::domain::notification_events::CallNotificationEvent;
use channels::domain::broker_events::ChannelTopicEvent;
use chrono::Utc;
use documents::domain::events::DocumentTopicEvent;
use entity_access::domain::models::{AccessError, EntityType};
use entity_access::domain::ports::EntityAccessService;
use futures::future::join_all;
use macro_event_broker::exposure::{Audience, Exposure, ExposureError, MinTeamRole, Stage};
use macro_event_broker::{Event, TopicEvent};
use macro_user_id::user_id::MacroUserIdStr;
use messages::outbound::broker::MessageTopicEvent;
use std::future::Future;
use std::sync::Arc;
use tracing::Instrument as _;
use user_events::UserTopicEvent;

/// Webhook event ingestion error.
#[derive(Debug, thiserror::Error)]
pub enum WebhookEventIngestionError {
    /// Failed to resolve the users with access to the event's entity.
    #[error(transparent)]
    EntityAccess(#[from] AccessError),
    /// The event's entity identifier violates the broker contract.
    #[error("invalid {entity_type} entity id: {entity_id}")]
    InvalidEntityId {
        /// Contract entity type.
        entity_type: &'static str,
        /// Invalid entity identifier.
        entity_id: String,
    },
    /// A private event, such as a call invitation, has no explicit recipient.
    #[error("private call notification has no recipient")]
    MissingCallRecipient,
    /// The broker envelope could not be represented by the queue contract.
    #[error("failed to serialize broker envelope: {0}")]
    Serialization(#[from] serde_json::Error),
    /// The event's audience has a class webhook delivery cannot resolve yet.
    #[error("unsupported webhook audience: {0}")]
    UnsupportedAudience(&'static str),
    /// Failed to resolve personal and team webhook workspaces.
    #[error("failed to resolve webhook workspaces: {0}")]
    WorkspaceResolution(#[source] anyhow::Error),
    /// Failed to find active webhooks matching the event.
    #[error("failed to match active webhooks: {0}")]
    Repository(#[source] anyhow::Error),
    /// Failed to enqueue at least one matched webhook event.
    #[error("failed to enqueue webhook event: {0}")]
    Enqueue(#[source] anyhow::Error),
}

impl From<ExposureError> for WebhookEventIngestionError {
    fn from(error: ExposureError) -> Self {
        match error {
            ExposureError::InvalidEntityId {
                entity_type,
                entity_id,
            } => Self::InvalidEntityId {
                entity_type,
                entity_id,
            },
            ExposureError::MissingRecipient => Self::MissingCallRecipient,
        }
    }
}

impl WebhookEventIngestionError {
    /// Whether retrying the same event could plausibly succeed.
    ///
    /// Access resolution classifies failures at the database boundary:
    /// [`AccessError::Unavailable`] is a connection-level or retryable
    /// Postgres failure, while [`AccessError::Internal`] is a bug or bad
    /// data that retrying cannot fix. Invalid broker contracts are
    /// permanent and can be safely skipped.
    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            Self::EntityAccess(AccessError::Unavailable(_))
                | Self::WorkspaceResolution(_)
                | Self::Repository(_)
                | Self::Enqueue(_)
        )
    }
}

/// Inbound port for ingesting broker events for webhook delivery.
///
/// One method per subscribed topic; each takes the decoded event envelope so
/// implementations retain the `event_id` and complete original payload.
pub trait WebhookEventIngestionService: Clone + Send + Sync + 'static {
    /// Ingest one `macro.documents` event envelope.
    fn ingest_document_event(
        &self,
        event: Event<DocumentTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one `macro.channels` event envelope.
    fn ingest_channel_event(
        &self,
        event: Event<ChannelTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one access-checked call notification.
    fn ingest_call_notification_event(
        &self,
        event: Event<CallNotificationEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one `macro.messages` event envelope.
    fn ingest_message_event(
        &self,
        event: Event<MessageTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one `macro.webhooks` event envelope.
    fn ingest_webhook_event(
        &self,
        event: Event<WebhookTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one `macro.agent_sessions` event envelope.
    fn ingest_agent_trigger_event(
        &self,
        event: Event<AgentTriggerTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one `macro.agent_session_lifecycle` event envelope.
    fn ingest_agent_session_lifecycle_event(
        &self,
        event: Event<AgentSessionLifecycleEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one `macro.users` event envelope.
    fn ingest_user_event(
        &self,
        event: Event<UserTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;
}

/// Webhook event ingestion service implementation.
#[derive(Clone)]
pub struct WebhookEventIngestionServiceImpl<A, R, Q> {
    entity_access_service: Arc<A>,
    repository: R,
    enqueuer: Q,
}

impl<A, R, Q> WebhookEventIngestionServiceImpl<A, R, Q> {
    /// Create a webhook event ingestion service.
    pub fn new(entity_access_service: Arc<A>, repository: R, enqueuer: Q) -> Self {
        Self {
            entity_access_service,
            repository,
            enqueuer,
        }
    }
}

impl<A, R, Q> WebhookEventIngestionServiceImpl<A, R, Q>
where
    A: EntityAccessService,
    R: WebhookRepo + WebhookWorkspaceResolver,
    Q: WebhookEventEnqueuer,
{
    /// Resolve the users that currently have access to an entity.
    #[tracing::instrument(skip(self), err)]
    pub async fn users_with_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, WebhookEventIngestionError> {
        self.entity_access_service
            .get_users_by_entity(entity_id, entity_type)
            .await
            .map_err(WebhookEventIngestionError::EntityAccess)
    }

    #[tracing::instrument(
        skip_all,
        fields(
            event_id = %event.event_id,
            event_name = %event.event_name,
            entity_type = %event.entity_type,
            entity_id = %event.entity_id,
            workspace_count = workspace_ids.len(),
            match_count = tracing::field::Empty,
        ),
        err
    )]
    async fn match_and_enqueue(
        &self,
        event: NormalizedWebhookEvent,
        workspace_ids: Vec<String>,
    ) -> Result<(), WebhookEventIngestionError> {
        let webhooks = self
            .repository
            .list_active_webhooks_matching_event(
                workspace_ids,
                event.event_name.clone(),
                event.entity_id.clone(),
            )
            .await
            .map_err(|error| WebhookEventIngestionError::Repository(error.into()))?;
        tracing::Span::current().record("match_count", webhooks.len());
        self.enqueue_all(webhooks, event).await
    }

    async fn enqueue_all(
        &self,
        webhooks: Vec<crate::domain::models::Webhook>,
        event: NormalizedWebhookEvent,
    ) -> Result<(), WebhookEventIngestionError> {
        let enqueue_results = join_all(webhooks.into_iter().map(|webhook| {
            let enqueuer = self.enqueuer.clone();
            let webhook_id = webhook.id;
            let message = WebhookEventQueueMessage::new(webhook_id.clone(), event.clone());
            async move {
                enqueuer
                    .enqueue(message)
                    .instrument(tracing::info_span!("enqueue_webhook_event", %webhook_id))
                    .await
                    .map_err(Into::into)
            }
        }))
        .await;

        for result in enqueue_results {
            result.map_err(WebhookEventIngestionError::Enqueue)?;
        }

        Ok(())
    }
}

/// Normalize one broker event for delivery from its declared exposure.
///
/// `None` when the event is internal (or still in preview): it is not
/// delivered by webhook or stream. The delivered body is the broker envelope
/// around the event's public payload, so the payload's `event_type` and
/// `metadata` sit where they always have.
pub(crate) fn normalize<E: TopicEvent>(
    event: &Event<E>,
) -> Result<Option<(NormalizedWebhookEvent, Audience)>, WebhookEventIngestionError> {
    let public = match event.event.exposure()? {
        Exposure::Public(public) => public,
        Exposure::Internal(_) => return Ok(None),
    };
    match public.stage {
        Stage::Stable => {}
        // Preview families are flag-gated by the event stream; until that
        // gate exists here, they are not delivered.
        Stage::Preview => return Ok(None),
    }
    let envelope = Event {
        event_id: event.event_id,
        agent_correlation_id: event.agent_correlation_id,
        routine_id: event.routine_id,
        agent_verb: event.agent_verb.clone(),
        schema_version: event.schema_version,
        event: public.payload.as_ref(),
    };
    let broker_envelope = serde_json::to_value(&envelope)?;
    let entity_id = public.entity.entity_id;
    let normalized = NormalizedWebhookEvent {
        event_id: event.event_id.to_string(),
        schema_version: event.schema_version,
        event_name: public.name.to_string(),
        entity_type: public.entity.entity_type.to_string(),
        ordering_key: entity_id.clone(),
        entity_id,
        occurred_at: Utc::now(),
        broker_envelope,
    };
    Ok(Some((normalized, public.audience)))
}

/// Every audience nested in `audience`, depth first, with `Any` expanded.
fn audience_members(audience: &Audience) -> Vec<&Audience> {
    match audience {
        Audience::Any(audiences) => audiences.iter().flat_map(audience_members).collect(),
        Audience::Entity { .. }
        | Audience::Recipient { .. }
        | Audience::Owner { .. }
        | Audience::Team { .. }
        | Audience::TeamsOf { .. }
        | Audience::ContactsOf { .. }
        | Audience::GithubInstallation { .. }
        | Audience::Workspace { .. }
        | Audience::Snapshot { .. } => vec![audience],
    }
}

/// The webhook workspaces an audience reaches.
///
/// People reached through access (entity accessors, owners, a user whose
/// contacts or teams are the audience) expand to their personal and team
/// workspaces in one resolution. Addressed people and workspaces match
/// exactly, with no team expansion. Webhooks cannot enumerate contacts, so
/// `ContactsOf` reaches only the user's own workspaces.
#[derive(Default)]
struct WorkspaceAudience {
    /// Whether any member needs workspace resolution, even with no people.
    resolve: bool,
    /// People to resolve into personal and team workspaces, in order.
    people: Vec<MacroUserIdStr<'static>>,
    /// Workspaces matched exactly.
    exact: Vec<String>,
}

impl WorkspaceAudience {
    fn add_person(&mut self, person: &MacroUserIdStr<'static>) {
        self.resolve = true;
        if !self.people.contains(person) {
            self.people.push(person.clone());
        }
    }
}

impl<A, R, Q> WebhookEventIngestionServiceImpl<A, R, Q>
where
    A: EntityAccessService,
    R: WebhookRepo + WebhookWorkspaceResolver,
    Q: WebhookEventEnqueuer,
{
    /// Normalize one event and enqueue it for every matching webhook its
    /// audience reaches.
    async fn ingest<E: TopicEvent>(
        &self,
        event: &Event<E>,
    ) -> Result<(), WebhookEventIngestionError> {
        let Some((normalized, audience)) = normalize(event)? else {
            return Ok(());
        };
        self.resolve_audience_and_enqueue(normalized, &audience)
            .await
    }

    #[tracing::instrument(
        skip_all,
        fields(
            event_id = %event.event_id,
            event_name = %event.event_name,
            entity_type = %event.entity_type,
            entity_id = %event.entity_id,
            accessor_count = tracing::field::Empty,
            workspace_count = tracing::field::Empty,
        ),
        err
    )]
    async fn resolve_audience_and_enqueue(
        &self,
        event: NormalizedWebhookEvent,
        audience: &Audience,
    ) -> Result<(), WebhookEventIngestionError> {
        let mut workspaces = WorkspaceAudience::default();
        for member in audience_members(audience) {
            match member {
                Audience::Entity {
                    entity_type,
                    entity_id,
                } => {
                    workspaces.resolve = true;
                    for accessor in self.users_with_access(entity_id, *entity_type).await? {
                        workspaces.add_person(&accessor);
                    }
                }
                Audience::Owner { user_id }
                | Audience::TeamsOf { user_id }
                | Audience::ContactsOf { user_id } => workspaces.add_person(user_id),
                Audience::Recipient { user_id } => workspaces.exact.push(user_id.to_string()),
                Audience::Snapshot { user_ids } => workspaces
                    .exact
                    .extend(user_ids.iter().map(ToString::to_string)),
                Audience::Workspace { workspace_id } => {
                    workspaces.exact.push(workspace_id.clone());
                }
                Audience::Team {
                    team_id,
                    min_role: MinTeamRole::Member,
                } => workspaces.exact.push(team_id.to_string()),
                Audience::Team {
                    min_role: MinTeamRole::Admin,
                    ..
                } => {
                    return Err(WebhookEventIngestionError::UnsupportedAudience(
                        "team admins",
                    ));
                }
                Audience::GithubInstallation { .. } => {
                    return Err(WebhookEventIngestionError::UnsupportedAudience(
                        "GitHub installation",
                    ));
                }
                Audience::Any(_) => {
                    return Err(WebhookEventIngestionError::UnsupportedAudience(
                        "unflattened union",
                    ));
                }
            }
        }
        tracing::Span::current().record("accessor_count", workspaces.people.len());

        let mut workspace_ids = if workspaces.resolve {
            self.repository
                .resolve_workspace_ids(workspaces.people)
                .await
                .map_err(|error| WebhookEventIngestionError::WorkspaceResolution(error.into()))?
        } else {
            Vec::new()
        };
        workspace_ids.extend(workspaces.exact);
        tracing::Span::current().record("workspace_count", workspace_ids.len());

        self.match_and_enqueue(event, workspace_ids).await
    }
}

impl<A, R, Q> WebhookEventIngestionService for WebhookEventIngestionServiceImpl<A, R, Q>
where
    A: EntityAccessService,
    R: WebhookRepo + WebhookWorkspaceResolver,
    Q: WebhookEventEnqueuer,
{
    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_document_event(
        &self,
        event: Event<DocumentTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest(&event).await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_channel_event(
        &self,
        event: Event<ChannelTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest(&event).await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_call_notification_event(
        &self,
        event: Event<CallNotificationEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest(&event).await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_message_event(
        &self,
        event: Event<MessageTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest(&event).await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_webhook_event(
        &self,
        event: Event<WebhookTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest(&event).await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_agent_trigger_event(
        &self,
        event: Event<AgentTriggerTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest(&event).await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_agent_session_lifecycle_event(
        &self,
        event: Event<AgentSessionLifecycleEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest(&event).await
    }

    #[tracing::instrument(
        name = "webhook.ingest_user_event",
        skip(self, event),
        fields(event_id = %event.event_id),
        err
    )]
    async fn ingest_user_event(
        &self,
        event: Event<UserTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest(&event).await
    }
}
