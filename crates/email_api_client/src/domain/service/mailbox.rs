//! Generation-bound provider orchestration. Read retries are limited to one
//! explicit credential refresh after a definitive authentication rejection.

use crate::domain::{models::*, ports::*};

mod contacts;
mod drafts;
mod settings;
mod watches;

/// Provider capabilities composed with credential and quota ports.
#[derive(Clone)]
pub struct MailboxApiService<R, T, L> {
    repository: R,
    tokens: T,
    limiter: L,
}

impl<R, T, L> MailboxApiService<R, T, L> {
    /// Compose capabilities without embedding infrastructure or mailbox policy.
    pub fn new(repository: R, tokens: T, limiter: L) -> Self {
        Self {
            repository,
            tokens,
            limiter,
        }
    }
}

impl<R, T: MailboxTokenSource, L: ProviderRateLimiter> MailboxApiService<R, T, L> {
    async fn token(
        &self,
        mailbox: MailboxAccess,
        operation: ApiOperationKind,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, EmailApiError> {
        self.limiter
            .check_rate_limit(mailbox.link_id, operation)
            .await
            .map_err(EmailApiError::from)?;
        self.tokens
            .access_token(mailbox, freshness)
            .await
            .map_err(super::map_token_error)
    }
}

impl<
    R: MailboxContentReader + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
> MailboxApiService<R, T, L>
{
    /// Resolve the complete physical folder hierarchy.
    pub async fn folders(&self, mailbox: MailboxAccess) -> Result<Vec<MailFolder>, EmailApiError> {
        let token = self
            .token(
                mailbox,
                ApiOperationKind::ListLabels,
                TokenFreshness::Cached,
            )
            .await?;
        let repository = self.repository.for_mailbox(mailbox);
        match repository.folders(&token).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(mailbox, ApiOperationKind::ListLabels, TokenFreshness::Fresh)
                    .await?;
                repository.folders(&fresh).await
            }
            result => result,
        }
    }

    /// Fetch current mailbox state, including inline attachments and invitations.
    pub async fn message(
        &self,
        mailbox: MailboxAccess,
        id: &ProviderId,
        folders: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        let token = self
            .token(
                mailbox,
                ApiOperationKind::GetMessage,
                TokenFreshness::Cached,
            )
            .await?;
        let repository = self.repository.for_mailbox(mailbox);
        match repository
            .message(&token, mailbox.link_id, id, folders)
            .await
        {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(mailbox, ApiOperationKind::GetMessage, TokenFreshness::Fresh)
                    .await?;
                repository
                    .message(&fresh, mailbox.link_id, id, folders)
                    .await
            }
            result => result,
        }
    }

    /// Fetch lightweight organization facts for command reconciliation.
    pub async fn organization(
        &self,
        mailbox: MailboxAccess,
        id: &ProviderId,
        folders: &[MailFolder],
    ) -> Result<Option<MailboxOrganization>, EmailApiError> {
        let token = self
            .token(
                mailbox,
                ApiOperationKind::GetMessage,
                TokenFreshness::Cached,
            )
            .await?;
        let repository = self.repository.for_mailbox(mailbox);
        match repository
            .organization(&token, mailbox.link_id, id, folders)
            .await
        {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(mailbox, ApiOperationKind::GetMessage, TokenFreshness::Fresh)
                    .await?;
                repository
                    .organization(&fresh, mailbox.link_id, id, folders)
                    .await
            }
            result => result,
        }
    }

    /// Download an attachment with the same mailbox binding as its parent message.
    pub async fn attachment(
        &self,
        mailbox: MailboxAccess,
        message: &ProviderId,
        attachment: &ProviderId,
    ) -> Result<Vec<u8>, EmailApiError> {
        let token = self
            .token(
                mailbox,
                ApiOperationKind::GetAttachment,
                TokenFreshness::Cached,
            )
            .await?;
        let repository = self.repository.for_mailbox(mailbox);
        match repository.attachment(&token, message, attachment).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::GetAttachment,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository.attachment(&fresh, message, attachment).await
            }
            result => result,
        }
    }
}

impl<R: FolderChangeReader + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxApiService<R, T, L>
{
    /// Fetch one page; persistence and checkpoint decisions remain in the sync domain.
    pub async fn changes(
        &self,
        mailbox: MailboxAccess,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> Result<MailboxChangePage, EmailApiError> {
        let token = self
            .token(
                mailbox,
                ApiOperationKind::ListChanges,
                TokenFreshness::Cached,
            )
            .await?;
        let repository = self.repository.for_mailbox(mailbox);
        match repository.folder_changes(&token, folder, position).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::ListChanges,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository.folder_changes(&fresh, folder, position).await
            }
            result => result,
        }
    }
}

impl<
    R: MailboxActionWriter + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
> MailboxApiService<R, T, L>
{
    /// Execute a desired-state action once. Only an explicit 401 permits an
    /// immediate retry; uncertain writes return to the durable coordinator.
    pub async fn apply(
        &self,
        mailbox: MailboxAccess,
        message: &ProviderId,
        action: &MessageAction,
        expected_version: Option<&str>,
    ) -> Result<MessageWriteReceipt, EmailApiError> {
        let token = self
            .token(
                mailbox,
                ApiOperationKind::ModifyMessageLabels,
                TokenFreshness::Cached,
            )
            .await?;
        let repository = self.repository.for_mailbox(mailbox);
        match repository
            .apply_message_action(&token, message, action, expected_version)
            .await
        {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::ModifyMessageLabels,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository
                    .apply_message_action(&fresh, message, action, expected_version)
                    .await
            }
            result => result,
        }
    }

    /// Submit once and surface accepted/unknown outcomes without retrying them.
    pub async fn submit(
        &self,
        mailbox: MailboxAccess,
        draft: &ProviderId,
    ) -> Result<SubmissionOutcome, EmailApiError> {
        let token = self
            .token(
                mailbox,
                ApiOperationKind::SendMessage,
                TokenFreshness::Cached,
            )
            .await?;
        let repository = self.repository.for_mailbox(mailbox);
        match repository.submit_draft(&token, draft).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::SendMessage,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository.submit_draft(&fresh, draft).await
            }
            result => result,
        }
    }
}
