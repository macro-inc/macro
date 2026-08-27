use crate::domain::models::{
    Attachment, AttachmentDraft, AttachmentForwarded, Contact, ContactInfo, CreateDraftInput,
    CreatedDraft, EmailErr, EmailFilter, EmailInboxDetails, EmailThreadMetadata,
    EmailThreadPreview, EnrichedEmailThreadPreview, GetEmailsRequest, Label, Link, LinkLabel,
    Message, MessageAttachment, MessageLabel, MessageRow, ParsedAddresses, ParsedMessage,
    ParsedThread, PreviewCursorQuery, RecipientType, ResolvedDraftInput, SenderPolicy,
    SimpleMessage, SimpleMessageInfo, Thread, ThreadRow, UpdateThreadLabelsResult,
    UpsertEmailFilterInput, UpsertedContacts, UserEmailLink, UserProvider,
};
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use std::collections::HashMap;
use uuid::Uuid;

/// Keyed map of message recipients grouped by message ID.
pub type RecipientsByMessageId = HashMap<Uuid, Vec<(ContactInfo, RecipientType)>>;

/// Port for enqueuing email messages to be sent on a schedule.
pub trait EmailMessageEnqueuer: Send + Sync + 'static {
    /// Error type for enqueue operations.
    type Err: Send;

    /// Enqueue a message to be sent after an optional delay.
    fn enqueue_scheduled_message(
        &self,
        link_id: Uuid,
        message_id: Uuid,
        delay_seconds: Option<i32>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Enqueue a batch of Gmail label modification operations to the gmail_ops worker queue.
    fn enqueue_gmail_ops_modify_labels_batch(
        &self,
        link_id: Uuid,
        messages: Vec<(Uuid, String)>,
        labels_to_add: Vec<String>,
        labels_to_remove: Vec<String>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Enqueue a Gmail-ops BlockSender operation for the link.
    fn enqueue_gmail_ops_block_sender(
        &self,
        link_id: Uuid,
        email_address: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Enqueue a Gmail-ops UnblockSender operation for the link.
    fn enqueue_gmail_ops_unblock_sender(
        &self,
        link_id: Uuid,
        email_address: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// The sending inbox's signature preferences, used by the send pipeline to
/// decide whether to inject the signature into the outgoing body.
#[derive(Debug, Clone, Default)]
pub struct LinkEmailSettings {
    /// The saved signature HTML (already sanitized server-side), if any.
    pub signature: Option<String>,
    /// Whether the signature should be added on replies and forwards.
    pub signature_on_replies_forwards: bool,
}

/// Outbound repository capabilities for authenticated user email catalogs.
///
/// The port returns persisted facts only. Accessible-inbox aggregation and
/// synchronization-status policy remain in the email domain service.
pub trait EmailUserRepo: Send + Sync + 'static {
    /// Resolve every owned or delegated inbox accessible to `macro_id`.
    fn user_accessible_inboxes(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Link>, EmailErr>> + Send;

    /// Fetch all labels belonging to one already-authorized inbox.
    fn user_labels_for_link(
        &self,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Vec<LinkLabel>, EmailErr>> + Send;

    /// Fetch enriched persisted facts for every owned or delegated inbox.
    fn user_inbox_details(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<EmailInboxDetails>, EmailErr>> + Send;
}

pub trait EmailRepo: Send + Sync + 'static {
    type Err: Send;
    fn previews_for_view_cursor(
        &self,
        query: PreviewCursorQuery,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<EmailThreadPreview>, Self::Err>> + Send;

    fn attachments_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Attachment>, Self::Err>> + Send;

    fn contacts_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Contact>, Self::Err>> + Send;

    fn labels_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Label>, Self::Err>> + Send;

    fn link_by_fusionauth_and_macro_id(
        &self,
        fusionauth_user_id: &str,
        macro_id: MacroUserIdStr<'_>,
        provider: UserProvider,
    ) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;

    fn link_by_macro_id(
        &self,
        macro_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;

    /// Resolve the inbox owning a thread, only when that inbox belongs to the
    /// given fusionauth user.
    fn owned_link_for_thread(
        &self,
        thread_id: Uuid,
        macro_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;

    /// Returns every inbox accessible to `macro_id`: their own email_links plus
    /// any reachable via a `macro_user_links` edge (narrow-graph multi-inbox).
    fn inboxes_for_macro_id(
        &self,
        macro_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Link>, Self::Err>> + Send;

    /// Fetch a thread by its database ID (without messages).
    fn thread_by_id(
        &self,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Option<ThreadRow>, Self::Err>> + Send;

    /// Fetch canonical metadata for a batch of thread IDs.
    fn thread_metadata_by_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<EmailThreadMetadata>, Self::Err>> + Send;

    /// Fetch paginated messages for a thread, ordered by internal_date_ts descending.
    fn messages_by_thread_id_paginated(
        &self,
        thread_id: Uuid,
        offset: i64,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<MessageRow>, Self::Err>> + Send;

    /// Fetch the newest non-draft content message for each requested thread.
    fn latest_content_message_rows(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<MessageRow>, Self::Err>> + Send;

    /// Find macro reply drafts (across the given inboxes) that reply to any of
    /// `replying_to_ids` but live in a thread other than `exclude_thread_id` —
    /// i.e. a reply moved to another inbox by switching the sender.
    fn cross_inbox_reply_drafts(
        &self,
        replying_to_ids: &[Uuid],
        link_ids: &[Uuid],
        exclude_thread_id: Uuid,
    ) -> impl Future<Output = Result<Vec<MessageRow>, Self::Err>> + Send;

    /// Fetch sender contact info for a set of message IDs, keyed by message ID.
    fn senders_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, ContactInfo>, Self::Err>> + Send;

    /// Fetch recipient contact info for a set of message IDs, keyed by message ID.
    fn recipients_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<RecipientsByMessageId, Self::Err>> + Send;

    /// Fetch labels for a set of message IDs, keyed by message ID.
    fn labels_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, Vec<MessageLabel>>, Self::Err>> + Send;

    /// Fetch provider attachments for a set of message IDs, keyed by message ID.
    fn attachments_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, Vec<MessageAttachment>>, Self::Err>> + Send;

    /// Fetch draft attachments for a set of message IDs, keyed by message ID.
    fn draft_attachments_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, Vec<AttachmentDraft>>, Self::Err>> + Send;

    /// Fetch forwarded attachments for a set of message IDs, keyed by message ID.
    fn forwarded_attachments_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, Vec<AttachmentForwarded>>, Self::Err>> + Send;

    /// Fetch scheduled send times for a set of message IDs, keyed by message ID.
    /// Only returns entries for unsent scheduled messages.
    fn scheduled_send_times_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, DateTime<Utc>>, Self::Err>> + Send;

    /// Fetch a simplified message by its DB ID, scoped to a set of accessible
    /// inbox link IDs (for validation across own + delegated inboxes).
    fn get_simple_message(
        &self,
        message_id: Uuid,
        link_ids: &[Uuid],
    ) -> impl Future<Output = Result<Option<SimpleMessageInfo>, Self::Err>> + Send;

    /// Find an existing draft that replies to the given message ID.
    fn get_draft_replying_to(
        &self,
        link_id: Uuid,
        replying_to_id: Uuid,
    ) -> impl Future<Output = Result<Option<SimpleMessageInfo>, Self::Err>> + Send;

    /// Delete a draft message and its thread if the thread is left empty.
    /// A surviving thread gets its denormalized metadata (inbox visibility,
    /// latest timestamps, is_signal) recomputed, since drafts count toward
    /// those fields.
    fn delete_draft_message(
        &self,
        message_id: Uuid,
        thread_db_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Upsert contacts from the parsed addresses. Must be called outside a transaction
    /// to avoid deadlocks (contacts are shared across messages).
    fn upsert_contacts(
        &self,
        link_id: Uuid,
        addresses: ParsedAddresses,
    ) -> impl Future<Output = Result<UpsertedContacts, Self::Err>> + Send;

    /// Insert a message within a transaction, including thread insert (if new),
    /// recipients, scheduled message handling, thread metadata update, and user history.
    /// If `new_thread` is Some, the thread is created inside the same transaction.
    fn insert_message(
        &self,
        input: &ResolvedDraftInput,
        contacts: &UpsertedContacts,
        link_id: Uuid,
        new_thread: Option<ThreadRow>,
        is_draft: bool,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Fetch a label by its database ID and link ID.
    fn get_label_by_id(
        &self,
        label_id: Uuid,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Option<LinkLabel>, Self::Err>> + Send;

    /// Fetch all messages in a thread for label operations.
    fn get_thread_label_messages(
        &self,
        thread_id: Uuid,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Vec<SimpleMessage>, Self::Err>> + Send;

    /// Bulk insert a label for multiple messages.
    fn insert_message_labels_batch(
        &self,
        message_ids: &[Uuid],
        provider_label_id: &str,
        link_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Bulk delete a label from multiple messages.
    fn delete_message_labels_batch(
        &self,
        message_ids: &[Uuid],
        provider_label_id: &str,
        link_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Update the read status for a batch of messages, verified by link_id.
    fn update_message_read_status_batch(
        &self,
        message_ids: &[Uuid],
        link_id: Uuid,
        is_read: bool,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Update the denormalized thread-level read status, verified by link_id.
    fn update_thread_read_status(
        &self,
        thread_id: Uuid,
        link_id: Uuid,
        is_read: bool,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record that the user viewed a thread.
    fn upsert_thread_user_history(
        &self,
        link_id: Uuid,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Update the starred status for a batch of messages, verified by link_id.
    fn update_message_starred_status_batch(
        &self,
        message_ids: &[Uuid],
        link_id: Uuid,
        is_starred: bool,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Fetch all labels for a link.
    fn list_labels_by_link_id(
        &self,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Vec<LinkLabel>, Self::Err>> + Send;

    /// Delete unsent scheduled messages for a batch of draft message IDs.
    /// Returns the message ids that actually had a pending scheduled send.
    fn delete_scheduled_messages_batch(
        &self,
        message_ids: &[Uuid],
        link_id: Uuid,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;

    /// Update the project assignment for a thread. Pass `None` to remove from project.
    /// Returns `false` if the thread was not found.
    fn update_thread_project(
        &self,
        thread_id: Uuid,
        project_id: Option<&str>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Get the current project_id for a thread.
    fn get_thread_project_id(
        &self,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Advance a project's activity timestamp.
    fn touch_project_updated_at(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Upsert an email filter (by address or domain) for a link.
    fn upsert_email_filter(
        &self,
        link_id: Uuid,
        input: UpsertEmailFilterInput,
    ) -> impl Future<Output = Result<EmailFilter, Self::Err>> + Send;

    /// Delete an email filter by its ID, scoped to a link.
    fn delete_email_filter(
        &self,
        filter_id: Uuid,
        link_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// List all email filters for a link.
    fn list_email_filters(
        &self,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Vec<EmailFilter>, Self::Err>> + Send;

    /// Fetch the inbox's signature preferences. Defaults to "no signature" so
    /// repos that don't override it (and the send path when settings are
    /// missing) simply skip signature injection.
    fn fetch_email_settings(
        &self,
        _link_id: Uuid,
    ) -> impl Future<Output = Result<LinkEmailSettings, EmailErr>> + Send {
        async { Ok(LinkEmailSettings::default()) }
    }
}

/// Read-only trait for fetching email thread previews.
/// Used by soup to restrict access to only read email operations as it uses the read replica database.
pub trait EmailPreviewServiceReadOnly: Send + Sync + 'static {
    fn get_email_thread_previews(
        &self,
        req: GetEmailsRequest,
    ) -> impl Future<
        Output = Result<
            PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>,
            EmailErr,
        >,
    > + Send;
}

/// Read-only domain service used to hydrate canonical email-thread metadata edges.
pub trait EmailThreadMetadataService: Send + Sync + 'static {
    /// Fetch canonical metadata for authorized email threads in one batch.
    fn get_email_thread_metadata(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> impl Future<Output = Result<HashMap<Uuid, EmailThreadMetadata>, EmailErr>> + Send;
}

/// Read-only domain service used to hydrate lightweight email content edges.
pub trait EmailContentService: Send + Sync + 'static {
    /// Fetch the newest non-draft parsed content message for each authorized thread.
    fn get_latest_messages_parsed(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> impl Future<Output = Result<HashMap<Uuid, ParsedMessage>, EmailErr>> + Send;

    /// Fetch the newest non-draft fully hydrated message for each authorized thread.
    fn get_latest_messages_full(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> impl Future<Output = Result<HashMap<Uuid, Message>, EmailErr>> + Send;

    /// Fetch one page of parsed messages for an authorized thread.
    fn get_messages_parsed(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> impl Future<Output = Result<Option<Vec<ParsedMessage>>, EmailErr>> + Send;

    /// Fetch one page of fully hydrated messages for an authorized thread.
    fn get_messages_full(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> impl Future<Output = Result<Option<Vec<Message>>, EmailErr>> + Send;
}

/// Newtype adapter that restricts a full `EmailService` to read-only preview access.
/// Wrapping is explicit so readonly wiring is intentional — a bare `EmailServiceImpl`
/// will *not* silently satisfy `EmailPreviewServiceReadOnly`.
pub struct ReadonlyEmailPreviewAdapter<T>(pub T);

impl<T: EmailService> EmailPreviewServiceReadOnly for ReadonlyEmailPreviewAdapter<T> {
    fn get_email_thread_previews(
        &self,
        req: GetEmailsRequest,
    ) -> impl Future<
        Output = Result<
            PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>,
            EmailErr,
        >,
    > + Send {
        EmailService::get_email_thread_previews(&self.0, req)
    }
}

/// User-scoped read operations consumed by email inbound adapters.
pub trait EmailUserService: Send + Sync + 'static {
    /// List labels across every owned or delegated inbox accessible to the user.
    fn get_user_email_labels(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<LinkLabel>, EmailErr>> + Send;

    /// List enriched owned or delegated email links accessible to the user.
    fn get_user_email_links(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<UserEmailLink>, EmailErr>> + Send;
}

pub trait EmailService: Send + Sync + 'static {
    fn get_email_thread_previews(
        &self,
        req: GetEmailsRequest,
    ) -> impl Future<
        Output = Result<
            PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>,
            EmailErr,
        >,
    > + Send;

    fn get_link_by_auth_id_and_macro_id(
        &self,
        auth_id: &str,
        macro_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Link>, EmailErr>> + Send;

    /// Fetch the email link for a user by their macro ID only.
    fn get_link_by_macro_id(
        &self,
        macro_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Link>, EmailErr>> + Send;

    /// Fetch every inbox the caller can read — their own email_links rows plus
    /// any rows reachable via a `macro_user_links` edge (narrow-graph multi-inbox).
    fn get_inboxes_for_macro_id(
        &self,
        macro_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Link>, EmailErr>> + Send;

    /// Resolve the inbox owning a thread, scoped to the caller's own and
    /// delegated inboxes. Lets thread-targeted mutations derive the inbox from
    /// the thread instead of an `X-Email-Link-Id` header.
    fn get_owned_link_for_thread(
        &self,
        macro_id: MacroUserIdStr<'_>,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Option<Link>, EmailErr>> + Send;

    /// Fetch a thread with paginated messages, verifying access via the provided receipt.
    fn get_thread_with_messages(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> impl Future<Output = Result<Option<Thread>, EmailErr>> + Send;

    /// Fetch a thread with lightweight parsed messages (no attachments or scheduled send times).
    fn get_thread_parsed(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> impl Future<Output = Result<Option<ParsedThread>, EmailErr>> + Send;

    /// Create a draft message sent from `link`. `accessible_inboxes` is every
    /// inbox the caller can reach (own + delegated); a reply target may live in
    /// any of them, not just `link`.
    fn create_draft(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        input: CreateDraftInput,
    ) -> impl Future<Output = Result<CreatedDraft, EmailErr>> + Send;

    /// Send a message: persist it and enqueue for scheduled delivery.
    /// `accessible_inboxes` is every inbox the caller can reach (own +
    /// delegated); a reply target may live in any of them, not just `link`.
    fn send_message(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        input: CreateDraftInput,
    ) -> impl Future<Output = Result<CreatedDraft, EmailErr>> + Send;

    /// List all labels for the given link.
    fn list_labels(
        &self,
        link: &Link,
    ) -> impl Future<Output = Result<Vec<LinkLabel>, EmailErr>> + Send;

    /// Add or remove a label from all messages in a thread. Provider sync
    /// happens asynchronously via the gmail_ops queue.
    fn update_thread_labels(
        &self,
        link: &Link,
        thread_id: Uuid,
        label_id: Uuid,
        add: bool,
    ) -> impl Future<Output = Result<UpdateThreadLabelsResult, EmailErr>> + Send;

    /// Mark a caller-accessible thread as seen and read.
    fn mark_thread_seen(
        &self,
        _macro_id: MacroUserIdStr<'static>,
        _thread_id: Uuid,
    ) -> impl Future<Output = Result<(), EmailErr>> + Send {
        async { Err(no_op_email_err()) }
    }

    /// Add or remove a label from a caller-accessible thread.
    fn update_thread_labels_for_user(
        &self,
        _macro_id: MacroUserIdStr<'static>,
        _thread_id: Uuid,
        _label_id: Uuid,
        _add: bool,
    ) -> impl Future<Output = Result<UpdateThreadLabelsResult, EmailErr>> + Send {
        async { Err(no_op_email_err()) }
    }

    /// Update the project assignment for a thread. Returns the old project_id.
    ///
    /// `thread_receipt` proves the caller has edit access to the thread.
    /// `project_receipt` proves the caller has edit access to the target project.
    /// Pass `None` to remove the thread from its current project.
    fn update_thread_project(
        &self,
        thread_receipt: EntityAccessReceipt<EditAccessLevel>,
        project_receipt: Option<EntityAccessReceipt<EditAccessLevel>>,
    ) -> impl Future<Output = Result<Option<String>, EmailErr>> + Send;

    /// Upsert an email filter for the given link.
    fn upsert_email_filter(
        &self,
        link: &Link,
        input: UpsertEmailFilterInput,
    ) -> impl Future<Output = Result<EmailFilter, EmailErr>> + Send;

    /// Set where future mail from a sender lands for the given inbox.
    ///
    /// Signal and Noise also enqueue an UnblockSender so a prior Block does
    /// not keep trashing new mail.
    fn set_sender_policy(
        &self,
        link: &Link,
        sender_email: &str,
        policy: SenderPolicy,
    ) -> impl Future<Output = Result<(), EmailErr>> + Send;

    /// Delete an email filter by its ID for the given link.
    fn delete_email_filter(
        &self,
        link: &Link,
        filter_id: Uuid,
    ) -> impl Future<Output = Result<bool, EmailErr>> + Send;

    /// List all email filters for the given link.
    fn list_email_filters(
        &self,
        link: &Link,
    ) -> impl Future<Output = Result<Vec<EmailFilter>, EmailErr>> + Send;
}

/// Port for fetching a Gmail access token for a given email link.
///
/// The domain service receives the token as an opaque `&str`. This trait
/// allows the toolset layer to resolve tokens without depending on axum.
pub trait GmailTokenProvider: Send + Sync + 'static {
    /// Fetch a Gmail OAuth access token for the given email link.
    fn fetch_gmail_access_token(
        &self,
        link: &Link,
    ) -> impl Future<Output = Result<String, EmailErr>> + Send;

    /// Fetch a Gmail OAuth access token directly from the auth service,
    /// bypassing the Redis cache for reads but still caching the result.
    fn fetch_gmail_access_token_no_cache(
        &self,
        link: &Link,
    ) -> impl Future<Output = Result<String, EmailErr>> + Send;
}

/// No-op token provider for callers that don't need Gmail token resolution.
#[derive(Clone)]
pub struct NoOpGmailTokenProvider;

impl GmailTokenProvider for NoOpGmailTokenProvider {
    async fn fetch_gmail_access_token(&self, _link: &Link) -> Result<String, EmailErr> {
        Err(EmailErr::ProviderErr(anyhow::anyhow!(
            "Gmail token provider not configured"
        )))
    }

    async fn fetch_gmail_access_token_no_cache(&self, _link: &Link) -> Result<String, EmailErr> {
        Err(EmailErr::ProviderErr(anyhow::anyhow!(
            "Gmail token provider not configured"
        )))
    }
}

/// No-op enqueuer for callers that don't need send capability.
#[derive(Clone)]
pub struct NoOpEnqueuer;

impl EmailMessageEnqueuer for NoOpEnqueuer {
    type Err = std::convert::Infallible;

    async fn enqueue_scheduled_message(
        &self,
        _link_id: Uuid,
        _message_id: Uuid,
        _delay_seconds: Option<i32>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn enqueue_gmail_ops_modify_labels_batch(
        &self,
        _link_id: Uuid,
        _messages: Vec<(Uuid, String)>,
        _labels_to_add: Vec<String>,
        _labels_to_remove: Vec<String>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn enqueue_gmail_ops_block_sender(
        &self,
        _link_id: Uuid,
        _email_address: String,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn enqueue_gmail_ops_unblock_sender(
        &self,
        _link_id: Uuid,
        _email_address: String,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}

/// No-op [`EmailService`] for binaries that need to satisfy the bound but
/// never call email — e.g. schema-only GraphQL SDL export. Every method
/// errors; swap for a real implementation if you actually need email.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpEmailService;

fn no_op_email_err() -> EmailErr {
    EmailErr::RepoErr(anyhow::anyhow!("no-op email service"))
}

impl EmailUserService for NoOpEmailService {
    async fn get_user_email_labels(
        &self,
        _macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<LinkLabel>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn get_user_email_links(
        &self,
        _macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<UserEmailLink>, EmailErr> {
        Err(no_op_email_err())
    }
}

impl EmailService for NoOpEmailService {
    async fn get_email_thread_previews(
        &self,
        _req: GetEmailsRequest,
    ) -> Result<PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>, EmailErr>
    {
        Err(no_op_email_err())
    }

    async fn get_link_by_auth_id_and_macro_id(
        &self,
        _auth_id: &str,
        _macro_id: MacroUserIdStr<'_>,
    ) -> Result<Option<Link>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn get_link_by_macro_id(
        &self,
        _macro_id: MacroUserIdStr<'_>,
    ) -> Result<Option<Link>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn get_inboxes_for_macro_id(
        &self,
        _macro_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<Link>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn get_owned_link_for_thread(
        &self,
        _macro_id: MacroUserIdStr<'_>,
        _thread_id: Uuid,
    ) -> Result<Option<Link>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn get_thread_with_messages(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<Thread>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn get_thread_parsed(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<ParsedThread>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn create_draft(
        &self,
        _link: &Link,
        _accessible_inboxes: &[Link],
        _input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        Err(no_op_email_err())
    }

    async fn send_message(
        &self,
        _link: &Link,
        _accessible_inboxes: &[Link],
        _input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        Err(no_op_email_err())
    }

    async fn list_labels(&self, _link: &Link) -> Result<Vec<LinkLabel>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn update_thread_labels(
        &self,
        _link: &Link,
        _thread_id: Uuid,
        _label_id: Uuid,
        _add: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        Err(no_op_email_err())
    }

    async fn update_thread_project(
        &self,
        _thread_receipt: EntityAccessReceipt<EditAccessLevel>,
        _project_receipt: Option<EntityAccessReceipt<EditAccessLevel>>,
    ) -> Result<Option<String>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn upsert_email_filter(
        &self,
        _link: &Link,
        _input: UpsertEmailFilterInput,
    ) -> Result<EmailFilter, EmailErr> {
        Err(no_op_email_err())
    }

    async fn set_sender_policy(
        &self,
        _link: &Link,
        _sender_email: &str,
        _policy: SenderPolicy,
    ) -> Result<(), EmailErr> {
        Err(no_op_email_err())
    }

    async fn delete_email_filter(&self, _link: &Link, _filter_id: Uuid) -> Result<bool, EmailErr> {
        Err(no_op_email_err())
    }

    async fn list_email_filters(&self, _link: &Link) -> Result<Vec<EmailFilter>, EmailErr> {
        Err(no_op_email_err())
    }
}

impl EmailThreadMetadataService for NoOpEmailService {
    async fn get_email_thread_metadata(
        &self,
        _receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<HashMap<Uuid, EmailThreadMetadata>, EmailErr> {
        Err(no_op_email_err())
    }
}

impl EmailContentService for NoOpEmailService {
    async fn get_latest_messages_parsed(
        &self,
        _receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<HashMap<Uuid, ParsedMessage>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn get_latest_messages_full(
        &self,
        _receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<HashMap<Uuid, Message>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn get_messages_parsed(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<Vec<ParsedMessage>>, EmailErr> {
        Err(no_op_email_err())
    }

    async fn get_messages_full(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<Vec<Message>>, EmailErr> {
        Err(no_op_email_err())
    }
}

/// Outcome of a first-inbox provisioning attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FirstInboxProvisionOutcome {
    /// The inbox was provisioned and a backfill was started.
    Provisioned,
    /// The service declined the request as a no-op: the inbox is already
    /// initialized or the user holds no Gmail grant. Expected, not an error.
    Skipped,
}

/// Port for provisioning the calling user's primary inbox.
pub trait FirstInboxProvisioner: Send + Sync + 'static {
    /// Provisions the caller's primary inbox. Idempotent, so safe to invoke on
    /// every authentication.
    fn provision_first_inbox(
        &self,
        access_token: &str,
    ) -> impl Future<Output = anyhow::Result<FirstInboxProvisionOutcome>> + Send;
}
