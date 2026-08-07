use models_email::service::contact::{Contact, ContactList};
use uuid::Uuid;

use super::super::models::EmailApiError;
use super::super::ports::{MailboxContactsClient, ProviderRateLimiter, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxContactsClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Fetches the linked mailbox owner's contact record.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_self_contact(&self, link_id: Uuid) -> Result<Contact, EmailApiError> {
        let access_token = self
            .prepare(link_id, ApiOperationKind::ListContacts)
            .await?;

        self.repository
            .get_self_contact(&access_token, link_id)
            .await
    }

    /// Lists primary contacts, optionally continuing an incremental synchronization.
    #[tracing::instrument(skip(self, sync_token), err)]
    pub async fn list_contacts(
        &self,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        let access_token = self
            .prepare(link_id, ApiOperationKind::ListContacts)
            .await?;

        self.repository
            .list_contacts(&access_token, link_id, sync_token)
            .await
    }

    /// Lists automatically collected contacts, optionally continuing a synchronization.
    #[tracing::instrument(skip(self, sync_token), err)]
    pub async fn list_other_contacts(
        &self,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        let access_token = self
            .prepare(link_id, ApiOperationKind::ListContacts)
            .await?;

        self.repository
            .list_other_contacts(&access_token, link_id, sync_token)
            .await
    }
}

#[cfg(test)]
mod test;
