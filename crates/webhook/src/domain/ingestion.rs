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
    ports::{WebhookEventEnqueuer, WebhookInterest, WebhookRepo},
};
use agent_session::domain::events::AgentSessionLifecycleEvent;
use agent_trigger::domain::broker_events::AgentTriggerTopicEvent;
use call::domain::notification_events::CallNotificationEvent;
use channels::domain::broker_events::ChannelTopicEvent;
use documents::domain::events::DocumentTopicEvent;
use entity_access::domain::models::{AccessError, AccessLevel, EntityType};
use entity_access::domain::ports::{EntityAccessService, EntityTeamAccess};
use event_stream::domain::filters::{self, FilterSubject, WildcardSupport};
use event_stream::domain::normalize::NormalizeError;
use event_stream::domain::ports::{
    GithubClaims, InstallationOwners, PreviewFlag, TeamDirectory, TeamRole,
};
use futures::future::join_all;
use macro_event_broker::access::{
    AccessError as EventAccessError, Audience, MinAccessLevel, MinTeamRole, Stage,
};
use macro_event_broker::{Event, TopicEvent};
use macro_user_id::user_id::MacroUserIdStr;
use messages::outbound::broker::MessageTopicEvent;
use std::collections::{BTreeSet, HashMap, HashSet};
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

impl From<EventAccessError> for WebhookEventIngestionError {
    fn from(error: EventAccessError) -> Self {
        match error {
            EventAccessError::InvalidEntityId {
                entity_type,
                entity_id,
            } => Self::InvalidEntityId {
                entity_type,
                entity_id,
            },
            EventAccessError::MissingRecipient => Self::MissingCallRecipient,
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

    /// Resolve team-admin audiences, and whether a team webhook's creator is
    /// still a member, through `teams`, and GitHub-installation audiences
    /// through `github`. Without `teams`, team workspace webhooks match
    /// nothing.
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
    A: EntityAccessService + EntityTeamAccess,
    R: WebhookRepo,
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

    /// The teams that hold access to an entity themselves, uncached: their
    /// team workspaces receive its events. A member's own access never
    /// reaches a team workspace.
    #[tracing::instrument(skip(self), err)]
    async fn teams_with_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        min_level: Option<AccessLevel>,
    ) -> Result<Vec<Uuid>, WebhookEventIngestionError> {
        self.entity_access_service
            .get_teams_by_entity(entity_id, entity_type, min_level)
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
    ) -> Result<(Vec<String>, Vec<String>), WebhookEventIngestionError> {
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

        let claimants = github
            .claimants(&candidates, installation_id)
            .await
            .map_err(directory_error)?;
        Ok((
            claimants.iter().map(ToString::to_string).collect(),
            owners.teams.iter().map(ToString::to_string).collect(),
        ))
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
        // One set-based read over the grants, uncached, not a level lookup
        // per accessor.
        self.entity_access_service
            .get_users_by_entity_at_least(entity_id, entity_type, access_level(min_level))
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
        claim_gates: &[ClaimGate],
        crm_gates: &[CrmGate],
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
        let webhooks = self.claim_gated(webhooks, claim_gates).await?;
        let webhooks = self.creator_member_gated(webhooks).await?;
        let webhooks = self.crm_gated(webhooks, crm_gates).await?;
        tracing::Span::current().record("match_count", webhooks.len());
        self.enqueue_all(webhooks, event).await
    }

    /// A team workspace's webhook delivers to whatever endpoint its creator
    /// configured, so it is admitted only while that creator is a member of
    /// the team: one member read per team among the candidates. Personal
    /// workspaces (user ids, never UUIDs) are not gated here.
    async fn creator_member_gated(
        &self,
        webhooks: Vec<crate::domain::models::Webhook>,
    ) -> Result<Vec<crate::domain::models::Webhook>, WebhookEventIngestionError> {
        let team_ids: BTreeSet<Uuid> = webhooks.iter().filter_map(team_workspace).collect();
        if team_ids.is_empty() {
            return Ok(webhooks);
        }
        let Some(teams) = &self.teams else {
            // Without a team directory no membership can be confirmed: team
            // webhooks get nothing rather than everything.
            tracing::error!(
                team_count = team_ids.len(),
                "no team directory configured; dropping team workspace webhooks"
            );
            return Ok(webhooks
                .into_iter()
                .filter(|webhook| team_workspace(webhook).is_none())
                .collect());
        };
        let mut members: HashMap<Uuid, HashSet<String>> = HashMap::with_capacity(team_ids.len());
        for team_id in team_ids {
            let team_members = teams.members(team_id).await.map_err(directory_error)?;
            members.insert(
                team_id,
                team_members
                    .into_iter()
                    .map(|(user, _)| user.as_ref().to_ascii_lowercase())
                    .collect(),
            );
        }
        Ok(webhooks
            .into_iter()
            .filter(|webhook| match team_workspace(webhook) {
                Some(team_id) => members.get(&team_id).is_some_and(|members| {
                    members.contains(&webhook.created_by_user_id.to_ascii_lowercase())
                }),
                None => true,
            })
            .collect())
    }

    /// Drop the webhooks of a team workspace reached through a CRM record
    /// whose creator may not see that record as a member of the team (no CRM
    /// access, or a hidden record and no admin role): one batched read per
    /// gate.
    async fn crm_gated(
        &self,
        webhooks: Vec<crate::domain::models::Webhook>,
        crm_gates: &[CrmGate],
    ) -> Result<Vec<crate::domain::models::Webhook>, WebhookEventIngestionError> {
        let mut admitted = webhooks;
        for gate in crm_gates {
            let creators: Vec<MacroUserIdStr<'static>> = admitted
                .iter()
                .filter(|webhook| webhook.workspace_id == gate.workspace_id)
                .filter_map(|webhook| {
                    MacroUserIdStr::try_from(webhook.created_by_user_id.clone()).ok()
                })
                .collect();
            if creators.is_empty() {
                continue;
            }
            let viewers = self
                .entity_access_service
                .get_team_crm_viewers(&gate.entity_id, gate.entity_type, gate.team_id, &creators)
                .await
                .map_err(WebhookEventIngestionError::EntityAccess)?;
            admitted.retain(|webhook| {
                webhook.workspace_id != gate.workspace_id
                    || viewers.iter().any(|viewer| {
                        viewer
                            .as_ref()
                            .eq_ignore_ascii_case(&webhook.created_by_user_id)
                    })
            });
        }
        Ok(admitted)
    }

    /// Drop webhooks in an installation's owning team workspaces whose
    /// creator holds no claim on it (one batched claim query per gate).
    async fn claim_gated(
        &self,
        webhooks: Vec<crate::domain::models::Webhook>,
        claim_gates: &[ClaimGate],
    ) -> Result<Vec<crate::domain::models::Webhook>, WebhookEventIngestionError> {
        let Some(github) = &self.github else {
            return Ok(webhooks);
        };
        let mut admitted = webhooks;
        for gate in claim_gates {
            let creators: Vec<MacroUserIdStr<'static>> = admitted
                .iter()
                .filter(|webhook| gate.team_workspaces.contains(&webhook.workspace_id))
                .filter_map(|webhook| {
                    MacroUserIdStr::try_from(webhook.created_by_user_id.clone()).ok()
                })
                .collect();
            if creators.is_empty() {
                continue;
            }
            let claimants = github
                .claimants(&creators, &gate.installation_id)
                .await
                .map_err(directory_error)?;
            admitted.retain(|webhook| {
                !gate.team_workspaces.contains(&webhook.workspace_id)
                    || claimants
                        .iter()
                        .any(|claimant| claimant.as_ref() == webhook.created_by_user_id)
            });
        }
        Ok(admitted)
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
                    && filters::any_accepts(&webhook.filters, subject, WildcardSupport::None))
            {
                admitted.push(webhook);
                continue;
            }
            let owner_flagged = match MacroUserIdStr::try_from(webhook.created_by_user_id.clone()) {
                Ok(owner) => self.preview.enabled_for(&owner).await,
                Err(_) => false,
            };
            if owner_flagged
                && filters::any_accepts(&webhook.filters, subject, WildcardSupport::Full)
            {
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
/// access, through the normalization live streams share.
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
        Err(NormalizeError::Access(error)) => return Err(error.into()),
        Err(NormalizeError::Serialization(error)) => return Err(error.into()),
        Err(NormalizeError::Unregistered(name)) => {
            return Err(WebhookEventIngestionError::Unregistered(name));
        }
    };
    Ok(Some((public.event, public.audience, public.stage)))
}

/// The team a webhook's workspace is, when it is a team workspace (a team
/// id); personal workspaces are user ids.
fn team_workspace(webhook: &crate::domain::models::Webhook) -> Option<Uuid> {
    Uuid::parse_str(&webhook.workspace_id).ok()
}

/// The access level an [`MinAccessLevel`] floor names.
fn access_level(min_level: MinAccessLevel) -> AccessLevel {
    match min_level {
        MinAccessLevel::Comment => AccessLevel::Comment,
        MinAccessLevel::Edit => AccessLevel::Edit,
        MinAccessLevel::Owner => AccessLevel::Owner,
    }
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
        | Audience::Person { .. }
        | Audience::Snapshot { .. } => vec![audience],
    }
}

/// The webhook workspaces an audience reaches.
///
/// A person's workspace is their personal one (their user id). A team
/// workspace (the team id) is reached only through the team itself: an
/// entity granted to the team (`EntityTeamAccess`), a team audience, a named
/// workspace, or a GitHub installation the team owns. A member's own access
/// never reaches their teams' webhooks. Webhooks cannot enumerate contacts,
/// so `ContactsOf` reaches only the user's personal workspace.
#[derive(Default)]
struct WorkspaceAudience {
    /// Workspace ids, in order, without duplicates.
    workspace_ids: Vec<String>,
    /// People reached through an entity's access, for the span.
    accessor_count: usize,
    /// Team workspaces reached through a CRM record the team holds.
    crm_teams: Vec<CrmGate>,
    /// Team workspaces reached some other way, which no CRM gate narrows.
    ungated_teams: HashSet<String>,
}

impl WorkspaceAudience {
    fn add(&mut self, workspace_id: String) {
        if !self.workspace_ids.contains(&workspace_id) {
            self.workspace_ids.push(workspace_id);
        }
    }

    /// A workspace the audience names outright (a team, a workspace, an
    /// installation's owners): no CRM gate applies to it.
    fn add_ungated(&mut self, workspace_id: String) {
        self.ungated_teams.insert(workspace_id.clone());
        self.add(workspace_id);
    }

    /// Teams holding an entity. A CRM record admits only the team webhooks
    /// whose creator may see it, so its teams carry a gate.
    fn add_entity_teams(&mut self, entity_type: EntityType, entity_id: &str, teams: Vec<Uuid>) {
        let crm = matches!(
            entity_type,
            EntityType::CrmCompany | EntityType::CrmContact | EntityType::CrmPipeline
        );
        for team_id in teams {
            let workspace_id = team_id.to_string();
            if crm {
                self.crm_teams.push(CrmGate {
                    workspace_id: workspace_id.clone(),
                    team_id,
                    entity_id: entity_id.to_owned(),
                    entity_type,
                });
                self.add(workspace_id);
            } else {
                self.add_ungated(workspace_id);
            }
        }
    }

    /// The CRM gates that still apply: a team workspace also reached without
    /// a CRM record is not narrowed by one.
    fn crm_gates(&self) -> Vec<CrmGate> {
        self.crm_teams
            .iter()
            .filter(|gate| !self.ungated_teams.contains(&gate.workspace_id))
            .cloned()
            .collect()
    }

    fn add_person(&mut self, person: &MacroUserIdStr<'static>) {
        self.add(person.to_string());
    }

    fn add_accessors(&mut self, accessors: Vec<MacroUserIdStr<'static>>) {
        self.accessor_count += accessors.len();
        for accessor in &accessors {
            self.add_person(accessor);
        }
    }
}

/// A team workspace reached through a CRM record: its webhooks are admitted
/// only when their creator may see the record as a member of that team.
#[derive(Debug, Clone)]
struct CrmGate {
    workspace_id: String,
    team_id: Uuid,
    entity_id: String,
    entity_type: EntityType,
}

impl<A, R, Q, P, T, G, I> WebhookEventIngestionServiceImpl<A, R, Q, P, T, G, I>
where
    A: EntityAccessService + EntityTeamAccess,
    R: WebhookRepo,
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
        let mut claim_gates = Vec::new();
        for member in audience_members(audience) {
            match member {
                // Accessors match their personal workspaces; a team workspace
                // only when the team itself holds access.
                Audience::Entity {
                    entity_type,
                    entity_id,
                } => {
                    workspaces
                        .add_accessors(self.users_with_access(entity_id, *entity_type).await?);
                    let teams = self
                        .teams_with_access(entity_id, *entity_type, None)
                        .await?;
                    workspaces.add_entity_teams(*entity_type, entity_id, teams);
                }
                Audience::EntityAtLeast {
                    entity_type,
                    entity_id,
                    min_level,
                } => {
                    workspaces.add_accessors(
                        self.accessors_at_least(entity_id, *entity_type, *min_level)
                            .await?,
                    );
                    let teams = self
                        .teams_with_access(entity_id, *entity_type, Some(access_level(*min_level)))
                        .await?;
                    workspaces.add_entity_teams(*entity_type, entity_id, teams);
                }
                // Named people match their personal workspace only.
                Audience::Owner { user_id }
                | Audience::TeamsOf { user_id }
                | Audience::ContactsOf { user_id }
                | Audience::Recipient { user_id } => workspaces.add_person(user_id),
                // Live streams only: a webhook never matches through it.
                Audience::Person { .. } => {}
                Audience::Snapshot { user_ids } => {
                    for user_id in user_ids {
                        workspaces.add_person(user_id);
                    }
                }
                Audience::Workspace { workspace_id } => {
                    workspaces.add_ungated(workspace_id.clone());
                }
                Audience::Team {
                    team_id,
                    min_role: MinTeamRole::Member,
                } => workspaces.add_ungated(team_id.to_string()),
                Audience::Team {
                    team_id,
                    min_role: MinTeamRole::Admin,
                } => {
                    for admin in self.team_admins(*team_id).await? {
                        workspaces.add_person(&admin);
                    }
                }
                Audience::GithubInstallation { installation_id } => {
                    let (claimant_workspaces, owning_teams) =
                        self.installation_workspaces(installation_id).await?;
                    for workspace_id in claimant_workspaces
                        .into_iter()
                        .chain(owning_teams.iter().cloned())
                    {
                        workspaces.add_ungated(workspace_id);
                    }
                    claim_gates.push(ClaimGate {
                        installation_id: installation_id.clone(),
                        team_workspaces: owning_teams,
                    });
                }
                Audience::Any(_) => {
                    return Err(WebhookEventIngestionError::UnsupportedAudience(
                        "unflattened union",
                    ));
                }
            }
        }
        tracing::Span::current().record("accessor_count", workspaces.accessor_count);
        let crm_gates = workspaces.crm_gates();
        let workspace_ids = workspaces.workspace_ids;
        tracing::Span::current().record("workspace_count", workspace_ids.len());

        self.match_and_enqueue(event, stage, workspace_ids, &claim_gates, &crm_gates)
            .await
    }
}

/// Webhooks in an installation's owning team workspaces reach the event only
/// when their creator holds a claim on it, as on the stream.
struct ClaimGate {
    installation_id: String,
    team_workspaces: Vec<String>,
}

impl<A, R, Q, P, T, G, I> WebhookEventIngestionService
    for WebhookEventIngestionServiceImpl<A, R, Q, P, T, G, I>
where
    A: EntityAccessService + EntityTeamAccess,
    R: WebhookRepo,
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
