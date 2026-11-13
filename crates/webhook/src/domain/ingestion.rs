//! Webhook event ingestion: broker events in, matching queue messages out.
//!
//! `WebhookEventIngestionService` is the inbound port driven by broker
//! consumers (see `crate::inbound::kafka_consumer`). It is intentionally
//! separate from `WebhookService`, which is the CRUD surface for webhook
//! creation and edits.

#[cfg(test)]
mod test;

use crate::domain::{
    events::WebhookTopicEvent,
    models::{NormalizedWebhookEvent, WebhookEventQueueMessage},
    ports::{WebhookEventEnqueuer, WebhookInterest, WebhookRepo, WebhookWorkspaceResolver},
};
use agent_session::domain::events::AgentSessionLifecycleEvent;
use agent_trigger::domain::broker_events::AgentTriggerTopicEvent;
use call::domain::notification_events::CallNotificationEvent;
use channels::domain::broker_events::ChannelTopicEvent;
use documents::domain::events::DocumentTopicEvent;
use entity_access::domain::models::{AccessError, AccessLevel, EntityType};
use entity_access::domain::ports::EntityAccessService;
use event_stream::domain::filters::{self, FilterSubject};
use event_stream::domain::normalize::NormalizeError;
use event_stream::domain::ports::{
    GithubClaims, InstallationOwners, PreviewFlag, TeamDirectory, TeamRole,
};
use futures::future::join_all;
use macro_event_broker::exposure::{Audience, ExposureError, MinAccessLevel, MinTeamRole, Stage};
use macro_event_broker::{Event, TopicEvent};
use macro_user_id::user_id::MacroUserIdStr;
use messages::outbound::broker::MessageTopicEvent;
use std::future::Future;
use std::sync::Arc;
use tracing::Instrument as _;
use user_events::UserTopicEvent;
use uuid::Uuid;

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
    #[error("private event has no recipient")]
    MissingCallRecipient,
    /// The broker envelope could not be represented by the queue contract.
    #[error("failed to serialize broker envelope: {0}")]
    Serialization(#[from] serde_json::Error),
    /// The event is declared public under a name the event catalog does not
    /// register.
    #[error("public event `{0}` is not registered in the event catalog")]
    Unregistered(&'static str),
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

    /// Ingest one event of any other public topic. A family that turns
    /// public adds its topic to `event_stream::topics::DeclaredMacroEvent`
    /// and one arm calling this in `inbound::kafka_consumer`.
    fn ingest_public_event<E: TopicEvent>(
        &self,
        event: Event<E>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;
}

/// Webhook event ingestion service implementation.
///
/// `P` evaluates the `public-event-stream` flag for a webhook's owner:
/// preview events, and filters matched only through a wildcard, reach a
/// webhook only when its owner has the flag. Without one ([`NoPreview`]) no
/// owner has it, which is how every webhook behaved before the flag.
///
/// `T` and `G` resolve team-admin and GitHub-installation audiences. Without
/// them ([`Unconfigured`]) those audiences are refused as unsupported.
pub struct WebhookEventIngestionServiceImpl<
    A,
    R,
    Q,
    P = NoPreview,
    T = Unconfigured,
    G = Unconfigured,
    I = AlwaysInterested,
> {
    entity_access_service: Arc<A>,
    repository: R,
    enqueuer: Q,
    preview: Arc<P>,
    teams: Option<Arc<T>>,
    github: Option<Arc<G>>,
    interest: Arc<I>,
}

impl<A, R: Clone, Q: Clone, P, T, G, I> Clone
    for WebhookEventIngestionServiceImpl<A, R, Q, P, T, G, I>
{
    fn clone(&self) -> Self {
        Self {
            entity_access_service: self.entity_access_service.clone(),
            repository: self.repository.clone(),
            enqueuer: self.enqueuer.clone(),
            preview: self.preview.clone(),
            teams: self.teams.clone(),
            github: self.github.clone(),
            interest: self.interest.clone(),
        }
    }
}

/// A [`WebhookInterest`] that assumes some webhook may want every event, so
/// every audience is resolved.
#[derive(Debug, Clone, Copy, Default)]
pub struct AlwaysInterested;

impl WebhookInterest for AlwaysInterested {
    type Err = std::convert::Infallible;

    async fn any_webhook_names(&self, _event_name: &str) -> Result<bool, Self::Err> {
        Ok(true)
    }
}

/// Audience directories that are not configured.
#[derive(Debug, Clone, Copy, Default)]
pub struct Unconfigured;

impl TeamDirectory for Unconfigured {
    async fn members(
        &self,
        _team_id: Uuid,
    ) -> Result<Vec<(MacroUserIdStr<'static>, TeamRole)>, rootcause::Report> {
        Err(rootcause::report!("team directory not configured"))
    }

    async fn teams_of(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<(Uuid, TeamRole)>, rootcause::Report> {
        Err(rootcause::report!("team directory not configured"))
    }
}

impl GithubClaims for Unconfigured {
    async fn claimants(
        &self,
        _users: &[MacroUserIdStr<'static>],
        _installation_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        Err(rootcause::report!("GitHub claims not configured"))
    }

    async fn installation_owners(
        &self,
        _installation_id: &str,
    ) -> Result<InstallationOwners, rootcause::Report> {
        Err(rootcause::report!("GitHub claims not configured"))
    }

    async fn has_claim(
        &self,
        _user: &MacroUserIdStr<'static>,
        _installation_id: &str,
    ) -> Result<bool, rootcause::Report> {
        Err(rootcause::report!("GitHub claims not configured"))
    }
}

/// A [`PreviewFlag`] no user has.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoPreview;

impl PreviewFlag for NoPreview {
    async fn enabled_for(&self, _user: &MacroUserIdStr<'static>) -> bool {
        false
    }
}

impl<A, R, Q> WebhookEventIngestionServiceImpl<A, R, Q> {
    /// Create a webhook event ingestion service with no preview access and
    /// no team or GitHub directories.
    pub fn new(entity_access_service: Arc<A>, repository: R, enqueuer: Q) -> Self {
        Self {
            entity_access_service,
            repository,
            enqueuer,
            preview: Arc::new(NoPreview),
            teams: None,
            github: None,
            interest: Arc::new(AlwaysInterested),
        }
    }
}

impl<A, R, Q, P, T, G, I> WebhookEventIngestionServiceImpl<A, R, Q, P, T, G, I> {
    /// Evaluate the `public-event-stream` flag for webhook owners with
    /// `preview`.
    pub fn with_preview_flag<P2>(
        self,
        preview: Arc<P2>,
    ) -> WebhookEventIngestionServiceImpl<A, R, Q, P2, T, G, I> {
        WebhookEventIngestionServiceImpl {
            entity_access_service: self.entity_access_service,
            repository: self.repository,
            enqueuer: self.enqueuer,
            preview,
            teams: self.teams,
            github: self.github,
            interest: self.interest,
        }
    }

    /// Resolve team-admin audiences through `teams` and GitHub-installation
    /// audiences through `github`.
    pub fn with_audience_directories<T2, G2>(
        self,
        teams: Arc<T2>,
        github: Arc<G2>,
    ) -> WebhookEventIngestionServiceImpl<A, R, Q, P, T2, G2, I> {
        WebhookEventIngestionServiceImpl {
            entity_access_service: self.entity_access_service,
            repository: self.repository,
            enqueuer: self.enqueuer,
            preview: self.preview,
            teams: Some(teams),
            github: Some(github),
            interest: self.interest,
        }
    }

    /// Skip events no webhook's filters name, asking `interest` before any
    /// audience is resolved.
    pub fn with_interest<I2>(
        self,
        interest: Arc<I2>,
    ) -> WebhookEventIngestionServiceImpl<A, R, Q, P, T, G, I2> {
        WebhookEventIngestionServiceImpl {
            entity_access_service: self.entity_access_service,
            repository: self.repository,
            enqueuer: self.enqueuer,
            preview: self.preview,
            teams: self.teams,
            github: self.github,
            interest,
        }
    }
}

impl<A, R, Q, P, T, G, I> WebhookEventIngestionServiceImpl<A, R, Q, P, T, G, I>
where
    A: EntityAccessService,
    R: WebhookRepo + WebhookWorkspaceResolver,
    Q: WebhookEventEnqueuer,
    P: PreviewFlag,
    T: TeamDirectory,
    G: GithubClaims,
    I: WebhookInterest,
{
    /// Resolve the users that currently have access to an entity, uncached.
    #[tracing::instrument(skip(self), err)]
    pub async fn users_with_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, WebhookEventIngestionError> {
        // Uncached: a grant or revocation just before the event must count,
        // not a listing cached for up to 10 s.
        self.entity_access_service
            .get_users_by_entity_uncached(entity_id, entity_type)
            .await
            .map_err(WebhookEventIngestionError::EntityAccess)
    }

    /// Admin-only team events reach the personal workspaces of the team's
    /// current admins and owners, never the team workspace: a team webhook's
    /// creator need not be an admin.
    #[tracing::instrument(skip(self), err)]
    async fn team_admins(
        &self,
        team_id: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, WebhookEventIngestionError> {
        let Some(teams) = &self.teams else {
            return Err(WebhookEventIngestionError::UnsupportedAudience(
                "team admins",
            ));
        };
        let members = teams.members(team_id).await.map_err(directory_error)?;
        Ok(members
            .into_iter()
            .filter(|(_, role)| *role >= TeamRole::Admin)
            .map(|(user, _)| user)
            .collect())
    }

    /// A GitHub installation's events reach, as the live stream does, the
    /// users who hold a claim on it (owners with a linked GitHub account, by
    /// the routines' rule): their personal workspaces, plus the workspaces of
    /// the teams that own it.
    #[tracing::instrument(skip(self), err)]
    async fn installation_workspaces(
        &self,
        installation_id: &str,
    ) -> Result<Vec<String>, WebhookEventIngestionError> {
        let (Some(teams), Some(github)) = (&self.teams, &self.github) else {
            return Err(WebhookEventIngestionError::UnsupportedAudience(
                "GitHub installation",
            ));
        };
        let owners = github
            .installation_owners(installation_id)
            .await
            .map_err(directory_error)?;

        let mut candidates = owners.users.clone();
        for team_id in &owners.teams {
            let members = teams.members(*team_id).await.map_err(directory_error)?;
            candidates.extend(members.into_iter().map(|(user, _)| user));
        }
        candidates.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));
        candidates.dedup();

        let mut workspaces: Vec<String> = owners.teams.iter().map(ToString::to_string).collect();
        let claimants = github
            .claimants(&candidates, installation_id)
            .await
            .map_err(directory_error)?;
        workspaces.extend(claimants.iter().map(ToString::to_string));
        Ok(workspaces)
    }

    /// The explicit accessors whose access level is at least `min_level`:
    /// the accessor set (no link viewers), then each one's level.
    #[tracing::instrument(skip(self), err)]
    async fn accessors_at_least(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        min_level: MinAccessLevel,
    ) -> Result<Vec<MacroUserIdStr<'static>>, WebhookEventIngestionError> {
        let floor = match min_level {
            MinAccessLevel::Comment => AccessLevel::Comment,
            MinAccessLevel::Edit => AccessLevel::Edit,
            MinAccessLevel::Owner => AccessLevel::Owner,
        };
        // One set-based read over the grants, uncached, not a level lookup
        // per accessor.
        self.entity_access_service
            .get_users_by_entity_at_least(entity_id, entity_type, floor)
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
        stage: Stage,
        workspace_ids: Vec<String>,
    ) -> Result<(), WebhookEventIngestionError> {
        let candidates = self
            .repository
            .list_active_webhooks_matching_event(
                workspace_ids,
                event.event_name.clone(),
                event.entity_id.clone(),
            )
            .await
            .map_err(|error| WebhookEventIngestionError::Repository(error.into()))?;
        let webhooks = self.admitted_webhooks(candidates, &event, stage).await;
        tracing::Span::current().record("match_count", webhooks.len());
        self.enqueue_all(webhooks, event).await
    }

    /// The webhooks whose filters accept the event once the owner's flag is
    /// known: a preview event, or a filter that matches only through a
    /// wildcard, needs the owner to have `public-event-stream`. Every other
    /// match stands as before.
    async fn admitted_webhooks(
        &self,
        candidates: Vec<crate::domain::models::Webhook>,
        event: &NormalizedWebhookEvent,
        stage: Stage,
    ) -> Vec<crate::domain::models::Webhook> {
        let subject = FilterSubject {
            event_name: &event.event_name,
            entity_type: &event.entity_type,
            entity_id: &event.entity_id,
        };
        let mut admitted = Vec::with_capacity(candidates.len());
        for webhook in candidates {
            // The repository matched exact names and ids. Only wildcards,
            // entity types and preview events need deciding here.
            let decided_by_repository = stage == Stage::Stable
                && webhook
                    .filters
                    .iter()
                    .all(|filter| !filter.uses_wildcards() && filter.entity_types.is_none());
            if decided_by_repository
                || (stage == Stage::Stable
                    && filters::any_accepts(&webhook.filters, subject, false))
            {
                admitted.push(webhook);
                continue;
            }
            let owner_flagged = match MacroUserIdStr::try_from(webhook.created_by_user_id.clone()) {
                Ok(owner) => self.preview.enabled_for(&owner).await,
                Err(_) => false,
            };
            if owner_flagged && filters::any_accepts(&webhook.filters, subject, true) {
                admitted.push(webhook);
            }
        }
        admitted
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

/// Normalize one broker event for webhook delivery from its declared
/// exposure, through the normalization live streams share.
///
/// `None` when the event is internal. Preview events are returned with their
/// stage; matching admits them only for flagged webhook owners.
#[cfg(test)]
pub(crate) fn normalize<E: TopicEvent>(
    event: &Event<E>,
) -> Result<Option<(NormalizedWebhookEvent, Audience)>, WebhookEventIngestionError> {
    Ok(normalize_staged(event)?.map(|(event, audience, _)| (event, audience)))
}

/// [`normalize`], with the event's rollout stage.
fn normalize_staged<E: TopicEvent>(
    event: &Event<E>,
) -> Result<Option<(NormalizedWebhookEvent, Audience, Stage)>, WebhookEventIngestionError> {
    let public = match event_stream::domain::normalize::normalize(event) {
        Ok(Some(public)) => public,
        Ok(None) => return Ok(None),
        Err(NormalizeError::Exposure(error)) => return Err(error.into()),
        Err(NormalizeError::Serialization(error)) => return Err(error.into()),
        Err(NormalizeError::Unregistered(name)) => {
            return Err(WebhookEventIngestionError::Unregistered(name));
        }
    };
    Ok(Some((public.event, public.audience, public.stage)))
}

fn directory_error(report: rootcause::Report) -> WebhookEventIngestionError {
    WebhookEventIngestionError::WorkspaceResolution(anyhow::anyhow!("{report:?}"))
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
        | Audience::EntityAtLeast { .. }
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

impl<A, R, Q, P, T, G, I> WebhookEventIngestionServiceImpl<A, R, Q, P, T, G, I>
where
    A: EntityAccessService,
    R: WebhookRepo + WebhookWorkspaceResolver,
    Q: WebhookEventEnqueuer,
    P: PreviewFlag,
    T: TeamDirectory,
    G: GithubClaims,
    I: WebhookInterest,
{
    /// Normalize one event and enqueue it for every matching webhook its
    /// audience reaches.
    async fn ingest<E: TopicEvent>(
        &self,
        event: &Event<E>,
    ) -> Result<(), WebhookEventIngestionError> {
        let Some((normalized, audience, stage)) = normalize_staged(event)? else {
            return Ok(());
        };
        // Resolving an audience costs access lookups; an event no webhook
        // names anywhere cannot match, whoever its audience is.
        let wanted = self
            .interest
            .any_webhook_names(&normalized.event_name)
            .await
            .map_err(|error| WebhookEventIngestionError::Repository(error.into()))?;
        if !wanted {
            return Ok(());
        }
        self.resolve_audience_and_enqueue(normalized, stage, &audience)
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
        stage: Stage,
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
                    team_id,
                    min_role: MinTeamRole::Admin,
                } => {
                    workspaces.exact.extend(
                        self.team_admins(*team_id)
                            .await?
                            .into_iter()
                            .map(|admin| admin.to_string()),
                    );
                }
                Audience::EntityAtLeast {
                    entity_type,
                    entity_id,
                    min_level,
                } => {
                    workspaces.resolve = true;
                    for accessor in self
                        .accessors_at_least(entity_id, *entity_type, *min_level)
                        .await?
                    {
                        workspaces.add_person(&accessor);
                    }
                }
                Audience::GithubInstallation { installation_id } => {
                    workspaces
                        .exact
                        .extend(self.installation_workspaces(installation_id).await?);
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

        self.match_and_enqueue(event, stage, workspace_ids).await
    }
}

impl<A, R, Q, P, T, G, I> WebhookEventIngestionService
    for WebhookEventIngestionServiceImpl<A, R, Q, P, T, G, I>
where
    A: EntityAccessService,
    R: WebhookRepo + WebhookWorkspaceResolver,
    Q: WebhookEventEnqueuer,
    P: PreviewFlag,
    T: TeamDirectory,
    G: GithubClaims,
    I: WebhookInterest,
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

    #[tracing::instrument(
        name = "webhook.ingest_public_event",
        skip(self, event),
        fields(event_id = %event.event_id),
        err
    )]
    async fn ingest_public_event<E: TopicEvent>(
        &self,
        event: Event<E>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest(&event).await
    }
}
