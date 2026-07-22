//! Queries for entity metadata (documents, threads, projects) read from macrodb.
//!
//! These read tables owned by other domains; the properties domain surfaces
//! them as read-only metadata properties.

use document_sub_type::DocumentSubType;
use models_properties::service::document_metadata::DocumentMetadata;
use models_properties::service::project_metadata::ProjectMetadata;
use models_properties::service::thread_metadata::ThreadMetadata;
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

/// Resolve document subtypes for a batch of canonical document IDs.
#[tracing::instrument(skip(pool, document_ids), fields(document_count = document_ids.len()), err)]
pub async fn get_document_sub_types(
    pool: &Pool<Postgres>,
    document_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, DocumentSubType>> {
    if document_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Document ids are stored as text in MacroDB. Keep the port strongly
    // typed and convert only in this outbound adapter.
    let document_ids = document_ids.iter().map(Uuid::to_string).collect::<Vec<_>>();
    let rows = sqlx::query!(
        r#"
        SELECT
            document_id,
            sub_type as "sub_type: DocumentSubType"
        FROM document_sub_type
        WHERE document_id = ANY($1)
        "#,
        &document_ids
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| Ok((Uuid::parse_str(&row.document_id)?, row.sub_type)))
        .collect()
}

/// Get document metadata by document ID from macrodb
#[tracing::instrument(skip(pool), err)]
pub async fn get_document_metadata(
    pool: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<Option<DocumentMetadata>> {
    let result = sqlx::query!(
        r#"
        SELECT
            d.id,
            d.name,
            d.owner,
            d."fileType" as "file_type",
            d."projectId" as "project_id",
            d."createdAt"::timestamptz as "created_at!",
            d."updatedAt"::timestamptz as "updated_at!"
        FROM
            "Document" d
        WHERE
            d.id = $1
        "#,
        document_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(result.map(|row| DocumentMetadata {
        id: row.id,
        name: row.name,
        owner: row.owner,
        file_type: row.file_type,
        project_id: row.project_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}

/// Get thread metadata by thread ID from macrodb
#[tracing::instrument(skip(pool), err)]
pub async fn get_thread_metadata(
    pool: &Pool<Postgres>,
    thread_id: Uuid,
) -> anyhow::Result<Option<ThreadMetadata>> {
    Ok(sqlx::query_as!(
        ThreadMetadata,
        r#"
        SELECT
            t.id,
            t.latest_inbound_message_ts as last_received,
            t.latest_outbound_message_ts as last_sent,
            first_msg.internal_date_ts as thread_started,
            first_msg.subject,
            (SELECT COUNT(*)::bigint FROM email_messages WHERE thread_id = t.id) as "message_count!"
        FROM
            email_threads t
        -- LATERAL join to get subject and timestamp from the first message
        LEFT JOIN LATERAL (
            SELECT internal_date_ts, subject
            FROM email_messages
            WHERE thread_id = t.id
            ORDER BY internal_date_ts ASC NULLS LAST
            LIMIT 1
        ) first_msg ON true
        WHERE
            t.id = $1
        "#,
        thread_id
    )
    .fetch_optional(pool)
    .await?)
}

/// Get project metadata by project ID from macrodb
#[tracing::instrument(skip(pool), err)]
pub async fn get_project_metadata(
    pool: &Pool<Postgres>,
    project_id: &str,
) -> anyhow::Result<Option<ProjectMetadata>> {
    Ok(sqlx::query_as!(
        ProjectMetadata,
        r#"
        SELECT
            p.id,
            p.name,
            p."userId" as "owner",
            p."parentId" as "parent_id",
            p."createdAt"::timestamptz as "created_at!",
            p."updatedAt"::timestamptz as "updated_at!"
        FROM
            "Project" p
        WHERE
            p.id = $1 AND p."deletedAt" IS NULL
        "#,
        project_id
    )
    .fetch_optional(pool)
    .await?)
}
