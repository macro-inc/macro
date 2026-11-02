use models_email::service::contact::{Contact, ContactList};
use uuid::Uuid;

use super::super::models::{AccessToken, ContactPage, EmailApiError};
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
    #[tracing::instrument(
        skip(self, sync_token),
        fields(
            retry_count = 0,
            pages = tracing::field::Empty,
            gate_in_flight = tracing::field::Empty,
            gate_cap = tracing::field::Empty
        ),
        err(level = "warn")
    )]
    pub async fn list_contacts(
        &self,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        self.list_contact_pages(link_id, |token, page_token| async move {
            self.repository
                .list_contacts_page(&token, link_id, sync_token, page_token.as_deref())
                .await
        })
        .await
    }

    /// Lists automatically collected contacts, optionally continuing a synchronization.
    ///
    /// Failures log at WARN for the same reasons as [`Self::list_contacts`].
    #[tracing::instrument(
        skip(self, sync_token),
        fields(
            retry_count = 0,
            pages = tracing::field::Empty,
            gate_in_flight = tracing::field::Empty,
            gate_cap = tracing::field::Empty
        ),
        err(level = "warn")
    )]
    pub async fn list_other_contacts(
        &self,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        self.list_contact_pages(link_id, |token, page_token| async move {
            self.repository
                .list_other_contacts_page(&token, link_id, sync_token, page_token.as_deref())
                .await
        })
        .await
    }

    /// Reads every page of a contact list. Each page is its own admission, and
    /// a refusal or failure on any page fails the whole read.
    async fn list_contact_pages<F, Fut>(
        &self,
        link_id: Uuid,
        read_page: F,
    ) -> Result<ContactList, EmailApiError>
    where
        F: Fn(AccessToken, Option<String>) -> Fut,
        Fut: Future<Output = Result<ContactPage, EmailApiError>>,
    {
        let mut contacts = Vec::new();
        let mut next_sync_token = None;
        let mut page_token: Option<String> = None;
        let mut pages = 0;
        loop {
            let page = self
                .retry_with_fresh_token(link_id, ApiOperationKind::ListContacts, |token| {
                    read_page(token, page_token.clone())
                })
                .await??;
            pages += 1;
            contacts.extend(page.contacts);
            next_sync_token = page.next_sync_token.or(next_sync_token);
            page_token = page.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
        tracing::Span::current().record("pages", pages);
        let next_sync_token = next_sync_token.ok_or_else(|| EmailApiError::Permanent {
            message: "the provider returned no sync token with the last contacts page".to_string(),
        })?;
        Ok(ContactList {
            contacts,
            next_sync_token,
        })
    }
}

#[cfg(test)]
mod test;
