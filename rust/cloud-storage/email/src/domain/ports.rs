use crate::domain::models::{
    Attachment, AttachmentDraft, AttachmentForwarded, Contact, ContactInfo, CreateDraftInput,
    CreatedDraft, EmailErr, EmailFilter, EmailThreadPreview, EnrichedEmailThreadPreview,
    GetEmailsRequest, Label, Link, LinkLabel, MessageAttachment, MessageLabel, MessageRow,
    ParsedAddresses, ParsedThread, PreviewCursorQuery, RecipientType, ResolvedDraftInput,
    SimpleMessage, SimpleMessageInfo, Thread, ThreadRow, UpdateThreadLabelsResult,
    UpsertEmailFilterInput, UpsertedContacts, UserProvider,
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

    /// Fetch a thread by its database ID (without messages).
    fn thread_by_id(
        &self,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Option<ThreadRow>, Self::Err>> + Send;

    /// Fetch paginated messages for a thread, ordered by internal_date_ts descending.
    fn messages_by_thread_id_paginated(
        &self,
        thread_id: Uuid,
        offset: i64,
        limit: i64,
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

    /// Fetch a simplified message by its DB ID and link ID (for validation).
    fn get_simple_message(
        &self,
        message_id: Uuid,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Option<SimpleMessageInfo>, Self::Err>> + Send;

    /// Find an existing draft that replies to the given message ID.
    fn get_draft_replying_to(
        &self,
        link_id: Uuid,
        replying_to_id: Uuid,
    ) -> impl Future<Output = Result<Option<SimpleMessageInfo>, Self::Err>> + Send;

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
    fn delete_scheduled_messages_batch(
        &self,
        message_ids: &[Uuid],
        link_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

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

    /// Create a draft message for the given link.
    fn create_draft(
        &self,
        link: &Link,
        input: CreateDraftInput,
    ) -> impl Future<Output = Result<CreatedDraft, EmailErr>> + Send;

    /// Send a message: persist it and enqueue for scheduled delivery.
    fn send_message(
        &self,
        link: &Link,
        input: CreateDraftInput,
    ) -> impl Future<Output = Result<CreatedDraft, EmailErr>> + Send;

    /// List all labels for the given link.
    fn list_labels(
        &self,
        link: &Link,
    ) -> impl Future<Output = Result<Vec<LinkLabel>, EmailErr>> + Send;

    /// Add or remove a label from all messages in a thread.
    fn update_thread_labels(
        &self,
        access_token: &str,
        link: &Link,
        thread_id: Uuid,
        label_id: Uuid,
        add: bool,
    ) -> impl Future<Output = Result<UpdateThreadLabelsResult, EmailErr>> + Send;

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

/// Port for modifying Gmail message labels via the provider API.
pub trait GmailLabelModifier: Send + Sync + 'static {
    /// Add and remove labels on a single message identified by its provider message ID.
    fn modify_message_labels(
        &self,
        access_token: &str,
        provider_message_id: &str,
        label_ids_to_add: &[String],
        label_ids_to_remove: &[String],
    ) -> impl Future<Output = Result<(), EmailErr>> + Send;
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

/// No-op label modifier for callers that don't need Gmail label operations.
#[derive(Clone)]
pub struct NoOpGmailLabelModifier;

impl GmailLabelModifier for NoOpGmailLabelModifier {
    async fn modify_message_labels(
        &self,
        _access_token: &str,
        _provider_message_id: &str,
        _label_ids_to_add: &[String],
        _label_ids_to_remove: &[String],
    ) -> Result<(), EmailErr> {
        Ok(())
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
}
