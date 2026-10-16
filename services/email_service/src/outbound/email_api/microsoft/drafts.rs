use super::*;
use email::domain::mailbox::drafts::ports::DraftGateway;

impl<
    R: MailboxDraftClient + MailboxActionWriter + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
> DraftGateway for ProviderMailboxGateway<R, T, L>
{
    async fn get_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> Result<Option<ProviderDraft>, EmailApiError> {
        self.0.get_draft(access(mailbox), id).await
    }
    async fn find_drafts(
        &self,
        mailbox: MailboxKey,
        id: uuid::Uuid,
    ) -> Result<Vec<ProviderDraft>, EmailApiError> {
        self.0.find_drafts(access(mailbox), id).await
    }
    async fn create_draft(
        &self,
        mailbox: MailboxKey,
        request: &DraftRequest,
    ) -> Result<ProviderDraft, EmailApiError> {
        self.0.create_draft(access(mailbox), request).await
    }
    async fn update_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        request: &DraftRequest,
        version: &str,
    ) -> Result<ProviderDraft, EmailApiError> {
        self.0
            .update_draft(access(mailbox), id, request, version)
            .await
    }
    async fn delete_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        version: &str,
    ) -> Result<(), EmailApiError> {
        self.0.delete_draft(access(mailbox), id, version).await
    }
    async fn attachments(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> Result<Vec<DraftAttachment>, EmailApiError> {
        self.0.draft_attachments(access(mailbox), id).await
    }
    async fn add_attachment(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        content: AttachmentContent<'_>,
    ) -> Result<DraftAttachment, EmailApiError> {
        self.0.add_attachment(access(mailbox), id, content).await
    }
    async fn delete_attachment(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        attachment: &ProviderId,
    ) -> Result<(), EmailApiError> {
        self.0
            .delete_attachment(access(mailbox), id, attachment)
            .await
    }
    async fn create_upload(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        content: AttachmentContent<'_>,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        self.0.create_upload(access(mailbox), id, content).await
    }
    async fn inspect_upload(
        &self,
        mailbox: MailboxKey,
        url: &UploadUrl,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        self.0.inspect_upload(access(mailbox), url).await
    }
    async fn upload_range(
        &self,
        mailbox: MailboxKey,
        url: &UploadUrl,
        offset: u64,
        total: u64,
        bytes: &[u8],
    ) -> Result<UploadProgress, EmailApiError> {
        self.0
            .upload_range(access(mailbox), url, offset, total, bytes)
            .await
    }
    async fn submit_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> Result<SubmissionOutcome, EmailApiError> {
        self.0.submit(access(mailbox), id).await
    }
}
