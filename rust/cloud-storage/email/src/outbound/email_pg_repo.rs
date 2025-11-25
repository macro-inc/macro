use crate::domain::models::Label;
use crate::domain::{
    models::{
        Attachment, AttachmentMacro, Contact, EmailThreadPreview, PreviewCursorQuery, PreviewView,
        PreviewViewStandardLabel,
    },
    ports::EmailRepo,
};
use db_types::*;
use doppleganger::{Doppleganger, Mirror};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

mod db_types;
mod queries;

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
        Ok(match query.view {
            PreviewView::StandardLabel(ref label) => match label {
                PreviewViewStandardLabel::Inbox => {
                    queries::new_inbox::new_inbox_preview_cursor(
                        &self.pool,
                        &query,
                        user_id.copied(),
                    )
                    .await?
                }
                PreviewViewStandardLabel::Sent => {
                    queries::sent::sent_preview_cursor(&self.pool, &query, user_id.copied()).await?
                }
                PreviewViewStandardLabel::Drafts => {
                    queries::draft::drafts_preview_cursor(&self.pool, &query, user_id.copied())
                        .await?
                }
                PreviewViewStandardLabel::Starred => {
                    queries::starred::starred_preview_cursor(&self.pool, &query, user_id.copied())
                        .await?
                }
                PreviewViewStandardLabel::All => {
                    queries::all_mail::all_mail_preview_cursor(&self.pool, &query, user_id.copied())
                        .await?
                }
                PreviewViewStandardLabel::Important => {
                    queries::important::important_preview_cursor(
                        &self.pool,
                        &query,
                        user_id.copied(),
                    )
                    .await?
                }
                PreviewViewStandardLabel::Other => {
                    queries::other_inbox::other_inbox_preview_cursor(
                        &self.pool,
                        &query,
                        user_id.copied(),
                    )
                    .await?
                }
            },
            PreviewView::UserLabel(ref label_name) => {
                queries::user_label::user_label_preview_cursor(
                    &self.pool,
                    &query,
                    label_name,
                    user_id.copied(),
                )
                .await?
            }
        }
        .into_iter()
        .map(|row| row.with_user_id(user_id.clone()))
        .collect())
    }

    async fn attachments_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> Result<Vec<Attachment>, Self::Err> {
        // Query all attachments for messages in the provided threads
        // Include thread_id in the result set
        Ok(sqlx::query_as!(
            AttachmentDbRow,
            r#"
            SELECT 
                a.id,
                a.message_id,
                a.provider_attachment_id,
                a.filename,
                a.mime_type,
                a.size_bytes,
                a.content_id,
                a.created_at,
                m.thread_id
            FROM 
                email_attachments a
            JOIN
                email_messages m ON a.message_id = m.id
            WHERE 
                m.thread_id = ANY($1)
            ORDER BY 
                a.created_at ASC
            "#,
            thread_ids
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(AttachmentDbRow::mirror)
        .collect())
    }

    async fn macro_attachments_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> Result<Vec<AttachmentMacro>, Self::Err> {
        // Query all attachments for email_messages in the provided threads
        // Include thread_id in the result set
        Ok(sqlx::query_as!(
            AttachmentMacroDbRow,
            r#"
        SELECT
            a.id,
            a.message_id,
            a.item_id as "item_id!",
            a.item_type as "item_type!",
            a.created_at,
            m.thread_id
        FROM
            email_attachments_macro a
        JOIN
            email_messages m ON a.message_id = m.id
        WHERE
            m.thread_id = ANY($1)
        ORDER BY
            a.created_at ASC
        "#,
            thread_ids
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(AttachmentMacroDbRow::mirror)
        .collect())
    }

    async fn contacts_by_thread_ids(&self, thread_ids: &[Uuid]) -> Result<Vec<Contact>, Self::Err> {
        // Define a struct to hold the joined results
        #[derive(Debug, Doppleganger)]
        #[dg(forward = Contact)]
        struct ThreadContactResult {
            thread_id: Uuid,
            id: Uuid,
            link_id: Uuid,
            email_address: Option<String>,
            name: Option<String>,
            sfs_photo_url: Option<String>,
        }

        Ok(sqlx::query_as!(
            ThreadContactResult,
            r#"
            SELECT
                m.thread_id,
                c.id, c.link_id, c.email_address, c.name, c.sfs_photo_url
            FROM email_messages m
            JOIN email_contacts c ON m.from_contact_id = c.id
            WHERE m.thread_id = ANY($1) AND m.from_contact_id IS NOT NULL
            ORDER BY m.created_at ASC
            "#,
            thread_ids
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(ThreadContactResult::mirror)
        .collect())
    }

    async fn labels_by_thread_ids(&self, thread_ids: &[Uuid]) -> Result<Vec<Label>, Self::Err> {
        // Query all labels for email_messages in the provided threads
        // Include thread_id in the result set
        Ok(sqlx::query_as!(
            LabelDbRow,
            r#"
        SELECT DISTINCT ON (l.id, m.thread_id)
            l.id,
            m.thread_id as "thread_id!",
            l.link_id,
            l.provider_label_id,
            l.name,
            l.created_at,
            l.message_list_visibility as "message_list_visibility: _",
            l.label_list_visibility as "label_list_visibility: _",
            l.type as "type_: _"
        FROM
             email_messages m
        JOIN email_message_labels ml ON m.id = ml.message_id
        JOIN email_labels l ON ml.label_id = l.id
        WHERE m.thread_id = ANY($1)
        "#,
            thread_ids
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(LabelDbRow::mirror)
        .collect())
    }
}
