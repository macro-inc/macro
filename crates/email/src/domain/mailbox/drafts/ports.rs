use super::{
    super::{MailboxError, MailboxKey},
    models::*,
};
use email_api_client::domain::models::*;
use std::future::Future;
use uuid::Uuid;

pub trait DraftRepository: Send + Sync + 'static {
    fn claim_draft(
        &self,
        lease_id: Uuid,
        mode: DraftClaimMode,
    ) -> impl Future<Output = Result<Option<DraftLease>, MailboxError>> + Send;
    fn renew_draft(
        &self,
        lease: &DraftLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn draft_authorized(
        &self,
        lease: &DraftLease,
        actor: &str,
    ) -> impl Future<Output = Result<bool, MailboxError>> + Send;
    /// Fenced commit of the exact frozen revision; binds a newly created draft.
    fn checkpoint_draft(
        &self,
        lease: &DraftLease,
        checkpoint: &DraftCheckpoint,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release_draft(
        &self,
        lease: &DraftLease,
        seconds: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn fail_draft(
        &self,
        lease: &DraftLease,
        failure: DraftFailure,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// Records the synced revision without acknowledging a newer concurrent save.
    fn settle_draft(
        &self,
        lease: &DraftLease,
        checkpoint: &DraftCheckpoint,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// Atomically claims a due schedule and records Submitting before any send call.
    /// Rechecks revision, actor access, trash state and the cancellation boundary.
    fn start_delivery(
        &self,
        lease: &DraftLease,
        checkpoint: &DraftCheckpoint,
    ) -> impl Future<Output = Result<DeliveryStart, MailboxError>> + Send;
    /// Commits the sent identity, schedule and event outbox together.
    fn confirm_sent(
        &self,
        lease: &DraftLease,
        checkpoint: &DraftCheckpoint,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn confirm_deleted(
        &self,
        lease: &DraftLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}

pub trait DraftMaterializer: Send + Sync + 'static {
    /// Prepare only this lease's frozen input, resolving authorized attachment IDs.
    fn prepare_draft(
        &self,
        lease: &DraftLease,
    ) -> impl Future<Output = Result<PreparedDraft, MailboxError>> + Send;
    fn draft_file_bytes(
        &self,
        lease: &DraftLease,
        file: &DraftFile,
    ) -> impl Future<Output = Result<Vec<u8>, MailboxError>> + Send;
}

pub trait DraftGateway: Send + Sync + 'static {
    fn get_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> impl Future<Output = Result<Option<ProviderDraft>, EmailApiError>> + Send;
    fn find_drafts(
        &self,
        mailbox: MailboxKey,
        id: Uuid,
    ) -> impl Future<Output = Result<Vec<ProviderDraft>, EmailApiError>> + Send;
    fn create_draft(
        &self,
        mailbox: MailboxKey,
        request: &DraftRequest,
    ) -> impl Future<Output = Result<ProviderDraft, EmailApiError>> + Send;
    fn update_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        request: &DraftRequest,
        version: &str,
    ) -> impl Future<Output = Result<ProviderDraft, EmailApiError>> + Send;
    fn delete_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        version: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    fn attachments(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> impl Future<Output = Result<Vec<DraftAttachment>, EmailApiError>> + Send;
    fn add_attachment(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        content: AttachmentContent<'_>,
    ) -> impl Future<Output = Result<DraftAttachment, EmailApiError>> + Send;
    fn delete_attachment(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        attachment: &ProviderId,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    fn create_upload(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        content: AttachmentContent<'_>,
    ) -> impl Future<Output = Result<AttachmentUploadSession, EmailApiError>> + Send;
    fn inspect_upload(
        &self,
        mailbox: MailboxKey,
        url: &UploadUrl,
    ) -> impl Future<Output = Result<AttachmentUploadSession, EmailApiError>> + Send;
    fn upload_range(
        &self,
        mailbox: MailboxKey,
        url: &UploadUrl,
        offset: u64,
        total: u64,
        bytes: &[u8],
    ) -> impl Future<Output = Result<UploadProgress, EmailApiError>> + Send;
    fn submit_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> impl Future<Output = Result<SubmissionOutcome, EmailApiError>> + Send;
}

impl<T: DraftMaterializer> DraftMaterializer for std::sync::Arc<T> {
    async fn prepare_draft(&self, lease: &DraftLease) -> Result<PreparedDraft, MailboxError> {
        self.as_ref().prepare_draft(lease).await
    }
    async fn draft_file_bytes(
        &self,
        lease: &DraftLease,
        file: &DraftFile,
    ) -> Result<Vec<u8>, MailboxError> {
        self.as_ref().draft_file_bytes(lease, file).await
    }
}
