//! Github Sync Service implementation

#[cfg(test)]
mod test;

mod handle_comment;
mod handle_installation;
mod handle_pr;
mod notify_pr;
mod notify_pr_activity;
mod notify_pr_checks;
mod realtime;

use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GithubAppInstallationSource, GithubError,
        GithubInstallationAccessToken, GithubInstallationSetupAction, GithubKey,
        GithubPullRequestDetails, GithubPullRequestLabel, GithubPullRequestReview,
        GithubPullRequestReviewState, GithubPullRequestStatus, GithubPullRequestUser,
        GithubWebhookEventType, InstallationState, MacroTaskId, ResolvedTeamTaskReference,
        TeamTaskReference, ValidatedGithubWebhookEvent, latest_reviews, sign_installation_state,
        verify_installation_state,
    },
    ports::{GithubSyncClient, GithubSyncRealtime, GithubSyncRepo, GithubSyncService},
};
use documents::domain::{models::DocumentError, ports::DocumentService};
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use foreign_entity::domain::models::SourceId;
use github_pull_requests::domain::{
    models::UpsertGithubPullRequest, ports::GithubPullRequestService,
};
use hmac::{Hmac, Mac};
use macro_env_var::maybe_env_vars;
use notification::domain::service::NotificationIngress;
use sha2::Sha256;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

maybe_env_vars! {
    struct FrontendPort;
}

/// Github sync config
#[derive(Debug)]
pub struct GithubSyncConfig {
    /// The webhook secret used to validate github webhook events
    pub webhook_secret: String,
    /// The URL to the GitHub Sync App profile or installation page.
    pub github_sync_app_url: String,
    /// The PEM key for the github sync app
    pub sync_app_pem: String,
    /// The client id for the github sync app
    pub sync_app_client_id: String,
    /// The client secret for the GitHub sync App's setup OAuth exchange.
    pub sync_app_client_secret: String,
    /// Secret used to sign installation setup state carried through GitHub.
    pub installation_state_secret: String,
}

/// The concrete github sync service implementation.
pub struct GithubSyncServiceImpl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    G: GithubPullRequestService,
    N: NotificationIngress,
    P: GithubSyncRealtime,
> {
    config: GithubSyncConfig,
    document_service: Arc<D>,
    pull_request_service: Arc<G>,
    notification_ingress: N,
    realtime: P,
    repo: R,
    pub(crate) client: C,
}

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    G: GithubPullRequestService,
    N: NotificationIngress,
    P: GithubSyncRealtime,
> GithubSyncServiceImpl<D, R, C, G, N, P>
{
    /// Create a new github sync service.
    pub fn new(
        config: GithubSyncConfig,
        document_service: Arc<D>,
        pull_request_service: Arc<G>,
        notification_ingress: N,
        repo: R,
        client: C,
        realtime: P,
    ) -> Self {
        Self {
            config,
            document_service,
            pull_request_service,
            notification_ingress,
            realtime,
            repo,
            client,
        }
    }
}

/// Metadata needed to interact with a pull request via the GitHub API.
struct PrMeta {
    token: GithubInstallationAccessToken,
    owner: String,
    repo: String,
    pull_number: u64,
}

/// Result of resolving task IDs to documents.
struct ResolvedTasks {
    /// Document IDs for all resolved tasks (used for status updates).
    doc_ids: Vec<String>,
    /// Markdown links for resolved tasks (used for PR comments).
    task_links: Vec<String>,
    /// Task IDs that were validated as actual task documents.
    validated_task_ids: Vec<MacroTaskId>,
}

/// Result of creating or refreshing one source-scoped PR foreign entity row.
#[derive(Debug, Clone)]
struct PullRequestForeignEntityUpsert {
    /// The installation source this foreign entity is scoped to.
    source: GithubAppInstallationSource,
    /// The internal source-specific foreign entity row ID.
    foreign_entity_id: uuid::Uuid,
    /// The previously persisted normalized PR status for this source, when known.
    previous_status: Option<GithubPullRequestStatus>,
    /// The newly persisted normalized PR status for this source, when known.
    status: Option<GithubPullRequestStatus>,
    /// Stable numeric GitHub user IDs for PR participants after metadata merge.
    participant_github_user_ids: Vec<String>,
}

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    G: GithubPullRequestService,
    N: NotificationIngress,
    P: GithubSyncRealtime,
> GithubSyncServiceImpl<D, R, C, G, N, P>
{
    /// Extract PR metadata and generate an installation access token.
    /// Returns `None` if any required field is missing or token generation fails.
    #[tracing::instrument(skip(self, event))]
    async fn acquire_pr_meta(&self, event: &ValidatedGithubWebhookEvent) -> Option<PrMeta> {
        let (installation_id, owner, repo, pull_number) = match (
            event.installation_id(),
            event.repo_owner(),
            event.repo_name(),
            event.pull_number(),
        ) {
            (Some(i), Some(o), Some(r), Some(p)) => (i, o, r, p),
            _ => {
                tracing::warn!("missing PR metadata, cannot access GitHub pull request");
                return None;
            }
        };

        tracing::trace!(
            installation_id,
            owner,
            repo,
            pull_number,
            "extracted PR metadata, generating installation token"
        );

        match self
            .generate_installation_access_token(installation_id)
            .await
        {
            Ok(token) => {
                tracing::trace!("installation access token acquired");
                Some(PrMeta {
                    token,
                    owner: owner.to_string(),
                    repo: repo.to_string(),
                    pull_number,
                })
            }
            Err(e) => {
                tracing::error!(
                    error=?e,
                    "failed to generate installation access token for GitHub pull request"
                );
                None
            }
        }
    }

    /// Build a [`GithubKey`] from the webhook event, if owner/repo/pull_number
    /// are all present.
    fn github_key(event: &ValidatedGithubWebhookEvent) -> Option<GithubKey> {
        match (event.repo_owner(), event.repo_name(), event.pull_number()) {
            (Some(o), Some(r), Some(p)) => Some(GithubKey::new(o, r, p)),
            _ => None,
        }
    }

    /// Build pull request metadata for storage as a foreign entity.
    fn enriched_pull_request_from_event(
        event: &ValidatedGithubWebhookEvent,
    ) -> Option<EnrichedGithubPullRequest> {
        let (owner, repo, number) =
            match (event.repo_owner(), event.repo_name(), event.pull_number()) {
                (Some(owner), Some(repo), Some(number)) => (owner, repo, number),
                _ => return None,
            };

        let github_key = GithubKey::new(owner, repo, number);
        let pull_request = event.payload.get("pull_request");
        let url = pull_request
            .and_then(|pr| pr.get("html_url"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("https://github.com/{owner}/{repo}/pull/{number}"));

        Some(EnrichedGithubPullRequest {
            github_key: github_key.as_ref().to_string(),
            owner: owner.to_string(),
            repo: repo.to_string(),
            repository_id: event
                .payload
                .get("repository")
                .and_then(|repository| repository.get("id"))
                .and_then(|value| value.as_u64()),
            number,
            url,
            display_name: format!("{owner}/{repo}#{number}"),
            name: pull_request
                .and_then(|pr| pr.get("title"))
                .and_then(|value| value.as_str())
                .map(str::to_string),
            status: Some(Self::pull_request_status_from_event(event)),
            additions: pull_request
                .and_then(|pr| pr.get("additions"))
                .and_then(|value| value.as_u64()),
            deletions: pull_request
                .and_then(|pr| pr.get("deletions"))
                .and_then(|value| value.as_u64()),
            author_login: pull_request
                .and_then(|pr| pr.get("user"))
                .and_then(|user| user.get("login"))
                .and_then(|value| value.as_str())
                .map(str::to_string),
            author_id: pull_request
                .and_then(|pr| pr.get("user"))
                .and_then(|user| user.get("id"))
                .and_then(|value| value.as_u64()),
            description: pull_request
                .and_then(|pr| pr.get("body"))
                .and_then(|value| value.as_str())
                .map(str::to_string),
            comments: None,
            checks: None,
            participant_github_user_ids: Self::participant_ids_from_payload(pull_request),
            draft: pull_request
                .and_then(|pr| pr.get("draft"))
                .and_then(|value| value.as_bool()),
            requested_reviewer_github_user_ids: pull_request
                .and_then(|pr| pr.get("requested_reviewers"))
                .and_then(|value| value.as_array())
                .map(|users| {
                    users
                        .iter()
                        .filter_map(|user| user.get("id").and_then(|value| value.as_u64()))
                        .map(|id| id.to_string())
                        .collect()
                }),
            github_updated_at: pull_request
                .and_then(|pr| pr.get("updated_at"))
                .and_then(|value| value.as_str())
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .map(|updated_at| updated_at.with_timezone(&chrono::Utc)),
            assignees: pull_request
                .and_then(|pr| pr.get("assignees"))
                .and_then(|value| value.as_array())
                .map(|users| users.iter().filter_map(Self::user_from_payload).collect()),
            labels: pull_request
                .and_then(|pr| pr.get("labels"))
                .and_then(|value| value.as_array())
                .map(|labels| labels.iter().filter_map(Self::label_from_payload).collect()),
            reviews: Self::review_from_payload(event.payload.get("review"))
                .map(|review| vec![review]),
        })
    }

    fn user_from_payload(user: &serde_json::Value) -> Option<GithubPullRequestUser> {
        Some(GithubPullRequestUser {
            github_user_id: user.get("id")?.as_u64()?.to_string(),
            login: user
                .get("login")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        })
    }

    fn label_from_payload(label: &serde_json::Value) -> Option<GithubPullRequestLabel> {
        Some(GithubPullRequestLabel {
            name: label.get("name")?.as_str()?.to_string(),
            color: label
                .get("color")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        })
    }

    /// The review a `pull_request_review` event carries, as its reviewer's state.
    fn review_from_payload(review: Option<&serde_json::Value>) -> Option<GithubPullRequestReview> {
        let review = review?;
        let reviewer = Self::user_from_payload(review.get("user")?)?;
        Some(GithubPullRequestReview {
            reviewer_github_user_id: reviewer.github_user_id,
            reviewer_login: reviewer.login,
            state: GithubPullRequestReviewState::from_github(review.get("state")?.as_str()?)?,
            submitted_at: review
                .get("submitted_at")
                .and_then(|value| value.as_str())
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .map(|submitted_at| submitted_at.with_timezone(&chrono::Utc)),
        })
    }

    /// Collect the stable numeric ids of the author, requested reviewers, and assignees from a
    /// webhook `pull_request` payload. Commenters are not present in the payload; they are
    /// unioned in from existing metadata or a live fetch.
    fn participant_ids_from_payload(
        pull_request: Option<&serde_json::Value>,
    ) -> Option<Vec<String>> {
        let pull_request = pull_request?;
        let mut ids = std::collections::BTreeSet::new();

        ids.extend(
            pull_request
                .get("user")
                .and_then(|user| user.get("id"))
                .and_then(|value| value.as_u64()),
        );
        for field in ["requested_reviewers", "assignees"] {
            if let Some(users) = pull_request.get(field).and_then(|value| value.as_array()) {
                ids.extend(
                    users
                        .iter()
                        .filter_map(|user| user.get("id").and_then(|value| value.as_u64())),
                );
            }
        }

        (!ids.is_empty()).then(|| ids.iter().map(u64::to_string).collect())
    }

    /// Build pull request metadata from live GitHub details when possible,
    /// falling back to the webhook payload if the live request fails.
    async fn enriched_pull_request_metadata(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Option<EnrichedGithubPullRequest> {
        let fallback = Self::enriched_pull_request_from_event(event)?;
        let requires_live_metadata = event.parsed_event_type() == GithubWebhookEventType::CheckRun;
        let Some(pr_meta) = self.acquire_pr_meta(event).await else {
            return (!requires_live_metadata).then_some(fallback);
        };

        match self
            .client
            .get_pull_request_details(
                &pr_meta.token.token,
                &pr_meta.owner,
                &pr_meta.repo,
                pr_meta.pull_number,
            )
            .await
        {
            Ok(details) => Some(Self::enriched_pull_request_from_details(fallback, details)),
            Err(error) if requires_live_metadata => {
                tracing::warn!(
                    error=?error,
                    owner=%pr_meta.owner,
                    repo=%pr_meta.repo,
                    pull_number=pr_meta.pull_number,
                    "failed to fetch live PR metadata for check_run event"
                );
                None
            }
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    owner=%pr_meta.owner,
                    repo=%pr_meta.repo,
                    pull_number=pr_meta.pull_number,
                    "failed to fetch live PR metadata, falling back to webhook payload"
                );
                Some(fallback)
            }
        }
    }

    /// Build enriched pull request metadata from live GitHub pull request details.
    fn enriched_pull_request_from_details(
        fallback: EnrichedGithubPullRequest,
        details: GithubPullRequestDetails,
    ) -> EnrichedGithubPullRequest {
        let status = details.status();

        EnrichedGithubPullRequest {
            github_key: fallback.github_key,
            owner: fallback.owner,
            repo: fallback.repo,
            repository_id: details.repository_id.or(fallback.repository_id),
            number: fallback.number,
            url: fallback.url,
            display_name: fallback.display_name,
            name: Some(details.title),
            status: Some(status),
            additions: Some(details.additions),
            deletions: Some(details.deletions),
            author_login: details.author_login.or(fallback.author_login),
            author_id: details.author_id.or(fallback.author_id),
            description: details.description.or(fallback.description),
            comments: details.comments,
            checks: details.checks,
            participant_github_user_ids: details
                .participant_github_user_ids
                .or(fallback.participant_github_user_ids),
            draft: details.draft.or(fallback.draft),
            requested_reviewer_github_user_ids: details
                .requested_reviewer_github_user_ids
                .or(fallback.requested_reviewer_github_user_ids),
            github_updated_at: details.github_updated_at.or(fallback.github_updated_at),
            assignees: details.assignees.or(fallback.assignees),
            labels: details.labels.or(fallback.labels),
            reviews: match (details.reviews, fallback.reviews) {
                (None, None) => None,
                (details, fallback) => Some(latest_reviews(
                    details
                        .into_iter()
                        .flatten()
                        .chain(fallback.into_iter().flatten()),
                )),
            },
        }
    }

    /// Derive a normalized pull request status from the webhook payload.
    fn pull_request_status_from_event(
        event: &ValidatedGithubWebhookEvent,
    ) -> GithubPullRequestStatus {
        let pull_request = event.payload.get("pull_request");
        let has_merged_at = pull_request
            .and_then(|pr| pr.get("merged_at"))
            .and_then(|value| value.as_str())
            .is_some_and(|merged_at| !merged_at.is_empty());

        if event.is_merged() || has_merged_at {
            return GithubPullRequestStatus::Merged;
        }

        let state = pull_request
            .and_then(|pr| pr.get("state"))
            .and_then(|value| value.as_str());

        if state == Some("closed") || event.action() == Some("closed") {
            return GithubPullRequestStatus::Closed;
        }

        GithubPullRequestStatus::Open
    }

    /// Backfill foreign entity rows for open pull requests visible to a GitHub App installation.
    #[tracing::instrument(skip(self, stored_for_sources), err)]
    async fn backfill_open_pull_request_foreign_entities(
        &self,
        installation_id: u64,
        stored_for_sources: &[GithubAppInstallationSource],
    ) -> Result<(), GithubError> {
        if stored_for_sources.is_empty() {
            tracing::trace!(
                installation_id,
                "no GitHub App installation sources found for PR backfill"
            );
            return Ok(());
        }

        let token = self
            .generate_installation_access_token(installation_id)
            .await?;
        let pull_requests = self.client.list_open_pull_requests(&token.token).await?;

        tracing::info!(
            installation_id,
            pull_request_count = pull_requests.len(),
            source_count = stored_for_sources.len(),
            "backfilling open pull request foreign entities"
        );

        for pull_request in pull_requests {
            self.upsert_enriched_pull_request_foreign_entities(pull_request, stored_for_sources)
                .await;
        }

        Ok(())
    }

    /// Create or refresh foreign entity rows for a pull request, scoped to the
    /// Macro source (team or user) associated with the GitHub App installation.
    #[tracing::instrument(skip(self, event))]
    async fn upsert_pull_request_foreign_entities(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Option<(
        EnrichedGithubPullRequest,
        Vec<PullRequestForeignEntityUpsert>,
    )> {
        let Some(installation_id) = event.installation_id() else {
            tracing::warn!("missing installation id, cannot upsert PR foreign entity");
            return None;
        };
        let installation_id = installation_id.to_string();

        let stored_for_sources = match self.repo.get_installation_sources(&installation_id).await {
            Ok(sources) => sources,
            Err(error) => {
                tracing::error!(
                    error=?error,
                    installation_id,
                    "failed to fetch GitHub App installation sources for PR foreign entity"
                );
                return None;
            }
        };

        if stored_for_sources.is_empty() {
            tracing::trace!(
                installation_id,
                "no GitHub App installation sources found for PR foreign entity upsert"
            );
            return None;
        }

        let Some(pull_request) = self.enriched_pull_request_metadata(event).await else {
            tracing::warn!("missing PR metadata, cannot upsert foreign entity");
            return None;
        };

        let upserts = self
            .upsert_enriched_pull_request_foreign_entities(
                pull_request.clone(),
                &stored_for_sources,
            )
            .await;

        Some((pull_request, upserts))
    }

    /// Create or refresh one foreign entity record per installation source from already-enriched
    /// pull request metadata.
    #[tracing::instrument(skip(self, pull_request, stored_for_sources))]
    async fn upsert_enriched_pull_request_foreign_entities(
        &self,
        pull_request: EnrichedGithubPullRequest,
        stored_for_sources: &[GithubAppInstallationSource],
    ) -> Vec<PullRequestForeignEntityUpsert> {
        let mut upserts = Vec::new();
        let mut seen_sources = HashSet::new();
        for source in stored_for_sources {
            let stored_for = SourceId::new(source.source_id(), source.source_type());
            if !seen_sources.insert(stored_for.clone()) {
                continue;
            }

            let upserted = match self
                .pull_request_service
                .upsert_pull_request(UpsertGithubPullRequest {
                    pull_request: pull_request.clone(),
                    stored_for,
                })
                .await
            {
                Ok(upserted) => upserted,
                Err(error) => {
                    tracing::error!(
                        error=?error,
                        source_id=%source.source_id(),
                        source_type=%source.source_type(),
                        "failed to store PR foreign entity"
                    );
                    continue;
                }
            };

            self.publish_pull_request(source, &upserted.foreign_entity)
                .await;

            upserts.push(PullRequestForeignEntityUpsert {
                source: source.clone(),
                foreign_entity_id: upserted.foreign_entity.id,
                previous_status: upserted.previous_status,
                status: pull_request.status,
                participant_github_user_ids: upserted.participant_github_user_ids,
            });
        }

        upserts
    }

    /// Extract both legacy `MACRO-{short_uuid}` IDs and team-scoped
    /// `{team_slug}-{team_task_id}` references from text.
    #[tracing::instrument(skip(self, event, text))]
    async fn extract_task_ids_from_text(
        &self,
        event: &ValidatedGithubWebhookEvent,
        text: &str,
    ) -> Vec<MacroTaskId> {
        let mut task_ids = MacroTaskId::extract_from_text(text);
        let legacy_task_id_count = task_ids.len();
        let team_task_refs = TeamTaskReference::extract_from_text(text);

        if !team_task_refs.is_empty() {
            if let Some(installation_id) = event.installation_id() {
                let installation_id = installation_id.to_string();
                match self
                    .repo
                    .resolve_team_task_references(&installation_id, &team_task_refs)
                    .await
                {
                    Ok(resolutions) => {
                        // Team slugs are not unique, so a reference can match
                        // tasks in several of the installation's teams. Only
                        // link references that resolve in exactly one team;
                        // an ambiguous reference must not fan out links to
                        // other teams' tasks.
                        let mut by_reference: HashMap<
                            TeamTaskReference,
                            Vec<ResolvedTeamTaskReference>,
                        > = HashMap::new();
                        for resolution in resolutions {
                            by_reference
                                .entry(resolution.reference.clone())
                                .or_default()
                                .push(resolution);
                        }

                        let mut resolved_team_task_id_count = 0;
                        for (reference, resolutions) in by_reference {
                            if resolutions.len() > 1 {
                                tracing::warn!(
                                    team_slug = %reference.team_slug,
                                    team_task_id = reference.team_task_id,
                                    team_ids = ?resolutions
                                        .iter()
                                        .map(|r| r.team_id)
                                        .collect::<Vec<_>>(),
                                    "team task reference matched tasks in multiple teams, skipping ambiguous reference"
                                );
                                continue;
                            }
                            resolved_team_task_id_count += resolutions.len();
                            task_ids.extend(resolutions.into_iter().map(|r| r.task_id));
                        }

                        tracing::trace!(
                            team_task_ref_count = team_task_refs.len(),
                            resolved_team_task_id_count,
                            "resolved team task references from webhook text"
                        );
                    }
                    Err(e) => {
                        tracing::error!(
                            error=?e,
                            team_task_ref_count = team_task_refs.len(),
                            "failed to resolve team task references"
                        );
                    }
                }
            } else {
                tracing::debug!(
                    team_task_ref_count = team_task_refs.len(),
                    "found team task references but webhook payload has no installation id"
                );
            }
        }

        let task_ids = dedupe_task_ids(task_ids);
        tracing::trace!(
            legacy_task_id_count,
            team_task_ref_count = team_task_refs.len(),
            total_task_id_count = task_ids.len(),
            task_ids = ?task_ids.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "extracted task IDs from webhook text"
        );
        task_ids
    }

    /// Resolve task IDs to documents, returning doc IDs and markdown links
    /// for all tasks that are actually task-type documents.
    #[tracing::instrument(skip(self, task_ids))]
    async fn resolve_tasks(&self, task_ids: &[MacroTaskId]) -> ResolvedTasks {
        tracing::trace!(
            task_id_count = task_ids.len(),
            "resolving task IDs to documents"
        );

        let mut doc_ids = Vec::new();
        let mut task_links = Vec::new();
        let mut validated_task_ids = Vec::new();

        for task_id in task_ids {
            let uuid = match task_id.to_uuid() {
                Ok(uuid) => uuid,
                Err(e) => {
                    tracing::warn!(
                        task_id=%task_id,
                        error=?e,
                        "failed to convert task ID to UUID"
                    );
                    continue;
                }
            };

            tracing::trace!(task_id=%task_id, uuid=%uuid, "looking up document for task ID");

            // SAFETY: This is ok as we are only using the preview information of the
            // document
            let entity_access = entity_access::domain::models::EntityAccessReceipt::<
                ViewAccessLevel,
            >::dangerously_assert_internal_user(
                &uuid.to_string(),
                entity_access::domain::models::EntityType::Document,
            );

            match self.document_service.get_document(entity_access).await {
                Ok(document) => {
                    if let Some(sub_type) = document.document_metadata.metadata.sub_type
                        && sub_type.to_string() == "task"
                    {
                        let doc_name = &document.document_metadata.metadata.document_name;
                        let doc_id = &document.document_metadata.metadata.document_id;
                        tracing::trace!(task_id=%uuid, doc_id, doc_name, "resolved task document");

                        doc_ids.push(doc_id.clone());
                        task_links.push(create_macro_task_comment_link(doc_name, doc_id));
                        validated_task_ids.push(task_id.clone());
                    } else {
                        tracing::trace!(task_id=%uuid, "document found but is not a task, skipping");
                    }
                }
                Err(e) => match e {
                    DocumentError::NotFound(_) => {
                        tracing::trace!(task_id=%uuid, "no document found for task ID");
                    }
                    _ => tracing::error!(error=?e, "unable to get document"),
                },
            }
        }

        tracing::trace!(
            resolved_count = doc_ids.len(),
            link_count = task_links.len(),
            "task resolution complete"
        );

        ResolvedTasks {
            doc_ids,
            task_links,
            validated_task_ids,
        }
    }

    /// Post a single bot comment on the PR with all new task links.
    #[tracing::instrument(skip(self, pr_meta, task_links))]
    async fn post_task_comment(&self, pr_meta: &PrMeta, task_links: &[String]) {
        if task_links.is_empty() {
            tracing::trace!("no new task links to post");
            return;
        }

        tracing::trace!(
            owner = %pr_meta.owner,
            repo = %pr_meta.repo,
            pull_number = pr_meta.pull_number,
            link_count = task_links.len(),
            "posting task comment on PR"
        );

        let comment_body = task_links.join("\n");
        self.client
            .create_pr_comment(
                &pr_meta.token.token,
                &pr_meta.owner,
                &pr_meta.repo,
                pr_meta.pull_number,
                &comment_body,
            )
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "failed to create PR comment");
            })
            .ok();
    }

    /// Update task statuses for all resolved task doc IDs.
    #[tracing::instrument(skip(self, doc_ids))]
    async fn update_task_statuses(&self, doc_ids: &[String], status: &str) {
        tracing::trace!(doc_count = doc_ids.len(), status, "updating task statuses");

        for doc_id in doc_ids {
            tracing::trace!(doc_id, status, "updating task status");

            let entity_access = entity_access::domain::models::EntityAccessReceipt::<
                EditAccessLevel,
            >::dangerously_assert_internal_user(
                doc_id,
                entity_access::domain::models::EntityType::Document,
            );

            self.document_service
                .update_task_status(entity_access, status)
                .await
                .inspect_err(|e| {
                    tracing::error!(
                        error=?e,
                        doc_id=%doc_id,
                        status=%status,
                        "failed to update task status"
                    );
                })
                .ok();
        }
    }
}

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    G: GithubPullRequestService,
    N: NotificationIngress,
    P: GithubSyncRealtime,
> GithubSyncService for GithubSyncServiceImpl<D, R, C, G, N, P>
{
    #[tracing::instrument(skip(self, body), err)]
    async fn validate_webhook_event(
        &self,
        event_type: &str,
        signature: &str,
        body: &[u8],
    ) -> Result<ValidatedGithubWebhookEvent, GithubError> {
        let sig_bytes = hex::decode(signature).map_err(|_| GithubError::InvalidWebhookSignature)?;

        let mut mac = HmacSha256::new_from_slice(self.config.webhook_secret.as_bytes())
            .map_err(|e| GithubError::Internal(e.into()))?;

        mac.update(body);
        let expected = mac.finalize().into_bytes();

        // constant-time comparison
        #[allow(deprecated)]
        if expected.as_slice().ct_eq(&sig_bytes).into() {
            Ok(ValidatedGithubWebhookEvent::new(
                event_type.to_string(),
                serde_json::from_slice(body).map_err(|e| GithubError::Internal(e.into()))?,
            ))
        } else {
            Err(GithubError::InvalidWebhookSignature)
        }
    }

    #[tracing::instrument(skip(self, webhook_event), err)]
    async fn process_webhook_event(
        &self,
        webhook_event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let event_type = webhook_event.parsed_event_type();
        let action = webhook_event.action();
        tracing::info!(event_type=?event_type, action, "processing github webhook event");

        match event_type {
            GithubWebhookEventType::Unknown(ref name) => {
                tracing::debug!(event_type=%name, "skipping unknown event type");
                Ok(())
            }
            GithubWebhookEventType::PullRequest => {
                let upsert_result = self
                    .upsert_pull_request_foreign_entities(webhook_event)
                    .await;
                if let Some((pull_request, upserts)) = &upsert_result {
                    self.notify_pr_status_transitions(webhook_event, pull_request, upserts)
                        .await;
                    match action {
                        Some("review_requested") => {
                            self.notify_review_requested(webhook_event, pull_request, upserts)
                                .await;
                        }
                        Some("opened" | "edited") => {
                            self.notify_pr_body_mentions(webhook_event, pull_request, upserts)
                                .await;
                        }
                        _ => {}
                    }
                }

                match action {
                    Some("opened" | "reopened") => self.handle_pr_open(webhook_event).await,
                    Some("edited") => self.handle_pr_edit(webhook_event).await,
                    Some("closed") => self.handle_pr_close(webhook_event).await,
                    _ => {
                        tracing::debug!(action, "skipping unhandled pull_request action");
                        Ok(())
                    }
                }
            }
            GithubWebhookEventType::IssueComment
            | GithubWebhookEventType::PullRequestReview
            | GithubWebhookEventType::PullRequestReviewComment => {
                if webhook_event.is_associated_with_pull_request()
                    && let Some((pull_request, upserts)) = self
                        .upsert_pull_request_foreign_entities(webhook_event)
                        .await
                {
                    match (webhook_event.parsed_event_type(), action) {
                        (
                            GithubWebhookEventType::IssueComment
                            | GithubWebhookEventType::PullRequestReviewComment,
                            Some("created"),
                        ) => {
                            self.notify_pr_comment_and_mentions(
                                webhook_event,
                                &pull_request,
                                &upserts,
                            )
                            .await;
                        }
                        (GithubWebhookEventType::PullRequestReview, Some("submitted")) => {
                            self.notify_pr_review(webhook_event, &pull_request, &upserts)
                                .await;
                        }
                        _ => {}
                    }
                }

                self.handle_comment_event(webhook_event).await
            }
            GithubWebhookEventType::CheckRun => {
                if webhook_event.is_associated_with_pull_request() {
                    if let Some((pull_request, upserts)) = self
                        .upsert_pull_request_foreign_entities(webhook_event)
                        .await
                    {
                        self.notify_pr_check_run(webhook_event, &pull_request, &upserts)
                            .await;
                    }
                } else {
                    tracing::debug!("skipping check_run event without an associated PR");
                }

                Ok(())
            }
            GithubWebhookEventType::Installation => match action {
                Some("created") => self.handle_installation_created(webhook_event).await,
                Some("deleted") => self.handle_installation_deleted(webhook_event).await,
                _ => {
                    tracing::debug!(action, "skipping unhandled installation action");
                    Ok(())
                }
            },
        }
    }

    #[tracing::instrument(skip(self), fields(macro_user_id = %macro_user_id), err)]
    async fn begin_installation_setup(
        &self,
        macro_user_id: &macro_user_id::user_id::MacroUserIdStr<'_>,
        team_id: Option<uuid::Uuid>,
    ) -> Result<String, GithubError> {
        if let Some(team_id) = team_id {
            let team_ids = self
                .repo
                .get_user_team_ids(macro_user_id.as_ref())
                .await
                .map_err(|error| GithubError::Internal(error.into()))?;
            if !team_ids.contains(&team_id) {
                return Err(GithubError::Forbidden);
            }
        }

        let state = InstallationState {
            macro_user_id: macro_user_id::user_id::MacroUserIdStr::try_from(
                macro_user_id.as_ref().to_string(),
            )
            .map_err(|error| GithubError::Internal(error.into()))?,
            team_id,
            exp: chrono::Utc::now().timestamp() + 60 * 60,
        };
        let signed_state =
            sign_installation_state(&state, self.config.installation_state_secret.as_bytes())
                .map_err(|error| GithubError::Internal(error.into()))?;

        let mut installation_url = url::Url::parse(&self.config.github_sync_app_url)
            .map_err(|error| GithubError::Internal(error.into()))?;
        let configured_path = installation_url.path().trim_end_matches('/');
        if !configured_path.ends_with("/installations/new") {
            installation_url.set_path(&format!("{configured_path}/installations/new"));
        }
        installation_url
            .query_pairs_mut()
            .append_pair("state", &signed_state);

        Ok(installation_url.into())
    }

    #[tracing::instrument(skip(self, state, code), err)]
    async fn complete_installation_setup(
        &self,
        state: &str,
        code: Option<&str>,
        installation_id: Option<u64>,
        setup_action: &str,
    ) -> Result<(), GithubError> {
        let state = verify_installation_state(
            state,
            self.config.installation_state_secret.as_bytes(),
            chrono::Utc::now().timestamp(),
        )
        .map_err(|_| GithubError::InvalidInstallationState)?;
        let setup_action = GithubInstallationSetupAction::try_from(setup_action)?;

        let code = code.ok_or(GithubError::MissingInstallationSetupField("code"))?;
        // A request callback carries no installation_id: the installation only
        // comes into existence when an org admin approves.
        let installation_id = match setup_action {
            GithubInstallationSetupAction::Request => None,
            GithubInstallationSetupAction::Install | GithubInstallationSetupAction::Update => Some(
                installation_id.ok_or(GithubError::MissingInstallationSetupField(
                    "installation_id",
                ))?,
            ),
        };

        let access_token = self
            .client
            .exchange_setup_code(
                &self.config.sync_app_client_id,
                &self.config.sync_app_client_secret,
                code,
            )
            .await?;

        // The state is a bearer token carried through GitHub in a URL, so it
        // must not be honored on signature and expiry alone: require the
        // GitHub account completing the flow to be linked to the Macro user
        // the state was minted for. This stops a leaked or attacker-minted
        // state from binding someone else's installation to a foreign source.
        let github_user_id = self
            .client
            .get_authenticated_user(access_token.as_str())
            .await?
            .id
            .to_string();
        let links = self
            .repo
            .get_macro_ids_by_github_user_ids(std::slice::from_ref(&github_user_id))
            .await
            .map_err(|error| GithubError::Internal(error.into()))?;
        let completer_is_state_user = links.get(&github_user_id).is_some_and(|macro_ids| {
            macro_ids
                .iter()
                .any(|id| id == state.macro_user_id.as_ref())
        });
        if !completer_is_state_user {
            return Err(GithubError::SetupUserNotLinked);
        }

        let source = match state.team_id {
            Some(team_id) => GithubAppInstallationSource::Team(team_id),
            None => GithubAppInstallationSource::User(state.macro_user_id.into()),
        };

        let Some(installation_id) = installation_id else {
            // Park the requested source keyed by the requester's GitHub
            // identity so the installation.created webhook can complete the
            // association once an org admin approves.
            return self
                .repo
                .upsert_installation_request(&github_user_id, &source)
                .await
                .map_err(|error| GithubError::Internal(error.into()));
        };

        let installations = self
            .client
            .list_user_installations(access_token.as_str())
            .await?;
        if !installations
            .iter()
            .any(|installation| installation.id == installation_id)
        {
            return Err(GithubError::InstallationNotOwned);
        }

        self.associate_installation_with_sources(installation_id, &[source])
            .await
    }

    fn get_github_sync_app_url(&self) -> &str {
        &self.config.github_sync_app_url
    }

    #[tracing::instrument(skip(self), err)]
    async fn generate_installation_access_token(
        &self,
        installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        let jwt = crate::domain::models::app_jwt(
            &self.config.sync_app_client_id,
            &self.config.sync_app_pem,
        )?;

        self.client
            .generate_installation_access_token(&jwt, installation_id)
            .await
    }
}

fn dedupe_task_ids(task_ids: Vec<MacroTaskId>) -> Vec<MacroTaskId> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();

    for task_id in task_ids {
        if seen.insert(task_id.short_uuid.clone()) {
            deduped.push(task_id);
        }
    }

    deduped
}

/// Creates a macro task comment given the document name and id
fn create_macro_task_comment_link(name: &str, id: &str) -> String {
    let url = match macro_env::Environment::new_or_prod() {
        macro_env::Environment::Production => "https://macro.com/app/task",
        macro_env::Environment::Develop => "https://dev.macro.com/app/task",
        macro_env::Environment::Local => {
            let port = FrontendPort::new()
                .map(|port| port.to_string())
                .unwrap_or_else(|| "3000".to_string());
            return format!("[{name}](http://localhost:{port}/app/task/{id})");
        }
    };

    format!("[{name}]({url}/{id})")
}
