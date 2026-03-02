use crate::domain::{
    models::{
        Attachment, AttachmentDraft, AttachmentForwarded, Contact, ContactInfo, EmailThreadPreview,
        Label, Link, MessageAttachment, MessageLabel, MessageRow, PreviewCursorQuery, ThreadRow,
        UserProvider,
    },
    ports::{EmailRepo, RecipientsByMessageId},
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

mod db_types;
mod dynamic;
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
}
