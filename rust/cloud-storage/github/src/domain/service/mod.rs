//! Github service implementation.

#[cfg(test)]
mod test;

use crate::domain::models::GithubError;

/// Github sync config
#[cfg(feature = "sync")]
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

/// Github link config
#[cfg(feature = "link")]
#[derive(Debug)]
pub struct GithubLinkConfig {
    /// The github application client id
    pub client_id: String,
    /// The github application client secret
    pub client_secret: String,
    /// The id of the github identity provider in fusionauth
    pub idp_id: String,
}

// ── Sync service ──────────────────────────────────────────────────────

#[cfg(feature = "sync")]
mod sync_impl {
    use super::*;
    use crate::domain::{
        models::{
            GithubInstallationAccessToken, GithubWebhookEventType, MacroTaskId,
            ValidatedGithubWebhookEvent,
        },
        ports::{GithubSyncClient, GithubSyncService},
    };
    use documents::domain::{models::DocumentError, ports::DocumentService};
    use entity_access::domain::models::ViewAccessLevel;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use std::sync::Arc;
    use subtle::ConstantTimeEq;
    type HmacSha256 = Hmac<Sha256>;

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
            let sig_bytes =
                hex::decode(signature).map_err(|_| GithubError::InvalidWebhookSignature)?;

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
            let task_ids = MacroTaskId::extract_from_text(&combined);

            if task_ids.is_empty() {
                tracing::debug!(event_type=?event_type, "no task IDs found in event");
                return Ok(());
            }

            // Filter out task IDs already present in the PR context (title, body, branch)
            // so that e.g. a comment saying "Fixes MACRO-X" on a PR already titled MACRO-X
            // does not trigger a duplicate association.
            let pr_context = webhook_event.extract_pr_context_text().join(" ");
            let existing_task_ids: std::collections::HashSet<_> =
                MacroTaskId::extract_from_text(&pr_context)
                    .into_iter()
                    .collect();

            let new_task_ids: Vec<_> = task_ids
                .into_iter()
                .filter(|id| !existing_task_ids.contains(id))
                .collect();

            if new_task_ids.is_empty() {
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

            for task_id in &new_task_ids {
                match task_id.to_uuid() {
                    Ok(uuid) => {
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

                                    if let Some((
                                        ref token,
                                        ref owner,
                                        ref repo,
                                        pull_number,
                                        ref existing_comments,
                                    )) = pr_meta
                                    {
                                        let doc_name = &document.document_metadata.document_name;
                                        let doc_id = &document.document_metadata.document_id;
                                        let comment_body =
                                            create_macro_task_comment_link(doc_name, doc_id);

                                        // Skip if we already posted a comment linking to this task
                                        let task_link = format!("/app/task/{doc_id})");
                                        if existing_comments.iter().any(|c| c.contains(&task_link))
                                        {
                                            tracing::debug!(
                                                task_id=%uuid,
                                                "PR already has a comment linking to this task, skipping"
                                            );
                                            continue;
                                        }

                                        self.client
                                            .create_pr_comment(
                                                &token.token,
                                                owner,
                                                repo,
                                                pull_number,
                                                &comment_body,
                                            )
                                            .await
                                            .inspect_err(|e| {
                                                tracing::error!(
                                                    error=?e,
                                                    "failed to create PR comment"
                                                );
                                            })
                                            .ok();
                                    }

                                    // TODO: update task status based on event
                                }
                            }
                            Err(e) => match e {
                                DocumentError::NotFound(_) => (),
                                _ => tracing::error!(error=?e, "unable to get document"),
                            },
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            task_id=%task_id,
                            error=?e,
                            "failed to convert task ID to UUID"
                        );
                    }
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
}

#[cfg(feature = "sync")]
pub use sync_impl::*;

// ── Link service ──────────────────────────────────────────────────────

#[cfg(feature = "link")]
mod link_impl {
    use super::*;
    use chrono::Utc;
    use macro_user_id::{
        lowercased::Lowercase,
        user_id::{MacroUserId, MacroUserIdStr},
    };

    use crate::domain::{
        models::GithubLink,
        ports::{Auth, GithubLinkService, GithubOauth, GithubRepo},
    };

    /// The concrete github link service implementation.
    pub struct GithubLinkServiceImpl<R: GithubRepo, U: GithubOauth, F: Auth> {
        repo: R,
        oauth: U,
        auth: F,
        config: super::GithubLinkConfig,
    }

    impl<R: GithubRepo, U: GithubOauth, F: Auth> GithubLinkServiceImpl<R, U, F> {
        /// Create a new github link service.
        pub fn new(repo: R, oauth: U, auth: F, config: super::GithubLinkConfig) -> Self {
            Self {
                repo,
                oauth,
                auth,
                config,
            }
        }
    }

    impl<R: GithubRepo, U: GithubOauth, F: Auth> GithubLinkService for GithubLinkServiceImpl<R, U, F> {
        #[tracing::instrument(skip(self), err)]
        fn construct_oauth_url<T: serde::Serialize + std::fmt::Debug + 'static>(
            &self,
            redirect_uri: &str,
            state: T,
        ) -> Result<String, GithubError> {
            self.oauth
                .construct_oauth_url(&self.config.client_id, redirect_uri, state)
                .map_err(|e| GithubError::Internal(e.into()))
        }

        #[tracing::instrument(skip(self), err)]
        async fn link_user(
            &self,
            user_id: &MacroUserId<Lowercase<'static>>,
            fusionauth_user_id: &uuid::Uuid,
            in_progess_link_id: &uuid::Uuid,
            redirect_uri: &str,
            code: &str,
        ) -> Result<GithubLink, GithubError> {
            let tokens = self
                .oauth
                .exchange_oauth_code_for_tokens(
                    &self.config.client_id,
                    &self.config.client_secret,
                    redirect_uri,
                    code,
                )
                .await
                .map_err(|e| GithubError::Internal(e.into()))?;

            let user_info = self
                .oauth
                .get_user_info(&tokens.access_token)
                .await
                .map_err(|e| GithubError::Internal(e.into()))?;

            tracing::trace!(user_info=?user_info, "got user info");

            // Check if Github account is already linked to a different user
            match self
                .repo
                .get_github_link_by_github_user_id(&user_info.id.to_string())
                .await
            {
                Ok(link) => {
                    if !link.macro_id.0.eq(user_id) {
                        return Err(GithubError::AccountAlreadyLinked);
                    }
                }
                Err(e) => {
                    let err: anyhow::Error = e.into();
                    // We should only error if the error is something other
                    // than the link not existing
                    if !err.to_string().contains("no rows returned") {
                        return Err(GithubError::Internal(err));
                    }
                }
            }

            self.auth
                .link_user(
                    fusionauth_user_id,
                    &self.config.idp_id,
                    &user_info.id.to_string(),
                    &user_info.login,
                    &tokens.access_token,
                )
                .await
                .map_err(|e| GithubError::Internal(e.into()))?;

            tracing::trace!("linked auth user");

            // create github link
            let link = GithubLink {
                id: macro_uuid::generate_uuid_v7(),
                macro_id: MacroUserIdStr(user_id.clone()),
                fusionauth_user_id: *fusionauth_user_id,
                github_username: user_info.login.clone(),
                github_user_id: user_info.id.to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            };

            tracing::debug!(
                fusionauth_user_id=%fusionauth_user_id,
                github_user_id=%user_info.id,
                github_username=%user_info.login,
                "creating github_links record"
            );

            self.repo
                .insert_github_link(&link)
                .await
                .map_err(|e| GithubError::Internal(e.into()))?;

            tracing::trace!("successfully linked github account");

            // SAFETY: this is ok to fail as we have an auto cleanup job for this table
            let _ = self
                .repo
                .delete_in_progress_user_link(in_progess_link_id)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "unable to delete in progress link id"));

            Ok(link)
        }
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

#[cfg(feature = "link")]
pub use link_impl::*;
