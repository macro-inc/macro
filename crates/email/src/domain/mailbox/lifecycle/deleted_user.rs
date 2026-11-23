//! Queue removal of a deleted credential owner's inboxes in their stored order.

use super::InboxLifecycleService;
use crate::domain::mailbox::catalog::InboxCredentialOwnerLookup;
use models_email::service::pubsub::DeletionReason;
use uuid::Uuid;

#[cfg(test)]
mod test;

pub trait InboxDeletionQueue: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;
    fn request_deletion(
        &self,
        link_id: Uuid,
        reason: DeletionReason,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum UserInboxDeletionError {
    #[error("unable to fetch links")]
    InboxLookupFailed,
}

impl<R: InboxCredentialOwnerLookup, Q: InboxDeletionQueue> InboxLifecycleService<R, Q> {
    pub async fn request_user_deletion(
        &self,
        fusionauth_user_id: &str,
    ) -> Result<(), UserInboxDeletionError> {
        tracing::info!(user_id = fusionauth_user_id, "Delete user called");
        let links = self
            .repo
            .by_credential_owner(fusionauth_user_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to fetch links");
                UserInboxDeletionError::InboxLookupFailed
            })?;

        for link_id in links {
            self.effects.request_deletion(link_id, DeletionReason::UserDeleted).await
                .inspect_err(|e| {
                    tracing::error!(error=?e, link_id=?link_id, "Failed to enqueue delete notification");
                })
                .ok();
        }
        Ok(())
    }
}
