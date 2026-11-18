//! Legacy deleted-user inbox lookup and deletion queue publication.

use super::persistence_error::InboxPersistenceError;
use email::domain::mailbox::{catalog::InboxCredentialOwnerLookup, lifecycle::InboxDeletionQueue};
use models_email::service::pubsub::{DeletionReason, LinkManagerMessage};
use uuid::Uuid;

pub struct PgDeletedUserInboxes(pub sqlx::PgPool);

impl InboxCredentialOwnerLookup for PgDeletedUserInboxes {
    type Err = InboxPersistenceError;

    async fn by_credential_owner(&self, owner: &str) -> Result<Vec<Uuid>, Self::Err> {
        Ok(
            email_db_client::links::get::fetch_links_by_fusionauth_user_id(&self.0, owner)
                .await?
                .into_iter()
                .map(|link| link.id)
                .collect(),
        )
    }
}

pub struct DeletedUserNotifications(pub sqs_client::SQS);

impl InboxDeletionQueue for DeletedUserNotifications {
    type Err = InboxPersistenceError;

    async fn request_deletion(
        &self,
        link_id: Uuid,
        reason: DeletionReason,
    ) -> Result<(), Self::Err> {
        self.0
            .enqueue_link_manager_notification(LinkManagerMessage::DeleteLink {
                link_id,
                deletion_reason: reason,
            })
            .await
            .map_err(Into::into)
    }
}
