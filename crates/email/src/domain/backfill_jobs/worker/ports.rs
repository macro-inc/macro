//! Capabilities needed by backfill admission and operation policy.

use super::BackfillImportRepository;
use crate::domain::backfill_jobs::BackfillJobRepository;
use crate::domain::mailbox::connection::ConnectionSourceError;
use crate::domain::mailbox::inbox_sync::CrmContactRecipient;
use crm::domain::{
    email_privacy::EmailContributionMailbox,
    model::{CrmError, DepopulateContactOutcome},
};
use email_api_client::domain::models::{EmailApiError, MessageWithCalendarParts};
use futures::future::BoxFuture;
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{backfill::*, link::Link, pubsub::ProcessingError};
use std::collections::HashSet;
use uuid::Uuid;

/// A database error's original value and ordered SQLSTATE facts.
#[derive(Debug, thiserror::Error)]
#[error("{source}")]
pub struct BackfillDatabaseError {
    /// Original error, including its complete context chain.
    pub source: anyhow::Error,
    /// Codes in the order their database errors occur in that chain.
    pub sqlstates: Vec<String>,
}

impl ConnectionSourceError for BackfillDatabaseError {
    fn into_original(self) -> anyhow::Error {
        self.source
    }
}

/// The metadata transaction, with commit/rollback mechanics preserved by its adapter.
pub trait BackfillMetadataTransaction: Send {
    /// Update all denormalized thread metadata.
    fn update_metadata(
        &mut self,
        thread: Uuid,
        link: Uuid,
    ) -> impl Future<Output = Result<(), BackfillDatabaseError>> + Send;
    /// Reconcile replying-to references after the messages are stored.
    fn update_replying_to(
        &mut self,
        thread: Uuid,
        link: Uuid,
    ) -> impl Future<Output = Result<(), BackfillDatabaseError>> + Send;
    /// Commit success or roll back the original body failure.
    fn complete(
        self,
        result: Result<(), ProcessingError>,
    ) -> impl Future<Output = Result<(), ProcessingError>> + Send;
}

/// Stored facts and writes; existing job access is reused through `jobs`.
pub trait BackfillRepository: BackfillImportRepository + Send + Sync + 'static {
    /// Original persistence failures.
    type Err: ConnectionSourceError;
    /// Existing job repository.
    type Jobs: BackfillJobRepository<Err = Self::Err>;
    /// Metadata transaction.
    type Metadata: BackfillMetadataTransaction;
    /// Read and fail jobs through the existing backfill repository.
    fn jobs(&self) -> &Self::Jobs;
    /// Read a link by its identifier.
    fn link(&self, id: Uuid) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;
    /// Read the primary address's exact link.
    fn link_by_email(
        &self,
        owner: &str,
        email: &str,
    ) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;
    /// Read the attachment's existing document mapping.
    fn attachment_document(
        &self,
        link: Uuid,
        attachment: Uuid,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
    /// Whether any remaining message involves a contact.
    fn has_contact_messages(
        &self,
        link: Uuid,
        email: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Stored sent-recipient ranges in query order.
    fn sent_contacts(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<Vec<CrmContactRecipient>, Self::Err>> + Send;
    /// Stored received-sender ranges in query order.
    fn received_contacts(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<Vec<CrmContactRecipient>, Self::Err>> + Send;
    /// Begin the metadata transaction.
    fn begin_metadata(&self) -> impl Future<Output = Result<Self::Metadata, Self::Err>> + Send;
    /// Make the existing completion outbox row eligible for republication.
    fn republish_completion(&self, job: Uuid) -> impl Future<Output = ()> + Send;
}

/// Provider reads used by listing, imports and the sent-contact seed.
pub trait BackfillGmail: Send + Sync + 'static {
    /// List a provider page without altering its requested size or labels.
    fn list_threads<'a>(
        &'a self,
        link: Uuid,
        limit: u32,
        next: Option<&'a str>,
        labels: &'a [&'a str],
    ) -> BoxFuture<'a, Result<email_api_client::domain::models::ThreadListPage, EmailApiError>>;
    /// List recent sent message identifiers.
    fn list_messages<'a>(
        &'a self,
        link: Uuid,
        limit: u32,
        labels: &'a [&'a str],
    ) -> BoxFuture<'a, Result<Vec<String>, EmailApiError>>;
    /// Fetch all messages and calendar parts of a provider thread.
    fn thread<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
    ) -> BoxFuture<'a, Result<Vec<MessageWithCalendarParts>, EmailApiError>>;
    /// Fetch one message through the existing Gmail admission gate.
    fn message<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
    ) -> BoxFuture<'a, Result<Option<MessageWithCalendarParts>, EmailApiError>>;
}

/// Backfill publication without queue transport types.
pub trait BackfillQueue: Send + Sync + 'static {
    /// Original queue failure.
    type Err: ConnectionSourceError;
    /// Send an ordinary operation.
    fn enqueue(
        &self,
        data: BackfillPubsubMessage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Send a deferred operation with its delivery-budget attribute.
    fn defer(
        &self,
        data: &BackfillPubsubMessage,
        seconds: i32,
        deferrals: u32,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Attachment facts preserve the original error for the domain's classification.
#[derive(Debug, thiserror::Error)]
pub enum BackfillUploadError {
    /// The attachment disappeared after it was queued.
    #[error("Attachment was deleted before it could be imported")]
    Deleted,
    /// The provider refused admission.
    #[error("Gmail API rate limit exceeded")]
    RateLimited(EmailApiError),
    /// Another upload failure, with its original error type and formatting.
    #[error(transparent)]
    Failed(anyhow::Error),
}

/// A lease held across one write, retaining its renewal and release behavior.
pub trait BackfillWritePermit: Send {
    /// Hold and renew the lease until the supplied work completes.
    fn hold<F: Future + Send>(self, work: F) -> impl Future<Output = F::Output> + Send
    where
        F::Output: Send;
}

/// Existing progress, upload and publication effects.
pub trait BackfillEffects:
    BackfillImportEffects + MacroEventBroker + Send + Sync + 'static
{
    /// CRM write admission lease.
    type Permit: BackfillWritePermit;
    /// Drop job progress after a terminal job is observed.
    fn delete_job_progress(&self, job: Uuid) -> impl Future<Output = ()> + Send;
    /// Drop per-thread progress after a terminal message is observed.
    fn delete_thread_progress(&self, job: Uuid, thread: &str) -> impl Future<Output = ()> + Send;
    /// Upload through the original attachment implementation.
    fn upload(
        &self,
        link: &Link,
        payload: &BackfillAttachmentPayload,
    ) -> impl Future<Output = Result<(), BackfillUploadError>> + Send;
    /// Enqueue the existing two-user contact set.
    fn connect(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
    /// Acquire a team's existing CRM write lease.
    fn acquire_crm(
        &self,
        team: Uuid,
    ) -> impl Future<Output = Result<Option<Self::Permit>, anyhow::Error>> + Send;
    /// Publish a failed-job refresh, best effort.
    fn notify_failed(&self, link: &Link) -> impl Future<Output = ()> + Send;
}

/// CRM's existing domain operations, with their original errors.
pub trait BackfillCrm: Send + Sync + 'static {
    /// The current team, if any.
    fn get_team_id_for_user(
        &self,
        user: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, CrmError>> + Send;
    /// The currently consented mailbox, if any.
    fn contribution_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> impl Future<Output = Result<Option<EmailContributionMailbox>, CrmError>> + Send;
    /// Record one contact's interaction under the caller's write lease.
    fn populate_contact(
        &self,
        team: &Uuid,
        link: &Link,
        payload: &PopulateCrmContactPayload,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Remove one contact's contribution.
    fn depopulate_contact(
        &self,
        team: &Uuid,
        link: &Uuid,
        email: &str,
    ) -> impl Future<Output = Result<DepopulateContactOutcome, CrmError>> + Send;
    /// Remove the link's contributions within its previous team.
    fn depopulate_link_in_team(
        &self,
        team: &Uuid,
        link: &Uuid,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
}

/// Temporary boundary for the operations and completion accounting moved next.
pub trait LegacyBackfill: Send + Sync + 'static {
    /// Initialization.
    fn init(
        &self,
        scope: &JobScopedPayload<InitPayload>,
        link: &Link,
        job: &BackfillJob,
    ) -> impl Future<Output = Result<(), ProcessingError>> + Send;
    /// Finalize an empty listing through the existing completion service.
    fn completed_job(&self, job: Uuid) -> impl Future<Output = Result<(), ProcessingError>> + Send;
    /// Enqueue a written thread's attachment follow-ups.
    fn thread_attachments(
        &self,
        link: &Link,
        job: Uuid,
        thread: Uuid,
    ) -> impl Future<Output = Result<(), ProcessingError>> + Send;
    /// Enqueue the written thread's final metadata operation.
    fn enqueue_metadata(
        &self,
        link: &Link,
        job: Uuid,
        provider: &str,
        thread: Uuid,
    ) -> impl Future<Output = Result<(), ProcessingError>> + Send;
    /// Completion-outbox delivery.
    fn finalize(
        &self,
        link: Uuid,
        job: Uuid,
    ) -> impl Future<Output = Result<(), ProcessingError>> + Send;
    /// Count one completed thread through the existing completion service.
    fn completed_thread(
        &self,
        link: &Link,
        job: Uuid,
    ) -> impl Future<Output = Result<(), ProcessingError>> + Send;
    /// Count one completed message through the existing completion service.
    fn completed_message(
        &self,
        link: &Link,
        job: Uuid,
        payload: &BackfillMessagePayload,
    ) -> impl Future<Output = Result<(), ProcessingError>> + Send;
}

/// Import capabilities already used by the backfill preparation and lease paths.
pub trait BackfillImportEffects: crate::domain::mailbox::inbox_sync::InboxSyncPreparation {
    /// Grow the priority-pass completion budget before any thread is enqueued.
    fn add_total_threads(
        &self,
        job: Uuid,
        count: i32,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Clear an empty listing's progress, exposing its best-effort failure.
    fn delete_listing_progress(&self, job: Uuid)
    -> impl Future<Output = anyhow::Result<()>> + Send;
    /// A bulk write's current lease, using the existing real-clock implementation.
    type WritePermit: BackfillWritePermit;
    /// Acquire a fleet-wide bulk-write lease.
    fn acquire_write(
        &self,
    ) -> impl Future<Output = Result<Option<Self::WritePermit>, anyhow::Error>> + Send;
}
