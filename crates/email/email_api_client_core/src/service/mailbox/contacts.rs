use super::*;

impl<
    R: MailboxAddressBookReader + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
> MailboxApiService<R, T, L>
{
    /// Resolve the personal contact folder catalog with generation-bound credentials.
    pub async fn contact_folders(
        &self,
        mailbox: MailboxAccess,
    ) -> Result<ContactFolderCatalog, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::ListContacts,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.contact_folders(&token).await {
            Err(EmailApiError::AuthRequired) => {
                repository
                    .contact_folders(
                        &self
                            .token(
                                mailbox,
                                ApiOperationKind::ListContacts,
                                TokenFreshness::Fresh,
                            )
                            .await?,
                    )
                    .await
            }
            result => result,
        }
    }
    /// Fetch one page from an independent contact stream.
    pub async fn contact_changes(
        &self,
        mailbox: MailboxAccess,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> Result<AddressBookPage, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::ListContacts,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.contact_changes(&token, folder, position).await {
            Err(EmailApiError::AuthRequired) => {
                repository
                    .contact_changes(
                        &self
                            .token(
                                mailbox,
                                ApiOperationKind::ListContacts,
                                TokenFreshness::Fresh,
                            )
                            .await?,
                        folder,
                        position,
                    )
                    .await
            }
            result => result,
        }
    }
    /// Fetch the authenticated account's profile.
    pub async fn self_contact(
        &self,
        mailbox: MailboxAccess,
    ) -> Result<AddressBookContact, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::GetProfile,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.self_contact(&token).await {
            Err(EmailApiError::AuthRequired) => {
                repository
                    .self_contact(
                        &self
                            .token(mailbox, ApiOperationKind::GetProfile, TokenFreshness::Fresh)
                            .await?,
                    )
                    .await
            }
            result => result,
        }
    }
    /// Fetch image bytes without exposing the provider's authenticated URL.
    pub async fn contact_photo(
        &self,
        mailbox: MailboxAccess,
        contact: Option<(&ProviderId, &ProviderId)>,
    ) -> Result<Option<ContactPhoto>, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::ListContacts,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.contact_photo(&token, contact).await {
            Err(EmailApiError::AuthRequired) => {
                repository
                    .contact_photo(
                        &self
                            .token(
                                mailbox,
                                ApiOperationKind::ListContacts,
                                TokenFreshness::Fresh,
                            )
                            .await?,
                        contact,
                    )
                    .await
            }
            result => result,
        }
    }
}
