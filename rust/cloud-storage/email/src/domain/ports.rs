use crate::domain::models::{
    Attachment, AttachmentDraft, AttachmentForwarded, Contact, ContactInfo, EmailErr,
    EmailThreadPreview, EnrichedEmailThreadPreview, GetEmailsRequest, Label, Link,
    MessageAttachment, MessageLabel, MessageRow, PreviewCursorQuery, RecipientType, Thread,
    ThreadRow, UserProvider,
};
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use std::collections::HashMap;
use uuid::Uuid;

/// Keyed map of message recipients grouped by message ID.
pub type RecipientsByMessageId = HashMap<Uuid, Vec<(ContactInfo, RecipientType)>>;

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

    /// Fetch a thread with paginated messages, verifying access via the provided receipt.
    fn get_thread_with_messages(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> impl Future<Output = Result<Option<Thread>, EmailErr>> + Send;
}
