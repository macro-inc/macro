//! Capabilities used by history acceptance and provider-message import.
use super::*;
use crate::domain::{
    backfill_jobs::BackfillJobRepository,
    models::{EmailThreadPreview, PreviewCursorQuery},
};
use email_api_client::domain::models::EmailApiError;
use email_api_client::domain::models::{
    CalendarPart, ChangeBatch, MessageWithCalendarParts, SyncCursor,
};
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::attachment::{
    Attachment, AttachmentUploadArgs, AttachmentUploadMetadata,
};
use models_email::{db, service};
use std::collections::HashMap;
use uuid::Uuid;

/// Existing recipient rows keyed by the imported message identity.
pub type InboxSyncAttachmentRecipients =
    HashMap<Uuid, Vec<(db::contact::Contact, db::address::EmailRecipientType)>>;

/// Facts read before a stored message is fetched again from its provider.
#[derive(Clone, Debug, Default)]
pub struct InboxSyncResync {
    /// Provider labels stored before the fetch.
    pub stored_labels: Vec<String>,
    /// Labels with a local write on either side of the fetch.
    pub pending_labels: Vec<String>,
}

/// The host's existing feature switches, captured at worker composition.
#[derive(Clone, Copy, Default)]
pub struct InboxSyncFeatures {
    /// Import supported attachments into document or media storage.
    pub attachment_upload: bool,
    /// Publish contact connections for imported correspondence.
    pub contacts_sync: bool,
    /// Publish new-message notifications.
    pub notifications_enabled: bool,
}

/// Existing HistoryFacts capabilities for inbox imports.
pub trait InboxSyncHistoryFacts: InboxSyncRepository {
    /// Read the Gmail history ID by the original mailbox address lookup.
    fn history_id(
        &self,
        address: &str,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
    /// Persist a repaired cursor after recovery publication succeeds.
    fn repair_history(
        &self,
        link: Uuid,
        history: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Existing Catalog capabilities for inbox imports.
pub trait InboxSyncCatalog: InboxSyncRepository {
    /// Read the complete stored label catalog.
    fn catalog(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<Vec<service::label::Label>, Self::Err>> + Send;
    /// Delete catalog labels absent from the provider.
    fn delete_catalog(
        &self,
        link: Uuid,
        labels: Vec<String>,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;
    /// Insert or update the reconciled catalog.
    fn upsert_catalog(
        &self,
        labels: Vec<service::label::Label>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Existing MessageStore capabilities for inbox imports.
pub trait InboxSyncMessageStore: InboxSyncRepository {
    /// Find the provider thread using the existing scoped batch lookup.
    fn thread_ids(
        &self,
        link: Uuid,
        provider: &str,
    ) -> impl Future<Output = Result<HashMap<String, Uuid>, Self::Err>> + Send;
    /// Insert the already cleaned message with the original resync snapshot.
    fn insert_message(
        &self,
        link: Uuid,
        thread: Uuid,
        message: &mut service::message::Message,
        resync: Option<&InboxSyncResync>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Insert a cleaned provider thread and its messages atomically.
    fn insert_thread(
        &self,
        link: Uuid,
        thread: service::thread::Thread,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Resolve the committed message and thread identities.
    fn message_ids(
        &self,
        link: Uuid,
        provider: &str,
    ) -> impl Future<Output = Result<(Uuid, Uuid), Self::Err>> + Send;
}

/// Existing AttachmentStore capabilities for inbox imports.
pub trait InboxSyncAttachmentStore: InboxSyncRepository {
    /// Claim document attachments through the current database filter.
    fn document_attachments(
        &self,
        link: Uuid,
        provider: &str,
    ) -> impl Future<Output = Result<Vec<AttachmentUploadMetadata>, Self::Err>> + Send;
    /// Claim media attachments through the current database filter.
    fn media_attachments(
        &self,
        link: Uuid,
        provider: &str,
    ) -> impl Future<Output = Result<Vec<AttachmentUploadMetadata>, Self::Err>> + Send;
    /// Read recipients for all claimed attachments in one query.
    fn attachment_recipients(
        &self,
        messages: &[Uuid],
    ) -> impl Future<Output = Result<InboxSyncAttachmentRecipients, Self::Err>> + Send;
    /// Release a refused or untried attachment's claim.
    fn release_attachment(
        &self,
        attachment: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Existing NotificationFacts capabilities for inbox imports.
pub trait InboxSyncNotificationFacts: InboxSyncRepository {
    /// Read the sender facts for new-message notification selection.
    fn sender_contacts(
        &self,
        messages: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, service::address::ContactInfo>, Self::Err>> + Send;
    /// Read delegated recipients using the current owner's link scope.
    fn primaries(
        &self,
        owner: &str,
        link: Uuid,
    ) -> impl Future<Output = Result<Vec<String>, Self::Err>> + Send;
    /// Run the existing EmailRepo preview query without translating its error.
    fn previews(
        &self,
        query: PreviewCursorQuery,
        owner: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<EmailThreadPreview>, Self::Err>> + Send;
}

/// All persistence capabilities required by a complete inbox import.
pub trait InboxSyncImportRepository:
    InboxSyncHistoryFacts
    + InboxSyncCatalog
    + InboxSyncMessageStore
    + InboxSyncAttachmentStore
    + InboxSyncNotificationFacts
{
}
impl<
    T: InboxSyncHistoryFacts
        + InboxSyncCatalog
        + InboxSyncMessageStore
        + InboxSyncAttachmentStore
        + InboxSyncNotificationFacts,
> InboxSyncImportRepository for T
{
}

/// Provider reads retain their current token acquisition and quota gate.
pub trait InboxSyncImportGmail: InboxSyncGmail {
    /// Read the provider label catalog.
    fn catalog(
        &self,
        link: Uuid,
    ) -> BoxFuture<'_, Result<Vec<service::label::Label>, EmailApiError>>;
    /// Read changes after the stored cursor.
    fn changes<'a>(
        &'a self,
        link: Uuid,
        cursor: &'a SyncCursor,
    ) -> BoxFuture<'a, Result<ChangeBatch, EmailApiError>>;
    /// Read one message and its calendar MIME parts.
    fn message<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
    ) -> BoxFuture<'a, Result<Option<MessageWithCalendarParts>, EmailApiError>>;
    /// Read a thread with the existing provider normalization.
    fn thread<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
    ) -> BoxFuture<'a, Result<Vec<MessageWithCalendarParts>, EmailApiError>>;
}

/// Reuses the existing history journal and recovery-job repository.
pub trait InboxSyncHistory: Send + Sync + 'static {
    /// Existing backfill repository implementation, including original error causes.
    type Jobs: BackfillJobRepository<Err: ConnectionSourceError>;
    /// Borrow the existing persistence capabilities for recovery jobs.
    fn recovery_jobs(&self) -> Self::Jobs;
    /// Accept through GmailHistoryService's existing atomic journal policy.
    fn accept_history<'a>(
        &'a self,
        link: Uuid,
        expected: &'a str,
        batch: ChangeBatch,
    ) -> BoxFuture<'a, Result<(), crate::domain::mailbox::MailboxError>>;
}

/// Preparation and calendar extraction already shared with other import paths.
pub trait InboxSyncPreparation: Send + Sync + 'static {
    /// Clean a normalized message through the current preparation helper.
    fn prepare_message<'a>(
        &'a self,
        message: &'a mut service::message::Message,
    ) -> BoxFuture<'a, ()>;
    /// Clean the normalized thread batch through the current helper.
    fn prepare_threads<'a>(
        &'a self,
        threads: &'a mut Vec<service::thread::Thread>,
    ) -> BoxFuture<'a, ()>;
    /// Save calendar parts through the existing invitation extraction service.
    fn save_invitations<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
        message: Uuid,
        parts: &'a [CalendarPart],
    ) -> BoxFuture<'a, ()>;
}

/// An upload result preserving the distinctions the importing policy observes.
#[derive(Debug, thiserror::Error)]
pub enum InboxSyncUploadError {
    /// A refused provider fetch stops import and releases remaining claims.
    #[error("Gmail API rate limit exceeded")]
    RateLimited(EmailApiError),
    /// A superseded attachment is safe to skip.
    #[error("Attachment was deleted before it could be imported")]
    AttachmentDeleted,
    /// All other failures retain their original Display text for logging.
    #[error("{0}")]
    Other(#[source] Box<dyn std::error::Error + Send + Sync>),
}

/// Existing attachment filter and storage calls.
pub trait InboxSyncUploads: Send + Sync + 'static {
    /// Apply the exact database claim filters to parsed attachment metadata.
    fn attachment_eligibility(&self, attachments: &[Attachment]) -> (bool, bool);
    /// Upload through the current provider/document/media implementation.
    fn upload<'a>(
        &'a self,
        link: &'a service::link::Link,
        args: AttachmentUploadArgs,
    ) -> BoxFuture<'a, Result<String, InboxSyncUploadError>>;
}

/// Contact connection publication without exposing transport request types.
pub trait InboxSyncContacts: Send + Sync + 'static {
    /// Publish the already selected valid contacts for this owner.
    fn connect<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> BoxFuture<'a, anyhow::Result<()>>;
}

/// New-message content and delivery selected by the email domain.
#[derive(Clone)]
pub struct InboxSyncNotification {
    /// Display name or address of the sender.
    pub sender: Option<String>,
    /// Inbox address receiving this message.
    pub to_email: String,
    /// Committed thread identity.
    pub thread_id: Uuid,
    /// Message subject, using the original empty fallback.
    pub subject: String,
    /// Message preview, using the original empty fallback.
    pub snippet: String,
    /// Parsed sender identity, when available.
    pub sender_id: Option<MacroUserIdStr<'static>>,
    /// Owner and valid delegated recipients in this partition.
    pub recipients: std::collections::HashSet<MacroUserIdStr<'static>>,
    /// Send the realtime notification for a Signal message.
    pub realtime: bool,
    /// Enable APNS for the staff Signal partition.
    pub apns: bool,
}

/// Notification transport retains its existing best-effort logging.
pub trait InboxSyncNotifications: Send + Sync + 'static {
    /// Publish one domain-selected recipient partition.
    fn notify(&self, notification: InboxSyncNotification) -> BoxFuture<'_, ()>;
}

/// Group of host capabilities used by the import orchestration.
pub trait InboxSyncImportEffects:
    InboxSyncHistory
    + InboxSyncPreparation
    + InboxSyncUploads
    + InboxSyncContacts
    + InboxSyncNotifications
{
}
impl<
    T: InboxSyncHistory
        + InboxSyncPreparation
        + InboxSyncUploads
        + InboxSyncContacts
        + InboxSyncNotifications,
> InboxSyncImportEffects for T
{
}
