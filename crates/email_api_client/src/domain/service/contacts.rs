use models_email::service::contact::{Contact, ContactList};
use uuid::Uuid;

use super::super::models::EmailApiError;
use super::super::ports::{MailboxContactsClient, ProviderRequestGate, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxContactsClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Fetches the linked mailbox owner's contact record.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn get_self_contact(&self, link_id: Uuid) -> Result<Contact, EmailApiError> {
        self.read_with_token(
            link_id,
            ApiOperationKind::ListContacts,
            |token| async move { self.repository.get_self_contact(&token, link_id).await },
        )
        .await
    }

    /// Lists primary contacts, optionally continuing an incremental synchronization.
    ///
    /// Failures log at WARN: an expired sync token ([`EmailApiError::OutdatedCursor`])
    /// or a grant without the contacts scopes is routine, and callers recover or skip.
    #[tracing::instrument(skip(self, sync_token), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty), err(level = "warn"))]
    pub async fn list_contacts(
        &self,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        self.retry_with_fresh_token(
            link_id,
            ApiOperationKind::ListContacts,
            |token| async move {
                self.repository
                    .list_contacts(&token, link_id, sync_token)
                    .await
            },
        )
        .await?
    }

    /// Lists automatically collected contacts, optionally continuing a synchronization.
    ///
    /// Failures log at WARN for the same reasons as [`Self::list_contacts`].
    #[tracing::instrument(skip(self, sync_token), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty), err(level = "warn"))]
    pub async fn list_other_contacts(
        &self,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        self.retry_with_fresh_token(
            link_id,
            ApiOperationKind::ListContacts,
            |token| async move {
                self.repository
                    .list_other_contacts(&token, link_id, sync_token)
                    .await
            },
        )
        .await?
    }
}

#[cfg(test)]
mod test;
