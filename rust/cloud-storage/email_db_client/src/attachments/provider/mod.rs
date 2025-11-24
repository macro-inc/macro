pub mod upload;
pub mod upload_filters;

use crate::parse::db_to_service::map_db_attachment_to_service;
use crate::parse::service_to_db::map_service_attachments_to_db;
use anyhow::Context;
use models_email::db::attachment;
use models_email::{db, service};
use sqlx::types::Uuid;
use sqlx::{Executor, PgPool, Pool, Postgres};
use std::collections::HashMap;

/// inserts the metadata for attachments of an email into the database in a batch
#[tracing::instrument(skip(tx, attachments, message_id))]
pub async fn insert_attachments(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    attachments: &mut [service::attachment::Attachment],
) -> anyhow::Result<()> {
    if attachments.is_empty() {
        return Ok(());
    }

    let db_attachments = map_service_attachments_to_db(attachments, message_id);

    let existing_attachments = sqlx::query_as!(
        db::attachment::Attachment,
        r#"
        SELECT id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at
        FROM email_attachments
        WHERE message_id = $1
        "#,
        message_id
    ).fetch_all(&mut *tx).await.with_context(|| {
        format!(
            "Failed to fetch attachments for message_id {}",
            message_id
        )
    })?;

    // Filter to find attachments that exist in the database but don't match any in db_attachments.
    // we compare using filename, mime_type, size_bytes, and content_id as we don't get a concrete ID from gmail that
    // we can use to compare against.

    let orphaned_attachments: Vec<_> = existing_attachments
        .iter()
        .filter(|existing| {
            !db_attachments.iter().any(|attachment| {
                existing.filename == attachment.filename
                    && existing.mime_type == attachment.mime_type
                    && existing.size_bytes == attachment.size_bytes
                    && existing.content_id == attachment.content_id
            })
        })
        .cloned()
        .collect();

    // Only insert attachments from current_attachments that don't match any in the database
    // we compare using filename, mime_type, size_bytes, and content_id as we don't get a concrete ID from gmail that
    // we can use to compare against.
    let new_attachments: Vec<_> = db_attachments
        .into_iter()
        .filter(|attachment| {
            !existing_attachments.iter().any(|existing| {
                existing.filename == attachment.filename
                    && existing.mime_type == attachment.mime_type
                    && existing.size_bytes == attachment.size_bytes
                    && existing.content_id == attachment.content_id
            })
        })
        .collect();

    // delete orphaned attachments
    if !orphaned_attachments.is_empty() {
        let orphaned_ids: Vec<Uuid> = orphaned_attachments
            .iter()
            .map(|orphan| orphan.id)
            .collect();
        sqlx::query!(
            r#"
            DELETE FROM email_attachments
            WHERE id = ANY($1::uuid[])
            "#,
            &orphaned_ids
        )
        .execute(&mut *tx)
        .await
        .with_context(|| {
            format!(
                "Failed to delete orphaned attachments with ids {:?} for message_id {}",
                orphaned_ids, message_id
            )
        })?;
    }

    if new_attachments.is_empty() {
        return Ok(());
    }

    let n = new_attachments.len();
    let mut attachment_ids_repeated: Vec<Uuid> = Vec::with_capacity(n);
    let mut message_ids_repeated: Vec<Uuid> = Vec::with_capacity(n);
    let mut provider_attachment_ids: Vec<Option<String>> = Vec::with_capacity(n);
    let mut filenames: Vec<Option<String>> = Vec::with_capacity(n);
    let mut mime_types: Vec<Option<String>> = Vec::with_capacity(n);
    let mut size_bytes_vec: Vec<Option<i64>> = Vec::with_capacity(n);
    let mut content_ids: Vec<Option<String>> = Vec::with_capacity(n);

    for attachment in new_attachments.into_iter() {
        attachment_ids_repeated.push(attachment.id);
        message_ids_repeated.push(attachment.message_id);
        provider_attachment_ids.push(attachment.provider_attachment_id);
        filenames.push(attachment.filename);
        mime_types.push(attachment.mime_type);
        size_bytes_vec.push(attachment.size_bytes);
        content_ids.push(attachment.content_id);
    }

    // Use query() for unnest as query! has trouble inferring all Option types
    sqlx::query(
        r#"
        WITH input_rows (
            id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id
        ) AS (
           SELECT * FROM unnest(
               $1::uuid[], $2::uuid[], $3::text[], $4::varchar[], $5::varchar[], $6::bigint[], $7::varchar[]
           )
        )
        INSERT INTO email_attachments (
            id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id
        )
        SELECT id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id
        FROM input_rows
        ON CONFLICT (message_id, provider_attachment_id)
        DO NOTHING
        "#,
    )
        .bind(&attachment_ids_repeated)
        .bind(&message_ids_repeated)
        .bind(&provider_attachment_ids)
        .bind(&filenames)
        .bind(&mime_types)
        .bind(&size_bytes_vec)
        .bind(&content_ids)
        .execute(&mut *tx)
        .await
        .with_context(|| {
            format!(
                "Failed to batch insert/update attachment metadata for message_id {} and provider_attachment_ids {:?}",
                message_id, provider_attachment_ids
            )
        })?;

    Ok(())
}

#[tracing::instrument(skip(pool))]
pub async fn fetch_db_attachments(
    pool: &PgPool,
    message_db_id: Uuid,
) -> anyhow::Result<Vec<attachment::Attachment>> {
    sqlx::query_as!(
        db::attachment::Attachment,
        r#"
        SELECT id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at
        FROM email_attachments
        WHERE message_id = $1
        ORDER BY filename NULLS LAST
        "#,
        message_db_id
    )
        .fetch_all(pool)
        .await
        .context("Failed to fetch attachments")
}

// deletes all attachments of a given message
#[tracing::instrument(skip(executor), level = "info")]
pub async fn delete_message_attachments<'e, E>(executor: E, message_id: Uuid) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query!(
        r#"DELETE FROM email_attachments WHERE message_id = $1"#,
        message_id
    )
    .execute(executor)
    .await
    .with_context(|| format!("Failed to delete attachments for message_id {}", message_id))?;

    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn fetch_attachment_by_id(
    pool: &PgPool,
    attachment_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<Option<(service::attachment::Attachment, String)>> {
    // Modified query to include message.provider_id
    let result = sqlx::query!(
        r#"
        SELECT 
            a.id, a.message_id, a.provider_attachment_id, 
            a.filename, a.mime_type, a.size_bytes, 
            a.content_id, a.created_at, m.provider_id as "message_provider_id!"
        FROM email_attachments a
        JOIN email_messages m ON a.message_id = m.id
        WHERE a.id = $1 AND m.link_id = $2
        "#,
        attachment_id,
        link_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch attachment with id {} for link_id {}",
            attachment_id, link_id
        )
    })?;

    match result {
        Some(record) => {
            // Construct the attachment record
            let db_att = db::attachment::Attachment {
                id: record.id,
                message_id: record.message_id,
                provider_attachment_id: record.provider_attachment_id,
                filename: record.filename,
                mime_type: record.mime_type,
                size_bytes: record.size_bytes,
                content_id: record.content_id,
                created_at: record.created_at,
            };

            // Map to service attachment and include the message provider ID
            let service_att = map_db_attachment_to_service(db_att);
            Ok(Some((service_att, record.message_provider_id)))
        }
        None => Ok(None),
    }
}

#[tracing::instrument(skip(db), err)]
pub async fn get_attachments_by_thread_ids(
    db: &Pool<Postgres>,
    thread_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, Vec<service::attachment::Attachment>>> {
    if thread_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Query all attachments for messages in the provided threads
    // Include thread_id in the result set
    let attachments = sqlx::query!(
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
    .fetch_all(db)
    .await
    .context("Failed to fetch attachments for threads")?;

    // Group attachments by thread_id
    let mut result: HashMap<Uuid, Vec<service::attachment::Attachment>> = HashMap::new();

    for record in attachments {
        // Construct db::attachment::Attachment from the query result
        let db_attachment = db::attachment::Attachment {
            id: record.id,
            message_id: record.message_id,
            provider_attachment_id: record.provider_attachment_id,
            filename: record.filename,
            mime_type: record.mime_type,
            size_bytes: record.size_bytes,
            content_id: record.content_id,
            created_at: record.created_at,
        };

        // Map the db attachment to a service attachment
        let service_attachment = map_db_attachment_to_service(db_attachment);

        // Add to the result map
        result
            .entry(record.thread_id)
            .or_default()
            .push(service_attachment);
    }

    Ok(result)
}

/// Get document_id for email attachment if record exists
#[tracing::instrument(skip(db), err)]
pub async fn get_document_id_by_attachment_id(
    db: &Pool<Postgres>,
    link_id: Uuid,
    email_attachment_id: Uuid,
) -> anyhow::Result<Option<String>> {
    let result = sqlx::query!(
        r#"
        SELECT document_id
        FROM document_email de
        INNER JOIN email_attachments ea on de.email_attachment_id = ea.id
        INNER JOIN email_messages em on ea.message_id = em.id
        WHERE em.link_id = $1 AND email_attachment_id = $2
        "#,
        link_id,
        email_attachment_id,
    )
    .fetch_optional(db)
    .await?;

    Ok(result.map(|record| record.document_id))
}
