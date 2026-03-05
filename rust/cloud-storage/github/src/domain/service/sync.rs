//! Github Sync Service implementation
use crate::domain::{
    models::{
        GithubError, GithubInstallationAccessToken, GithubWebhookEventType, MacroTaskId,
        ValidatedGithubWebhookEvent,
    },
    ports::{GithubSyncClient, GithubSyncService},
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
pub struct GithubSyncServiceImpl<D: DocumentService, C: GithubSyncClient> {
    config: super::GithubSyncConfig,
    #[allow(dead_code)]
    document_service: Arc<D>,
    pub(crate) client: C,
}

impl<D: DocumentService, C: GithubSyncClient> GithubSyncServiceImpl<D, C> {
    /// Create a new github sync service.
    pub fn new(config: super::GithubSyncConfig, document_service: Arc<D>, client: C) -> Self {
        Self {
            config,
            document_service,
            client,
        }
    }
}

impl<D: DocumentService, C: GithubSyncClient> GithubSyncService for GithubSyncServiceImpl<D, C> {
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
        tracing::info!(event_type=?event_type, "processing github webhook event");

        if let GithubWebhookEventType::Unknown(ref name) = event_type {
            tracing::debug!(event_type=%name, "skipping unknown event type");
            return Ok(());
        }

        let searchable_texts = webhook_event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let all_task_ids = MacroTaskId::extract_from_text(&combined);

        if all_task_ids.is_empty() {
            tracing::debug!(event_type=?event_type, "no task IDs found in event");
            return Ok(());
        }

        // For PR events we process ALL task IDs (the PR itself is the context).
        // For comment/review events we only process task IDs that are new
        // relative to the surrounding PR context, so that e.g. a comment
        // saying "Fixes MACRO-X" on a PR already titled MACRO-X does not
        // trigger a duplicate comment.
        let is_pr_event = event_type == GithubWebhookEventType::PullRequest;

        let task_ids_for_comment: Vec<_> = if is_pr_event {
            all_task_ids.clone()
        } else {
            let pr_context = webhook_event.extract_pr_context_text().join(" ");
            let existing: std::collections::HashSet<_> =
                MacroTaskId::extract_from_text(&pr_context)
                    .into_iter()
                    .collect();
            all_task_ids
                .iter()
                .filter(|id| !existing.contains(*id))
                .cloned()
                .collect()
        };

        if task_ids_for_comment.is_empty() {
            tracing::debug!(
                event_type=?event_type,
                "all task IDs already present in PR context, skipping"
            );
            return Ok(());
        }

        // Acquire an installation token and fetch existing PR comments once,
        // so we can check for duplicates without an API call per task.
        let pr_meta = match (
            webhook_event.installation_id(),
            webhook_event.repo_owner(),
            webhook_event.repo_name(),
            webhook_event.pull_number(),
        ) {
            (Some(installation_id), Some(owner), Some(repo), Some(pull_number)) => {
                match self
                    .generate_installation_access_token(installation_id)
                    .await
                {
                    Ok(token) => {
                        let existing_comments = self
                            .client
                            .list_pr_comments(&token.token, owner, repo, pull_number)
                            .await
                            .inspect_err(|e| {
                                tracing::error!(error=?e, "failed to list PR comments");
                            })
                            .unwrap_or_default();
                        Some((
                            token,
                            owner.to_string(),
                            repo.to_string(),
                            pull_number,
                            existing_comments,
                        ))
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
            _ => {
                tracing::warn!("missing PR metadata, cannot post comments");
                None
            }
        };

        // Resolve task IDs to documents. We always collect doc IDs for
        // status updates, but only add to task_links if not already
        // commented (to avoid duplicate PR comments).
        let mut task_links: Vec<String> = Vec::new();
        let mut task_doc_ids: Vec<String> = Vec::new();

        for task_id in &task_ids_for_comment {
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

            tracing::info!(
                task_id=%task_id,
                uuid=%uuid,
                event_type=?event_type,
                "detected potential macro task ID in github event",
            );

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
                    // converting to string here to avoid needing to bring models crate
                    // into github crate
                    if let Some(sub_type) = document.document_metadata.sub_type
                        && sub_type.to_string() == "task"
                    {
                        tracing::info!(task_id=%uuid, "task found");
                        let doc_name = &document.document_metadata.document_name;
                        let doc_id = &document.document_metadata.document_id;

                        // Always track for status updates
                        task_doc_ids.push(doc_id.clone());

                        // Only add comment link if not already posted
                        let already_commented = pr_meta
                            .as_ref()
                            .map(|(_, _, _, _, existing_comments)| {
                                let task_link = format!("/app/task/{doc_id})");
                                existing_comments.iter().any(|c| c.contains(&task_link))
                            })
                            .unwrap_or(false);

                        if already_commented {
                            tracing::debug!(
                                task_id=%uuid,
                                "PR already has a comment linking to this task, skipping comment"
                            );
                        } else {
                            task_links.push(create_macro_task_comment_link(doc_name, doc_id));
                        }
                    }
                }
                Err(e) => match e {
                    DocumentError::NotFound(_) => (),
                    _ => tracing::error!(error=?e, "unable to get document"),
                },
            }
        }

        // Post a single comment mentioning all newly discovered tasks
        if !task_links.is_empty()
            && let Some((ref token, ref owner, ref repo, pull_number, _)) = pr_meta
        {
            let comment_body = task_links.join("\n");
            self.client
                .create_pr_comment(&token.token, owner, repo, pull_number, &comment_body)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "failed to create PR comment");
                })
                .ok();
        }

        // Update task statuses for all resolved tasks
        if let Some(status) = webhook_event.task_status_for_event() {
            for doc_id in &task_doc_ids {
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

        Ok(())
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
