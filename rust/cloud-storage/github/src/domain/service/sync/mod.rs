//! Github Sync Service implementation

#[cfg(test)]
mod test;

mod handle_comment;
mod handle_installation;
mod handle_pr;

use crate::domain::{
    models::{
        GithubError, GithubInstallationAccessToken, GithubKey, GithubWebhookEventType, MacroTaskId,
        ValidatedGithubWebhookEvent,
    },
    ports::{GithubSyncClient, GithubSyncRepo, GithubSyncService},
};
use documents::domain::{models::DocumentError, ports::DocumentService};
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::sync::Arc;
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

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
pub struct GithubSyncServiceImpl<D: DocumentService, R: GithubSyncRepo, C: GithubSyncClient> {
    config: GithubSyncConfig,
    document_service: Arc<D>,
    repo: R,
    pub(crate) client: C,
}

impl<D: DocumentService, R: GithubSyncRepo, C: GithubSyncClient> GithubSyncServiceImpl<D, R, C> {
    /// Create a new github sync service.
    pub fn new(config: GithubSyncConfig, document_service: Arc<D>, repo: R, client: C) -> Self {
        Self {
            config,
            document_service,
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

impl<D: DocumentService, R: GithubSyncRepo, C: GithubSyncClient> GithubSyncServiceImpl<D, R, C> {
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
                tracing::warn!("missing PR metadata, cannot post comments");
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
                    "failed to generate installation access token for PR comment"
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
                    if let Some(sub_type) = document.document_metadata.sub_type
                        && sub_type.to_string() == "task"
                    {
                        let doc_name = &document.document_metadata.document_name;
                        let doc_id = &document.document_metadata.document_id;
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

impl<D: DocumentService, R: GithubSyncRepo, C: GithubSyncClient> GithubSyncService
    for GithubSyncServiceImpl<D, R, C>
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
            GithubWebhookEventType::PullRequest => match action {
                Some("opened" | "reopened") => self.handle_pr_open(webhook_event).await,
                Some("edited") => self.handle_pr_edit(webhook_event).await,
                Some("closed") => self.handle_pr_close(webhook_event).await,
                _ => {
                    tracing::debug!(action, "skipping unhandled pull_request action");
                    Ok(())
                }
            },
            GithubWebhookEventType::IssueComment
            | GithubWebhookEventType::PullRequestReview
            | GithubWebhookEventType::PullRequestReviewComment => {
                self.handle_comment_event(webhook_event).await
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

/// Creates a macro task comment given the document name and id
fn create_macro_task_comment_link(name: &str, id: &str) -> String {
    let url = match macro_env::Environment::new_or_prod() {
        macro_env::Environment::Production => "https://macro.com/app/task",
        macro_env::Environment::Develop => "https://dev.macro.com/app/task",
        macro_env::Environment::Local => "http://localhost:3000/app/task",
    };

    format!("[{name}]({url}/{id})")
}
