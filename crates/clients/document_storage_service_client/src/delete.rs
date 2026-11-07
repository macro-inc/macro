#[cfg(test)]
mod test;

use super::DocumentStorageServiceClient;
use anyhow::Result;
use model_owner::Owner;
use rootcause::{Report, prelude::*};
use shared_entity_registry::RegisteredEntityType;
use uuid::Uuid;

/// Why document storage did not purge an owned entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PurgeOwnedEntityError {
    /// The entity exists under another owner. Nothing was deleted.
    #[error("the entity has another owner")]
    OwnedElsewhere,
    /// The request did not complete. The cause is the transport error.
    #[error("unable to reach document storage service")]
    Unreachable,
    /// Document storage answered with a status that is not a purge outcome,
    /// such as a 404 from a deployment without the route. The attachment
    /// carries the response body.
    #[error("document storage service answered {status}")]
    UnexpectedResponse {
        /// The HTTP status code.
        status: u16,
    },
}

impl DocumentStorageServiceClient {
    /// Deletes all items for a user
    #[tracing::instrument(skip(self))]
    pub async fn delete_all_user_items(&self, user_id: &str) -> Result<()> {
        let res = self
            .client
            .delete(format!("{}/internal/users/{}", self.url, user_id))
            .send()
            .await?;

        let status_code = res.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from document storage service"
            );
            anyhow::bail!(body);
        }

        Ok(())
    }

    /// Permanently delete a document, chat, or project if `owner` still owns it.
    ///
    /// `Ok` means the entity is gone, deleted now or already missing, and the
    /// removal of its stored content, search, and activity is enqueued.
    /// [`PurgeOwnedEntityError::OwnedElsewhere`] means another owner holds it
    /// and nothing was deleted. After any other error the entity may remain,
    /// and a retry repeats the purge.
    #[tracing::instrument(skip(self, owner), fields(owner.kind = ?owner.owner_type()), err)]
    pub async fn purge_owned_entity(
        &self,
        entity_type: RegisteredEntityType,
        entity_id: Uuid,
        owner: &Owner,
    ) -> Result<(), Report<PurgeOwnedEntityError>> {
        let response = self
            .client
            .delete(format!(
                "{}/internal/owned/{entity_type}/{entity_id}",
                self.url
            ))
            .query(&[("owner", owner.principal_id())])
            .send()
            .await
            .context(PurgeOwnedEntityError::Unreachable)?;
        match response.status() {
            reqwest::StatusCode::NO_CONTENT => Ok(()),
            reqwest::StatusCode::CONFLICT => Err(report!(PurgeOwnedEntityError::OwnedElsewhere)),
            status => {
                let body = response.text().await.unwrap_or_default();
                Err(report!(PurgeOwnedEntityError::UnexpectedResponse {
                    status: status.as_u16(),
                })
                .attach(body))
            }
        }
    }
}

/// A vault namespace was not acknowledged as erased by its owning service.
#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum VaultLifecycleRequestError {
    /// Namespace erasure is still pending and can be retried.
    #[error("vault cleanup pending")]
    Busy,
    /// The required lifecycle provider or role is unavailable.
    #[error("vault cleanup unavailable")]
    Unavailable,

    /// The deletion request did not complete.
    #[error("unable to reach vault owning service")]
    Unreachable,
    /// Only an explicit 204 acknowledgement permits team metadata deletion.
    #[error("vault owning service rejected erasure with status {0}")]
    Rejected(u16),
}
impl DocumentStorageServiceClient {
    /// Purge the team's vault before cascading metadata can lose its cleanup identities.
    #[tracing::instrument(skip_all, err, name="passwords.lifecycle.purge.request",fields(team_id=%team))]
    pub async fn purge_team_vault(&self, team: Uuid) -> Result<(), VaultLifecycleRequestError> {
        self.vault_lifecycle_request(reqwest::Method::DELETE, &["teams", &team.to_string()])
            .await
    }
    async fn vault_lifecycle_request(
        &self,
        method: reqwest::Method,
        resource: &[&str],
    ) -> Result<(), VaultLifecycleRequestError> {
        let mut url =
            reqwest::Url::parse(&self.url).map_err(|_| VaultLifecycleRequestError::Unreachable)?;
        url.path_segments_mut()
            .map_err(|_| VaultLifecycleRequestError::Unreachable)?
            .pop_if_empty()
            .extend(["internal", "passwords"])
            .extend(resource);
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .lifecycle_client
            .request(method, url)
            .headers(headers)
            .header(
                crate::constants::MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY,
                &self.internal_auth_key,
            )
            .send()
            .await
            .map_err(|_| VaultLifecycleRequestError::Unreachable)?;
        match response.status() {
            reqwest::StatusCode::NO_CONTENT => Ok(()),
            reqwest::StatusCode::CONFLICT => Err(VaultLifecycleRequestError::Busy),
            reqwest::StatusCode::SERVICE_UNAVAILABLE => {
                Err(VaultLifecycleRequestError::Unavailable)
            }
            status => Err(VaultLifecycleRequestError::Rejected(status.as_u16())),
        }
    }
}
