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
