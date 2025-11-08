use crate::parse::db_to_service::map_db_macro_attachment_to_service;
use crate::parse::service_to_db::map_service_macro_attachments_to_db;
use anyhow::Context;
use models_email::db::attachment;
use models_email::{db, service};
use sqlx::types::Uuid;
use sqlx::{PgPool, Pool, Postgres};
use std::collections::HashMap;

/// inserts the metadata for attachments of an email into the database in a batch
#[tracing::instrument(skip(tx, attachments, message_id))]
pub async fn insert_macro_attachments(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    attachments: &mut [service::attachment::AttachmentMacro],
) -> anyhow::Result<()> {
    if attachments.is_empty() {
        return Ok(());
    }

    let db_attachments = map_service_macro_attachments_to_db(attachments, message_id);

    let existing_attachments = sqlx::query_as!(
        db::attachment::AttachmentMacro,
        r#"
        SELECT id, message_id, item_id, item_type, created_at
        FROM email_attachments_macro
        WHERE message_id = $1
        "#,
        message_id
    )
    .fetch_all(&mut *tx)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch macro attachments for message_id {}",
            message_id
        )
    })?;

    // Filter to find attachments that exist in the database but don't match any in db_attachments

    let orphaned_attachments: Vec<_> = existing_attachments
        .iter()
        .filter(|existing| {
            !db_attachments.iter().any(|attachment| {
                existing.item_id == attachment.item_id && existing.item_type == attachment.item_type
            })
        })
        .cloned()
        .collect();

    // Only insert attachments from db_attachments that don't match any in the database
    let new_attachments: Vec<_> = db_attachments
        .into_iter()
        .filter(|attachment| {
            !existing_attachments.iter().any(|existing| {
                existing.item_id == attachment.item_id && existing.item_type == attachment.item_type
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
            DELETE FROM email_attachments_macro
            WHERE id = ANY($1::uuid[])
            "#,
            &orphaned_ids
        )
        .execute(&mut *tx)
        .await
        .with_context(|| {
            format!(
                "Failed to delete orphaned macro attachments with ids {:?} for message_id {}",
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
    let mut item_ids: Vec<Uuid> = Vec::with_capacity(n);
    let mut item_types: Vec<String> = Vec::with_capacity(n);

    for attachment in new_attachments.into_iter() {
        attachment_ids_repeated.push(attachment.id);
        message_ids_repeated.push(attachment.message_id);
        item_ids.push(attachment.item_id);
        item_types.push(attachment.item_type);
    }

    // Use query() for unnest as query! has trouble inferring all Option types
    sqlx::query(
        r#"
        WITH input_rows (
            id, message_id, item_id, item_type
        ) AS (
           SELECT * FROM unnest(
               $1::uuid[], $2::uuid[], $3::uuid[], $4::varchar[]
           )
        )
        INSERT INTO email_attachments_macro (
            id, message_id, item_id, item_type
        )
        SELECT id, message_id, item_id, item_type
        FROM input_rows
        ON CONFLICT (message_id, item_id, item_type)
        DO NOTHING
        "#,
    )
        .bind(&attachment_ids_repeated)
        .bind(&message_ids_repeated)
        .bind(&item_ids)
        .bind(&item_types)
        .execute(&mut *tx)
        .await
        .with_context(|| {
            format!(
                "Failed to batch insert/update macro attachment metadata for message_id {} and item {:?}",
                message_id, item_ids
            )
        })?;

    Ok(())
}

#[tracing::instrument(skip(pool))]
pub async fn fetch_db_macro_attachments(
    pool: &PgPool,
    message_db_id: Uuid,
) -> anyhow::Result<Vec<attachment::AttachmentMacro>> {
    sqlx::query_as!(
        db::attachment::AttachmentMacro,
        r#"
        SELECT id, message_id, item_id, item_type, created_at
        FROM email_attachments_macro
        WHERE message_id = $1
        ORDER BY id desc
        "#,
        message_db_id
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch attachments")
}

#[tracing::instrument(skip(db), err)]
pub async fn get_macro_attachments_by_thread_ids(
    db: &Pool<Postgres>,
    thread_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, Vec<service::attachment::AttachmentMacro>>> {
    if thread_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Query all attachments for email_messages in the provided threads
    // Include thread_id in the result set
    let attachments = sqlx::query!(
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
    .fetch_all(db)
    .await
    .context("Failed to fetch macro attachments for threads")?;

    // Group attachments by thread_id
    let mut result: HashMap<Uuid, Vec<service::attachment::AttachmentMacro>> = HashMap::new();

    for record in attachments {
        // Construct db::attachment::Attachment from the query result
        let db_attachment = db::attachment::AttachmentMacro {
            id: record.id,
            message_id: record.message_id,
            item_type: record.item_type,
            item_id: record.item_id,
            created_at: record.created_at,
        };

        // Map the db attachment to a service attachment
        let service_attachment = map_db_macro_attachment_to_service(db_attachment);

        // Add to the result map
        result
            .entry(record.thread_id)
            .or_default()
            .push(service_attachment);
    }

    Ok(result)
}
