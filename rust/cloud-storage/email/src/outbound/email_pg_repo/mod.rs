use crate::domain::{
    models::{
        Attachment, AttachmentDraft, AttachmentForwarded, Contact, ContactInfo, EmailFilter,
        EmailThreadPreview, Label, Link, LinkLabel, MessageAttachment, MessageLabel, MessageRow,
        ParsedAddresses, PreviewCursorQuery, ResolvedDraftInput, SimpleMessage, SimpleMessageInfo,
        ThreadRow, UpsertEmailFilterInput, UpsertedContacts, UserProvider,
    },
    ports::{EmailRepo, RecipientsByMessageId},
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

mod contact;
mod db_types;
mod draft;
mod dynamic;
mod email_filter;
mod label;
mod link;
mod message;
mod preview;
mod preview_views;
mod thread;

#[cfg(test)]
mod test;

#[derive(Clone)]
pub struct EmailPgRepo {
    pool: PgPool,
}

impl EmailPgRepo {
    pub fn new(pool: PgPool) -> Self {
        EmailPgRepo { pool }
    }

    pub async fn link_by_fusionauth_email_provider(
        &self,
        fusionauth_user_id: &str,
        email_address: &str,
        provider: UserProvider,
    ) -> Result<Option<Link>, sqlx::Error> {
        link::link_by_fusionauth_email_provider(
            &self.pool,
            fusionauth_user_id,
            email_address,
            provider,
        )
        .await
    }
}

impl EmailRepo for EmailPgRepo {
    type Err = sqlx::Error;

    async fn previews_for_view_cursor(
        &self,
        query: PreviewCursorQuery,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<EmailThreadPreview>, Self::Err> {
        preview::previews_for_view_cursor(&self.pool, query, user_id).await
    }

    async fn attachments_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> Result<Vec<Attachment>, Self::Err> {
        preview::attachments_by_thread_ids(&self.pool, thread_ids).await
    }

    async fn contacts_by_thread_ids(&self, thread_ids: &[Uuid]) -> Result<Vec<Contact>, Self::Err> {
        preview::contacts_by_thread_ids(&self.pool, thread_ids).await
    }

    async fn labels_by_thread_ids(&self, thread_ids: &[Uuid]) -> Result<Vec<Label>, Self::Err> {
        preview::labels_by_thread_ids(&self.pool, thread_ids).await
    }

    async fn link_by_fusionauth_and_macro_id(
        &self,
        fusionauth_user_id: &str,
        macro_id: MacroUserIdStr<'_>,
        provider: UserProvider,
    ) -> Result<Option<Link>, Self::Err> {
        link::link_by_fusionauth_and_macro_id(&self.pool, fusionauth_user_id, macro_id, provider)
            .await
    }

    async fn link_by_macro_id(
        &self,
        macro_id: MacroUserIdStr<'_>,
    ) -> Result<Option<Link>, Self::Err> {
        link::link_by_macro_id(&self.pool, macro_id).await
    }

    async fn owned_link_for_thread(
        &self,
        thread_id: Uuid,
        macro_id: MacroUserIdStr<'_>,
    ) -> Result<Option<Link>, Self::Err> {
        link::owned_link_for_thread(&self.pool, thread_id, macro_id).await
    }

    async fn inboxes_for_macro_id(
        &self,
        macro_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<Link>, Self::Err> {
        link::inboxes_for_macro_id(&self.pool, macro_id).await
    }

    async fn thread_by_id(&self, thread_id: Uuid) -> Result<Option<ThreadRow>, Self::Err> {
        thread::thread_by_id(&self.pool, thread_id).await
    }

    async fn messages_by_thread_id_paginated(
        &self,
        thread_id: Uuid,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<MessageRow>, Self::Err> {
        thread::messages_by_thread_id_paginated(&self.pool, thread_id, offset, limit).await
    }

    async fn cross_inbox_reply_drafts(
        &self,
        replying_to_ids: &[Uuid],
        link_ids: &[Uuid],
        exclude_thread_id: Uuid,
    ) -> Result<Vec<MessageRow>, Self::Err> {
        thread::cross_inbox_reply_drafts(&self.pool, replying_to_ids, link_ids, exclude_thread_id)
            .await
    }

    async fn senders_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, ContactInfo>, Self::Err> {
        message::senders_by_message_ids(&self.pool, message_ids).await
    }

    async fn recipients_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> Result<RecipientsByMessageId, Self::Err> {
        message::recipients_by_message_ids(&self.pool, message_ids).await
    }

    async fn labels_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<MessageLabel>>, Self::Err> {
        message::labels_by_message_ids(&self.pool, message_ids).await
    }

    async fn attachments_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<MessageAttachment>>, Self::Err> {
        message::attachments_by_message_ids(&self.pool, message_ids).await
    }

    async fn draft_attachments_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<AttachmentDraft>>, Self::Err> {
        message::draft_attachments_by_message_ids(&self.pool, message_ids).await
    }

    async fn forwarded_attachments_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<AttachmentForwarded>>, Self::Err> {
        message::forwarded_attachments_by_message_ids(&self.pool, message_ids).await
    }

    async fn scheduled_send_times_by_message_ids(
        &self,
        message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, DateTime<Utc>>, Self::Err> {
        message::scheduled_send_times_by_message_ids(&self.pool, message_ids).await
    }

    async fn get_simple_message(
        &self,
        message_id: Uuid,
        link_ids: &[Uuid],
    ) -> Result<Option<SimpleMessageInfo>, Self::Err> {
        message::get_simple_message(&self.pool, message_id, link_ids).await
    }

    async fn get_draft_replying_to(
        &self,
        link_id: Uuid,
        replying_to_id: Uuid,
    ) -> Result<Option<SimpleMessageInfo>, Self::Err> {
        message::get_draft_replying_to(&self.pool, link_id, replying_to_id).await
    }

    async fn delete_draft_message(
        &self,
        message_id: Uuid,
        thread_db_id: Uuid,
    ) -> Result<(), Self::Err> {
        message::delete_draft_message(&self.pool, message_id, thread_db_id).await
    }

    async fn upsert_contacts(
        &self,
        link_id: Uuid,
        addresses: ParsedAddresses,
    ) -> Result<UpsertedContacts, Self::Err> {
        contact::upsert_contacts(&self.pool, link_id, addresses).await
    }

    async fn insert_message(
        &self,
        input: &ResolvedDraftInput,
        contacts: &UpsertedContacts,
        link_id: Uuid,
        new_thread: Option<ThreadRow>,
        is_draft: bool,
    ) -> Result<(), Self::Err> {
        draft::insert_message(&self.pool, input, contacts, link_id, new_thread, is_draft).await
    }

    async fn get_label_by_id(
        &self,
        label_id: Uuid,
        link_id: Uuid,
    ) -> Result<Option<LinkLabel>, Self::Err> {
        label::get_label_by_id(&self.pool, label_id, link_id).await
    }

    async fn get_thread_label_messages(
        &self,
        thread_id: Uuid,
        link_id: Uuid,
    ) -> Result<Vec<SimpleMessage>, Self::Err> {
        label::get_thread_label_messages(&self.pool, thread_id, link_id).await
    }

    async fn insert_message_labels_batch(
        &self,
        message_ids: &[Uuid],
        provider_label_id: &str,
        link_id: Uuid,
    ) -> Result<(), Self::Err> {
        label::insert_message_labels_batch(&self.pool, message_ids, provider_label_id, link_id)
            .await
    }

    async fn delete_message_labels_batch(
        &self,
        message_ids: &[Uuid],
        provider_label_id: &str,
        link_id: Uuid,
    ) -> Result<(), Self::Err> {
        label::delete_message_labels_batch(&self.pool, message_ids, provider_label_id, link_id)
            .await
    }

    async fn update_message_read_status_batch(
        &self,
        message_ids: &[Uuid],
        link_id: Uuid,
        is_read: bool,
    ) -> Result<(), Self::Err> {
        label::update_message_read_status_batch(&self.pool, message_ids, link_id, is_read).await
    }

    async fn update_message_starred_status_batch(
        &self,
        message_ids: &[Uuid],
        link_id: Uuid,
        is_starred: bool,
    ) -> Result<(), Self::Err> {
        label::update_message_starred_status_batch(&self.pool, message_ids, link_id, is_starred)
            .await
    }

    async fn list_labels_by_link_id(&self, link_id: Uuid) -> Result<Vec<LinkLabel>, Self::Err> {
        label::list_labels_by_link_id(&self.pool, link_id).await
    }

    async fn delete_scheduled_messages_batch(
        &self,
        message_ids: &[Uuid],
        link_id: Uuid,
    ) -> Result<(), Self::Err> {
        label::delete_scheduled_messages_batch(&self.pool, message_ids, link_id).await
    }

    async fn update_thread_project(
        &self,
        thread_id: Uuid,
        project_id: Option<&str>,
    ) -> Result<bool, Self::Err> {
        thread::update_thread_project(&self.pool, thread_id, project_id).await
    }

    async fn get_thread_project_id(&self, thread_id: Uuid) -> Result<Option<String>, Self::Err> {
        thread::get_thread_project_id(&self.pool, thread_id).await
    }

    async fn upsert_email_filter(
        &self,
        link_id: Uuid,
        input: UpsertEmailFilterInput,
    ) -> Result<EmailFilter, Self::Err> {
        if let Some(address) = &input.email_address {
            email_filter::upsert_email_filter_by_address(
                &self.pool,
                link_id,
                address,
                input.is_important,
            )
            .await
        } else if let Some(domain) = &input.email_domain {
            email_filter::upsert_email_filter_by_domain(
                &self.pool,
                link_id,
                domain,
                input.is_important,
            )
            .await
        } else {
            unreachable!(
                "UpsertEmailFilterInput must have either email_address or email_domain; validated by service layer"
            )
        }
    }

    async fn delete_email_filter(&self, filter_id: Uuid, link_id: Uuid) -> Result<bool, Self::Err> {
        email_filter::delete_email_filter(&self.pool, filter_id, link_id).await
    }

    async fn list_email_filters(&self, link_id: Uuid) -> Result<Vec<EmailFilter>, Self::Err> {
        email_filter::list_email_filters(&self.pool, link_id).await
    }
}
