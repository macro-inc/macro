use crate::domain::models::{
    Attachment, Contact, EmailThreadPreview, Label, PreviewCursorQuery, PreviewView,
    PreviewViewStandardLabel,
};
use doppleganger::{Doppleganger, Mirror};
use either::Either;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::db_types::{AttachmentDbRow, LabelDbRow, ThreadPreviewCursorDbRow};

#[tracing::instrument(err, skip(pool, query), fields(link_count = query.link_ids.len(), view = %query.view))]
pub(super) async fn previews_for_view_cursor(
    pool: &PgPool,
    query: PreviewCursorQuery,
    user_id: MacroUserIdStr<'static>,
) -> Result<Vec<EmailThreadPreview>, sqlx::Error> {
    let PreviewCursorQuery {
        view,
        link_ids,
        limit,
        query,
        team_id,
    } = query;

    let query = query.split_option();

    Ok(match (view, query) {
        (view, Either::Right(dynamic_query)) => {
            super::dynamic::dynamic_email_thread_cursor(
                pool,
                &link_ids,
                limit,
                &view,
                dynamic_query,
                user_id.as_ref(),
                team_id,
            )
            .await?
        }
        (PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox), Either::Left(query)) => {
            super::preview_views::new_inbox::new_inbox_preview_cursor(
                pool, &link_ids, limit, &query,
            )
            .await?
        }
        (PreviewView::StandardLabel(PreviewViewStandardLabel::Sent), Either::Left(query)) => {
            super::preview_views::sent::sent_preview_cursor(pool, &link_ids, limit, &query).await?
        }
        (PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts), Either::Left(query)) => {
            super::preview_views::draft::drafts_preview_cursor(pool, &link_ids, limit, &query)
                .await?
        }
        (PreviewView::StandardLabel(PreviewViewStandardLabel::Starred), Either::Left(query)) => {
            super::preview_views::starred::starred_preview_cursor(pool, &link_ids, limit, &query)
                .await?
        }
        (PreviewView::StandardLabel(PreviewViewStandardLabel::All), Either::Left(query)) => {
            super::preview_views::all_mail::all_mail_preview_cursor(pool, &link_ids, limit, &query)
                .await?
        }
        (PreviewView::StandardLabel(PreviewViewStandardLabel::Important), Either::Left(query)) => {
            super::preview_views::important::important_preview_cursor(
                pool, &link_ids, limit, &query,
            )
            .await?
        }
        (PreviewView::StandardLabel(PreviewViewStandardLabel::Other), Either::Left(query)) => {
            super::preview_views::other_inbox::other_inbox_preview_cursor(
                pool, &link_ids, limit, &query,
            )
            .await?
        }
        (PreviewView::UserLabel(label_name), Either::Left(query)) => {
            super::preview_views::user_label::user_label_preview_cursor(
                pool,
                &link_ids,
                limit,
                &query,
                &label_name,
            )
            .await?
        }
    }
    .into_iter()
    .map(|row: ThreadPreviewCursorDbRow| row.into_preview())
    .collect())
}

#[tracing::instrument(err, skip(pool, thread_ids))]
pub(super) async fn attachments_by_thread_ids(
    pool: &PgPool,
    thread_ids: &[Uuid],
) -> Result<Vec<Attachment>, sqlx::Error> {
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
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(AttachmentDbRow::mirror)
    .collect())
}

#[tracing::instrument(err, skip(pool, thread_ids))]
pub(super) async fn contacts_by_thread_ids(
    pool: &PgPool,
    thread_ids: &[Uuid],
) -> Result<Vec<Contact>, sqlx::Error> {
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
            c.id, c.link_id, c.email_address, COALESCE(m.from_name, c.name) as "name", c.sfs_photo_url
        FROM email_messages m
        JOIN email_contacts c ON m.from_contact_id = c.id
        WHERE m.thread_id = ANY($1) AND m.from_contact_id IS NOT NULL
        ORDER BY m.created_at ASC
        "#,
        thread_ids
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(ThreadContactResult::mirror)
    .collect())
}

#[tracing::instrument(err, skip(pool, thread_ids))]
pub(super) async fn labels_by_thread_ids(
    pool: &PgPool,
    thread_ids: &[Uuid],
) -> Result<Vec<Label>, sqlx::Error> {
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
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(LabelDbRow::mirror)
    .collect())
}
