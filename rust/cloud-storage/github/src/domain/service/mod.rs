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
        ports::GithubSyncService,
    };
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use subtle::ConstantTimeEq;
    type HmacSha256 = Hmac<Sha256>;

    /// The concrete github sync service implementation.
    pub struct GithubSyncServiceImpl {
        config: super::GithubSyncConfig,
    }

    impl GithubSyncServiceImpl {
        /// Create a new github sync service.
        pub fn new(config: super::GithubSyncConfig) -> Self {
            Self { config }
        }
    }

    impl GithubSyncService for GithubSyncServiceImpl {
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

            for task_id in &task_ids {
                match task_id.to_uuid() {
                    Ok(uuid) => {
                        tracing::info!(
                            task_id=%task_id,
                            uuid=%uuid,
                            event_type=?event_type,
                            "detected macro task ID in github event"
                        );
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

            let client = reqwest::Client::new();
            let response = client
                .post(format!(
                    "https://api.github.com/app/installations/{installation_id}/access_tokens"
                ))
                .header("Authorization", format!("Bearer {jwt}"))
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "Macro-Auth-Service")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .send()
                .await
                .map_err(|e| GithubError::Internal(e.into()))?;

            let status = response.status();
            if !status.is_success() {
                let error_body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "unknown error".to_string());
                return Err(GithubError::Internal(anyhow::anyhow!(
                    "failed to create installation access token (status {status}): {error_body}"
                )));
            }

            let token: GithubInstallationAccessToken = response
                .json()
                .await
                .map_err(|e| GithubError::Internal(e.into()))?;

            Ok(token)
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

#[cfg(feature = "link")]
pub use link_impl::*;
