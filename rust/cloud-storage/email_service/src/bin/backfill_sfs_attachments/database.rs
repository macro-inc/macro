use anyhow::Context;
use email_db_client::attachments::provider::upload_filters::ATTACHMENT_MIME_TYPE_FILTERS_WITH_MEDIA;
use models_email::service::attachment::AttachmentUploadMetadata;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use sqlx_core::row::Row;

/// Creates and returns a new PostgreSQL connection pool.
pub async fn create_db_pool(database_url: &str, min_connections: u32) -> anyhow::Result<PgPool> {
    PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(60)
        .connect(database_url)
        .await
        .context("Could not connect to db")
}

/// fetch the user's image and video attachments, ordered from oldest to newest
pub async fn fetch_sfs_attachments(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_id: &str,
) -> anyhow::Result<Vec<AttachmentUploadMetadata>> {
    let query = format!(
        r#"
        WITH link AS (
            SELECT id
            FROM public.email_links
            WHERE macro_id = $1
            LIMIT 1
        )
        SELECT
            a.id AS attachment_db_id,
            m.provider_id as email_provider_id,
            a.provider_attachment_id as provider_attachment_id,
            a.filename as filename,
            a.mime_type as mime_type,
            m.internal_date_ts as internal_date_ts,
            m.id as message_db_id,
            m.thread_id as thread_db_id,
            from_contact.email_address as sender_email,
            m.subject as subject
        FROM public.email_attachments a
        JOIN public.email_messages m ON a.message_id = m.id
        JOIN public.email_contacts from_contact ON m.from_contact_id = from_contact.id
        JOIN link ON m.link_id = link.id
        LEFT JOIN public.email_attachments_sfs eas ON eas.attachment_id = a.id
        WHERE
            -- attachment mime type filters injected below
            ({})
            AND eas.attachment_id IS NULL
        ORDER BY m.internal_date_ts asc
        "#,
        ATTACHMENT_MIME_TYPE_FILTERS_WITH_MEDIA
    );

    let rows = sqlx::query(&query).bind(macro_id).fetch_all(db).await?;

    let attachments = rows
        .into_iter()
        .map(|row| AttachmentUploadMetadata {
            attachment_db_id: row.get("attachment_db_id"),
            email_provider_id: row.get("email_provider_id"),
            provider_attachment_id: row.get("provider_attachment_id"),
            filename: row.get("filename"),
            mime_type: row.get("mime_type"),
            internal_date_ts: row.get("internal_date_ts"),
            message_db_id: row.get("message_db_id"),
            thread_db_id: row.get("thread_db_id"),
            sender_email: row.get("sender_email"),
            subject: row.get("subject"),
        })
        .collect();

    Ok(attachments)
}
