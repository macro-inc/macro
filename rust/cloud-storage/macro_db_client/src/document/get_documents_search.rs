use std::str::FromStr;

use chrono::{DateTime, Utc};
use sqlx::{Pool, Postgres};

use model::document::{BackfillSearchDocumentInformation, FileType};

/// Used to get all documents in a paginated format
/// This will get the latest version of the document for non-pdf documents
/// For pdf documents, this will get the oldest version of the document
///
/// Pagination is **keyset (seek-method)**: pass `cursor` as the last row's
/// `(updated_at, document_id)` pair from the previous page (or `None` for
/// the first page).
///
/// Sorting and filtering use `updatedAt` rather than `createdAt` so that
/// incremental backfills (e.g. "anything changed since X") catch documents
/// that already existed but were modified after the cutoff.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db))]
pub async fn get_documents_for_search(
    db: &Pool<Postgres>,
    limit: i64,
    cursor: Option<(DateTime<Utc>, String)>,
    file_types: &Option<Vec<String>>,
    sub_type: &Option<String>,
    updated_after: &Option<DateTime<Utc>>,
    updated_before: &Option<DateTime<Utc>>,
    only_deleted: Option<bool>,
) -> anyhow::Result<Vec<BackfillSearchDocumentInformation>> {
    let (cursor_updated_at, cursor_id) = match cursor {
        Some((t, id)) => (Some(t), Some(id)),
        None => (None, None),
    };
    let result = sqlx::query!(
        r#"
        SELECT
            d.id as document_id,
            d.owner as owner,
            d."fileType" as "file_type!",
            COALESCE(db.id, di.id, dipdf.id) as "document_version_id!",
            d."updatedAt"::timestamptz as "updated_at"
        FROM
            "Document" d
        LEFT JOIN document_sub_type dst ON dst.document_id = d.id
        LEFT JOIN LATERAL (
            SELECT
                b.id
            FROM
                "DocumentBom" b
            WHERE
                b."documentId" = d.id
            ORDER BY
                b."createdAt" DESC
            LIMIT 1
        ) db ON d."fileType" = 'docx'
        LEFT JOIN LATERAL (
            SELECT
                i.id
            FROM
                "DocumentInstance" i
            WHERE
                i."documentId" = d.id
            ORDER BY
                i."updatedAt" ASC
            LIMIT 1
        ) dipdf ON d."fileType" = 'pdf'
        LEFT JOIN LATERAL (
            SELECT
                i.id
            FROM
                "DocumentInstance" i
            WHERE
                i."documentId" = d.id
            ORDER BY
                i."createdAt" DESC
            LIMIT 1
        ) di ON d."fileType" IS DISTINCT FROM 'docx' AND d."fileType" IS DISTINCT FROM 'pdf'
        WHERE
            d."fileType" IS NOT NULL
            AND ($3::text[] IS NULL OR d."fileType" = ANY($3))
            AND ($4::text IS NULL OR dst.sub_type::text = $4)
            AND ($5::timestamptz IS NULL OR d."updatedAt" >= $5)
            AND ($6::timestamptz IS NULL OR d."updatedAt" < $6)
            AND (
                $7::bool IS NULL
                OR ($7 AND d."deletedAt" IS NOT NULL)
                OR (NOT $7 AND d."deletedAt" IS NULL)
            )
            AND (
                $2::timestamptz IS NULL
                OR (d."updatedAt", d.id) > ($2, $8::text)
            )
        ORDER BY d."updatedAt" ASC, d.id ASC
        LIMIT $1
    "#,
        limit,
        cursor_updated_at as Option<DateTime<Utc>>,
        file_types.as_deref() as Option<&[String]>,
        sub_type.as_deref() as Option<&str>,
        *updated_after as Option<DateTime<Utc>>,
        *updated_before as Option<DateTime<Utc>>,
        only_deleted,
        cursor_id as Option<String>,
    )
    .fetch_all(db)
    .await?;

    // Rows whose `fileType` doesn't map to a known `FileType` variant are
    // skipped with a warning rather than aborting the whole batch: prod has
    // historical rows with extensions the enum doesn't recognize yet, and
    // failing the page would stall every backfill behind a single bad row.
    let mapped = result
        .into_iter()
        .filter_map(|row| match FileType::from_str(row.file_type.as_str()) {
            Ok(file_type) => Some(BackfillSearchDocumentInformation {
                document_id: row.document_id,
                document_version_id: row.document_version_id,
                owner: row.owner,
                file_type,
                updated_at: row.updated_at,
            }),
            Err(e) => {
                tracing::warn!(
                    document_id = %row.document_id,
                    file_type = %row.file_type,
                    error = ?e,
                    "skipping document with unknown file type during search backfill"
                );
                None
            }
        })
        .collect();

    Ok(mapped)
}
