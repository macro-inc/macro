use super::*;

// Retry only a definitive authentication rejection. In particular, never replay
// a timed-out POST or PUT from this layer: its coordinator must reconcile first.
macro_rules! authenticated {
    ($service:ident, $mailbox:ident, $operation:expr, $repository:ident, $token:ident, $call:expr) => {{
        let $repository = $service.repository.for_mailbox($mailbox);
        let $token = $service
            .token($mailbox, $operation, TokenFreshness::Cached)
            .await?;
        match $call.await {
            Err(EmailApiError::AuthRequired) => {
                let $token = $service
                    .token($mailbox, $operation, TokenFreshness::Fresh)
                    .await?;
                $call.await
            }
            result => result,
        }
    }};
}

impl<R: MailboxDraftClient + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxApiService<R, T, L>
{
    /// Read a draft's current concurrency token and last app revision.
    pub async fn get_draft(
        &self,
        mailbox: MailboxAccess,
        id: &ProviderId,
    ) -> Result<Option<ProviderDraft>, EmailApiError> {
        authenticated!(
            self,
            mailbox,
            ApiOperationKind::GetMessage,
            repository,
            token,
            repository.get_draft(&token, id)
        )
    }
    /// Locate a creation whose response was lost, including its eventual sent copy.
    pub async fn find_drafts(
        &self,
        mailbox: MailboxAccess,
        correlation: uuid::Uuid,
    ) -> Result<Vec<ProviderDraft>, EmailApiError> {
        authenticated!(
            self,
            mailbox,
            ApiOperationKind::ListMessages,
            repository,
            token,
            repository.find_drafts(&token, correlation)
        )
    }

    /// Create one draft after the caller durably records that creation may occur.
    pub async fn create_draft(
        &self,
        mailbox: MailboxAccess,
        request: &DraftRequest,
    ) -> Result<ProviderDraft, EmailApiError> {
        authenticated!(
            self,
            mailbox,
            ApiOperationKind::SendMessage,
            repository,
            token,
            repository.create_draft(&token, request)
        )
    }

    /// Update the draft version observed by its owner.
    pub async fn update_draft(
        &self,
        mailbox: MailboxAccess,
        id: &ProviderId,
        request: &DraftRequest,
        expected_version: &str,
    ) -> Result<ProviderDraft, EmailApiError> {
        authenticated!(
            self,
            mailbox,
            ApiOperationKind::SendMessage,
            repository,
            token,
            repository.update_draft(&token, id, request, expected_version)
        )
    }

    /// Delete a specific draft version; an already-missing draft is success.
    pub async fn delete_draft(
        &self,
        mailbox: MailboxAccess,
        id: &ProviderId,
        expected_version: &str,
    ) -> Result<(), EmailApiError> {
        authenticated!(
            self,
            mailbox,
            ApiOperationKind::SendMessage,
            repository,
            token,
            repository.delete_draft(&token, id, expected_version)
        )
    }

    /// List current attachments to reconcile stable content IDs before writing.
    pub async fn draft_attachments(
        &self,
        mailbox: MailboxAccess,
        id: &ProviderId,
    ) -> Result<Vec<DraftAttachment>, EmailApiError> {
        authenticated!(
            self,
            mailbox,
            ApiOperationKind::GetAttachment,
            repository,
            token,
            repository.draft_attachments(&token, id)
        )
    }

    /// Add a small attachment exactly once per durable transfer attempt.
    pub async fn add_attachment(
        &self,
        mailbox: MailboxAccess,
        draft: &ProviderId,
        attachment: AttachmentContent<'_>,
    ) -> Result<DraftAttachment, EmailApiError> {
        authenticated!(
            self,
            mailbox,
            ApiOperationKind::SendMessage,
            repository,
            token,
            repository.add_attachment(&token, draft, attachment)
        )
    }

    /// Remove only the attachment identity frozen in the caller's intent.
    pub async fn delete_attachment(
        &self,
        mailbox: MailboxAccess,
        draft: &ProviderId,
        attachment: &ProviderId,
    ) -> Result<(), EmailApiError> {
        authenticated!(
            self,
            mailbox,
            ApiOperationKind::SendMessage,
            repository,
            token,
            repository.delete_attachment(&token, draft, attachment)
        )
    }

    /// Start a transfer; the caller persists this checkpoint before uploading bytes.
    pub async fn create_upload(
        &self,
        mailbox: MailboxAccess,
        draft: &ProviderId,
        attachment: AttachmentContent<'_>,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        authenticated!(
            self,
            mailbox,
            ApiOperationKind::SendMessage,
            repository,
            token,
            repository.create_upload(&token, draft, attachment)
        )
    }

    /// Validate the mailbox generation even though the upload URL is preauthorized.
    pub async fn inspect_upload(
        &self,
        mailbox: MailboxAccess,
        url: &UploadUrl,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        self.token(
            mailbox,
            ApiOperationKind::GetAttachment,
            TokenFreshness::Cached,
        )
        .await?;
        self.repository
            .for_mailbox(mailbox)
            .inspect_upload(url)
            .await
    }

    /// Upload one range without an OAuth header or automatic retry.
    pub async fn upload_range(
        &self,
        mailbox: MailboxAccess,
        url: &UploadUrl,
        offset: u64,
        total: u64,
        bytes: &[u8],
    ) -> Result<UploadProgress, EmailApiError> {
        self.token(
            mailbox,
            ApiOperationKind::SendMessage,
            TokenFreshness::Cached,
        )
        .await?;
        self.repository
            .for_mailbox(mailbox)
            .upload_range(url, offset, total, bytes)
            .await
    }
}
