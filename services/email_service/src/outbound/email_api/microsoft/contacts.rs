use super::*;
use email::domain::mailbox::contacts::AddressBookGateway;

impl<R, T, L> AddressBookGateway for ProviderMailboxGateway<R, T, L>
where
    R: MailboxAddressBookReader + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
{
    async fn folders(&self, mailbox: MailboxKey) -> Result<ContactFolderCatalog, EmailApiError> {
        self.0.contact_folders(access(mailbox)).await
    }
    async fn profile(&self, mailbox: MailboxKey) -> Result<AddressBookContact, EmailApiError> {
        self.0.self_contact(access(mailbox)).await
    }
    async fn changes(
        &self,
        mailbox: MailboxKey,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> Result<AddressBookPage, EmailApiError> {
        self.0
            .contact_changes(access(mailbox), folder, position)
            .await
    }
    async fn photo(
        &self,
        mailbox: MailboxKey,
        contact: Option<(&ProviderId, &ProviderId)>,
    ) -> Result<Option<ContactPhoto>, EmailApiError> {
        self.0.contact_photo(access(mailbox), contact).await
    }
}
