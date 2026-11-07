//! Initialization leases, completion accounting and follow-up capabilities.
use super::BackfillDatabaseError;
use crate::domain::mailbox::inbox_sync::{InboxSyncAttachmentRecipients, LabelCatalogRepository};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{attachment::AttachmentUploadMetadata, link::Link};
use uuid::Uuid;

/// Result of attempting to claim an initialization lease.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitLeaseClaim {
    /// This caller owns the lease token.
    Claimed(Uuid),
    /// Initialization already reached a later durable state.
    Complete,
    /// Another worker owns initialization.
    Busy,
    /// The job does not exist.
    NotFound,
}
/// Result of renewing an initialization lease.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitLeaseRenewal {
    /// Lease extended.
    Renewed,
    /// Initialization reached a later durable state.
    Complete,
    /// This caller no longer owns the lease.
    Lost,
    /// The job does not exist.
    NotFound,
}
/// Result of atomically completing a backfill job.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackfillCompletion {
    /// This caller completed the job and published its effects.
    Completed,
    /// The job was already terminal.
    AlreadyTerminal,
    /// The active job requires a different lease owner.
    LeaseLost,
    /// The job does not exist.
    NotFound,
}
/// Thread progress returned by the existing atomic counter.
#[derive(Clone, Copy, Debug, Default)]
pub struct BackfillProgress {
    /// Completed thread count including this increment.
    pub completed_threads: i32,
    /// Current completion target, including the priority pass.
    pub total_threads: i32,
    /// Whether this increment reached the target.
    pub job_complete: bool,
}
/// Initialization leases and the initial thread budget.
pub trait BackfillInitRepository:
    LabelCatalogRepository<CatalogError = BackfillDatabaseError> + Send + Sync
{
    /// Claim initialization.
    fn claim_init_lease(
        &self,
        job: Uuid,
    ) -> impl Future<Output = anyhow::Result<InitLeaseClaim>> + Send;
    /// Renew initialization.
    fn renew_init_lease(
        &self,
        job: Uuid,
        token: Uuid,
    ) -> impl Future<Output = anyhow::Result<InitLeaseRenewal>> + Send;
    /// Release initialization after a failure.
    fn release_init_lease(
        &self,
        job: Uuid,
        token: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Store the initial thread budget.
    fn update_total_threads(
        &self,
        job: Uuid,
        total: i32,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Atomically finalize initialization and create its outbox row.
    fn finalize_initialization(
        &self,
        job: Uuid,
        token: Uuid,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
}
/// Atomic completion and its fenced effects lease.
pub trait BackfillCompletionRepository: Send + Sync {
    /// Complete the job and publish completion effects atomically.
    fn complete_job(
        &self,
        job: Uuid,
        token: Option<Uuid>,
    ) -> impl Future<Output = anyhow::Result<BackfillCompletion>> + Send;
    /// Claim pending completion effects.
    fn claim_completion(
        &self,
        job: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<Uuid>>> + Send;
    /// Determine whether completion effects remain pending.
    fn completion_pending(&self, job: Uuid) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Release the completion lease after failure.
    fn release_completion(
        &self,
        job: Uuid,
        token: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Renew the completion lease.
    fn renew_completion(
        &self,
        job: Uuid,
        token: Uuid,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Retire completion effects.
    fn retire_completion(
        &self,
        job: Uuid,
        token: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
/// Stored facts used to fan out attachment and contact follow-ups.
pub trait BackfillFollowupRepository: Send + Sync {
    /// Read job attachments that need an upload.
    fn job_attachments(
        &self,
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<Vec<AttachmentUploadMetadata>>> + Send;
    /// Read document and media attachments concurrently.
    fn thread_attachments(
        &self,
        thread: Uuid,
    ) -> impl Future<
        Output = anyhow::Result<(Vec<AttachmentUploadMetadata>, Vec<AttachmentUploadMetadata>)>,
    > + Send;
    /// Read stored recipients in bulk.
    fn attachment_recipients(
        &self,
        messages: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<InboxSyncAttachmentRecipients>> + Send;
    /// Read contact addresses in their stored order.
    fn contact_emails(
        &self,
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<Vec<String>>> + Send;
}
/// Existing contacts, progress and notification effects used during lifecycle work.
pub trait BackfillLifecycleEffects: Send + Sync {
    /// Run the shared contact sync implementation without changing its leaves.
    fn sync_contacts(&self, link: &Link) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Best-effort creation of colleague conversations.
    fn colleague_dms(&self, link: &Link) -> impl Future<Output = ()> + Send;
    /// Best-effort creation of conversations with frequent contacts.
    fn top_contact_dms(&self, link: &Link) -> impl Future<Output = ()> + Send;
    /// Initialize the existing progress keys.
    fn init_progress(
        &self,
        job: Uuid,
        total: i32,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Increment thread progress through the existing atomic counter.
    fn increment_threads(
        &self,
        job: Uuid,
    ) -> impl Future<Output = anyhow::Result<BackfillProgress>> + Send;
    /// Increment message progress through the existing atomic counter.
    fn increment_messages(
        &self,
        job: Uuid,
        thread: &str,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Send the existing progress refresh, best effort.
    fn refresh_progress(
        &self,
        owner: &MacroUserIdStr<'static>,
        link_id: Uuid,
        progress: BackfillProgress,
    ) -> impl Future<Output = ()> + Send;
    /// Publish ordered contact connections using the existing ingress.
    fn connect_contacts(
        &self,
        owner: &MacroUserIdStr<'static>,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}
