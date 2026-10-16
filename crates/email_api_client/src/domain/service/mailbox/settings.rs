use super::*;

impl<R: MailboxLabelClient + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxApiService<R, T, L>
{
    /// Fetch the complete category catalog for the current credential binding.
    pub async fn labels(
        &self,
        mailbox: MailboxAccess,
    ) -> Result<Vec<models_email::service::label::Label>, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::ListLabels,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.list_labels(&token, mailbox.link_id).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(mailbox, ApiOperationKind::ListLabels, TokenFreshness::Fresh)
                    .await?;
                repository.list_labels(&fresh, mailbox.link_id).await
            }
            result => result,
        }
    }
}

impl<R: MailboxLabelClient + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxApiService<R, T, L>
{
    /// Create a category once; the caller reconciles uncertain outcomes by name.
    pub async fn create_label(
        &self,
        mailbox: MailboxAccess,
        name: &str,
    ) -> Result<models_email::service::label::Label, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::CreateLabel,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.create_label(&token, mailbox.link_id, name).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::CreateLabel,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository.create_label(&fresh, mailbox.link_id, name).await
            }
            result => result,
        }
    }
}

impl<R: MailboxLabelClient + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxApiService<R, T, L>
{
    /// Delete a known category after its message assignments are removed.
    pub async fn delete_label(
        &self,
        mailbox: MailboxAccess,
        name: &str,
    ) -> Result<(), EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::DeleteLabel,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.delete_label(&token, name).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::DeleteLabel,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository.delete_label(&fresh, name).await
            }
            result => result,
        }
    }
}

impl<
    R: MailboxSettingsClient + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
> MailboxApiService<R, T, L>
{
    /// Fetch one bounded batch of messages currently using a category.
    pub async fn category_messages(
        &self,
        mailbox: MailboxAccess,
        name: &str,
    ) -> Result<Vec<CategoryMessage>, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::ListMessages,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.category_messages(&token, name).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::ListMessages,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository.category_messages(&fresh, name).await
            }
            result => result,
        }
    }
}

impl<
    R: MailboxSettingsClient + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
> MailboxApiService<R, T, L>
{
    /// Read rules whose complete shape matches the Macro-owned rule contract.
    pub async fn sender_rules(
        &self,
        mailbox: MailboxAccess,
    ) -> Result<Vec<OwnedSenderRule>, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::ListBlockedSenders,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.sender_rules(&token).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::ListBlockedSenders,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository.sender_rules(&fresh).await
            }
            result => result,
        }
    }
}

impl<
    R: MailboxSettingsClient + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
> MailboxApiService<R, T, L>
{
    /// Create one exact-address trash rule with a persisted ownership nonce.
    pub async fn create_sender_rule(
        &self,
        mailbox: MailboxAccess,
        correlation: uuid::Uuid,
        sender: &str,
    ) -> Result<ProviderId, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::BlockSender,
                TokenFreshness::Cached,
            )
            .await?;
        match repository
            .create_sender_rule(&token, correlation, sender)
            .await
        {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::BlockSender,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository
                    .create_sender_rule(&fresh, correlation, sender)
                    .await
            }
            result => result,
        }
    }
}

impl<
    R: MailboxSettingsClient + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
> MailboxApiService<R, T, L>
{
    /// Remove an already-verified owned rule; a missing rule is success.
    pub async fn remove_sender_rule(
        &self,
        mailbox: MailboxAccess,
        id: &ProviderId,
    ) -> Result<(), EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::UnblockSender,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.remove_sender_rule(&token, id).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::UnblockSender,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository.remove_sender_rule(&fresh, id).await
            }
            result => result,
        }
    }
}
