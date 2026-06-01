//! Github Sync Service implementation

#[cfg(test)]
mod test;

mod handle_comment;
mod handle_installation;
mod handle_pr;
mod notify_pr;

use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GithubAppInstallationSource, GithubError,
        GithubInstallationAccessToken, GithubKey, GithubPullRequestDetails,
        GithubPullRequestStatus, GithubWebhookEventType, MacroTaskId, TeamTaskReference,
        ValidatedGithubWebhookEvent,
    },
    ports::{GithubSyncClient, GithubSyncRepo, GithubSyncService},
};
use documents::domain::{models::DocumentError, ports::DocumentService};
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use foreign_entity::domain::{
    models::{CreateForeignEntity, ForeignEntity, PatchForeignEntity},
    ports::ForeignEntityService,
};
use hmac::{Hmac, Mac};
use notification::domain::service::NotificationIngress;
use sha2::Sha256;
use std::{collections::HashSet, sync::Arc};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

const GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE: &str = "github_pull_request";

/// Github sync config
#[derive(Debug)]
pub struct GithubSyncConfig {
    /// The webhook secret used to validate github webhook events
    pub webhook_secret: String,
    /// The url to the github sync app installation page
    pub github_sync_app_url: String,
    /// The PEM key for the github sync app
    pub sync_app_pem: String,
    /// The client id for the github sync app
    pub sync_app_client_id: String,
}

/// The concrete github sync service implementation.
pub struct GithubSyncServiceImpl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    F: ForeignEntityService,
    N: NotificationIngress,
> {
    config: GithubSyncConfig,
    document_service: Arc<D>,
    foreign_entity_service: Arc<F>,
    notification_ingress: N,
    repo: R,
    pub(crate) client: C,
}

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    F: ForeignEntityService,
    N: NotificationIngress,
> GithubSyncServiceImpl<D, R, C, F, N>
{
    /// Create a new github sync service.
    pub fn new(
        config: GithubSyncConfig,
        document_service: Arc<D>,
        foreign_entity_service: Arc<F>,
        notification_ingress: N,
        repo: R,
        client: C,
    ) -> Self {
        Self {
            config,
            document_service,
            foreign_entity_service,
            notification_ingress,
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
}

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    F: ForeignEntityService,
    N: NotificationIngress,
> GithubSyncServiceImpl<D, R, C, F, N>
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
            comments: None,
            checks: None,
        })
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
            number: fallback.number,
            url: fallback.url,
            display_name: fallback.display_name,
            name: Some(details.title),
            status: Some(status),
            additions: Some(details.additions),
            deletions: Some(details.deletions),
            comments: details.comments,
            checks: details.checks,
        }
    }

    /// Preserve existing metadata arrays when a partial refresh omits them.
    fn metadata_with_preserved_partial_arrays(
        mut metadata: serde_json::Value,
        existing_metadata: Option<&serde_json::Value>,
    ) -> serde_json::Value {
        let Some(existing_object) = existing_metadata.and_then(|value| value.as_object()) else {
            return metadata;
        };
        let Some(metadata_object) = metadata.as_object_mut() else {
            return metadata;
        };

        for field in ["comments", "checks"] {
            if metadata_object.contains_key(field) {
                continue;
            }

            if let Some(existing_value) = existing_object.get(field)
                && existing_value.is_array()
            {
                metadata_object.insert(field.to_string(), existing_value.clone());
            }
        }

        metadata
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

    /// Create or refresh foreign entity rows from already-enriched pull request metadata.
    #[tracing::instrument(skip(self, pull_request, stored_for_sources))]
    async fn upsert_enriched_pull_request_foreign_entities(
        &self,
        pull_request: EnrichedGithubPullRequest,
        stored_for_sources: &[GithubAppInstallationSource],
    ) -> Vec<PullRequestForeignEntityUpsert> {
        let base_metadata = match serde_json::to_value(&pull_request) {
            Ok(metadata) => metadata,
            Err(error) => {
                tracing::error!(error=?error, "failed to serialize PR foreign entity metadata");
                return Vec::new();
            }
        };

        let existing = match self
            .foreign_entity_service
            .get_foreign_entities_by_foreign_entity_id(
                &pull_request.github_key,
                Some(GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE),
            )
            .await
        {
            Ok(existing) => existing,
            Err(error) => {
                tracing::error!(error=?error, "failed to fetch existing PR foreign entities");
                return Vec::new();
            }
        };

        let mut upserts = Vec::new();
        let mut seen_sources = HashSet::new();
        for source in stored_for_sources {
            let stored_for_id = source.source_id();
            let stored_for_auth_entity = source.source_type().to_string();
            if !seen_sources.insert((stored_for_id.clone(), stored_for_auth_entity.clone())) {
                continue;
            }

            let existing_entity = existing.iter().find(|entity| {
                entity.stored_for_id.as_str() == stored_for_id.as_str()
                    && entity.stored_for_auth_entity.as_str() == stored_for_auth_entity.as_str()
            });
            let previous_status = existing_entity
                .and_then(|entity| Self::pull_request_status_from_metadata(&entity.metadata));
            let existing_metadata = existing_entity
                .map(|entity| &entity.metadata)
                .or_else(|| existing.first().map(|entity| &entity.metadata));
            let metadata = Self::metadata_with_preserved_partial_arrays(
                base_metadata.clone(),
                existing_metadata,
            );

            let foreign_entity = if let Some(entity) = existing_entity {
                self.patch_pull_request_foreign_entity(
                    entity,
                    metadata,
                    &pull_request.github_key,
                    &stored_for_id,
                    &stored_for_auth_entity,
                )
                .await
            } else {
                self.create_pull_request_foreign_entity(
                    &pull_request.github_key,
                    metadata,
                    &stored_for_id,
                    &stored_for_auth_entity,
                )
                .await
            };

            let Some(foreign_entity) = foreign_entity else {
                continue;
            };

            upserts.push(PullRequestForeignEntityUpsert {
                source: source.clone(),
                foreign_entity_id: foreign_entity.id,
                previous_status,
                status: pull_request.status,
            });
        }

        upserts
    }

    async fn patch_pull_request_foreign_entity(
        &self,
        entity: &ForeignEntity,
        metadata: serde_json::Value,
        github_key: &str,
        stored_for_id: &str,
        stored_for_auth_entity: &str,
    ) -> Option<ForeignEntity> {
        self.foreign_entity_service
            .patch_foreign_entity(
                entity.id,
                PatchForeignEntity {
                    metadata: Some(metadata),
                    ..PatchForeignEntity::default()
                },
            )
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error=?error,
                    foreign_entity_id=%github_key,
                    stored_for_id=%stored_for_id,
                    stored_for_auth_entity=%stored_for_auth_entity,
                    "failed to patch PR foreign entity"
                );
            })
            .ok()
    }

    async fn create_pull_request_foreign_entity(
        &self,
        github_key: &str,
        metadata: serde_json::Value,
        stored_for_id: &str,
        stored_for_auth_entity: &str,
    ) -> Option<ForeignEntity> {
        self.foreign_entity_service
            .create_foreign_entity(CreateForeignEntity {
                foreign_entity_id: github_key.to_string(),
                foreign_entity_source: GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE.to_string(),
                metadata,
                stored_for_id: stored_for_id.to_string(),
                stored_for_auth_entity: stored_for_auth_entity.to_string(),
            })
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error=?error,
                    foreign_entity_id=%github_key,
                    stored_for_id=%stored_for_id,
                    stored_for_auth_entity=%stored_for_auth_entity,
                    "failed to create PR foreign entity"
                );
            })
            .ok()
    }

    fn pull_request_status_from_metadata(
        metadata: &serde_json::Value,
    ) -> Option<GithubPullRequestStatus> {
        metadata
            .get("status")
            .and_then(|status| serde_json::from_value(status.clone()).ok())
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
                    Ok(mut resolved_team_task_ids) => {
                        tracing::trace!(
                            team_task_ref_count = team_task_refs.len(),
                            resolved_team_task_id_count = resolved_team_task_ids.len(),
                            "resolved team task references from webhook text"
                        );
                        task_ids.append(&mut resolved_team_task_ids);
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
    F: ForeignEntityService,
    N: NotificationIngress,
> GithubSyncService for GithubSyncServiceImpl<D, R, C, F, N>
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
                if webhook_event.is_associated_with_pull_request() {
                    let _ = self
                        .upsert_pull_request_foreign_entities(webhook_event)
                        .await;
                }

                self.handle_comment_event(webhook_event).await
            }
            GithubWebhookEventType::CheckRun => {
                if webhook_event.is_associated_with_pull_request() {
                    let _ = self
                        .upsert_pull_request_foreign_entities(webhook_event)
                        .await;
                } else {
                    tracing::debug!("skipping check_run event without an associated PR");
                }

                Ok(())
            }
            GithubWebhookEventType::Installation => match action {
                Some("created") => self.handle_installation_created(webhook_event).await,
                _ => {
                    tracing::debug!(action, "skipping unhandled installation action");
                    Ok(())
                }
            },
        }
    }

    fn get_github_sync_app_url(&self) -> &str {
        &self.config.github_sync_app_url
    }

    #[tracing::instrument(skip(self), err)]
    async fn generate_installation_access_token(
        &self,
        installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        let now = chrono::Utc::now().timestamp() as u64;

        let claims = serde_json::json!({
            "iat": now - 60,
            "exp": now + (10 * 60),
            "iss": self.config.sync_app_client_id,
        });

        let header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
        let encoding_key =
            jsonwebtoken::EncodingKey::from_rsa_pem(self.config.sync_app_pem.as_bytes())
                .map_err(|e| GithubError::Internal(anyhow::anyhow!("invalid PEM key: {e}")))?;

        let jwt = jsonwebtoken::encode(&header, &claims, &encoding_key)
            .map_err(|e| GithubError::Internal(anyhow::anyhow!("failed to encode JWT: {e}")))?;

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
            let port = std::env::var("FRONTEND_PORT").unwrap_or_else(|_| "3000".to_string());
            return format!("[{name}](http://localhost:{port}/app/task/{id})");
        }
    };

    format!("[{name}]({url}/{id})")
}
