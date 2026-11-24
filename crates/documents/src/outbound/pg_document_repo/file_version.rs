//! SQL for adding a version (`DocumentInstance`) to a file document.

use model::document::FileType;
use sqlx::PgPool;

use crate::domain::models::AddedFileVersion;

/// Lock the live document, answer its newest instance when that already
/// holds `sha`, and otherwise insert a new instance and mark the document
/// updated. The row lock orders concurrent adds of one document, so two adds
/// of the same bytes never insert two instances.
pub(super) async fn add_document_instance(
    pool: &PgPool,
    document_id: &str,
    file_type: FileType,
    sha: &str,
) -> Result<Option<AddedFileVersion>, sqlx::Error> {
    let mut transaction = pool.begin().await?;

    let live = sqlx::query_scalar!(
        r#"
        SELECT id FROM "Document"
        WHERE id = $1 AND "deletedAt" IS NULL AND "fileType" = $2
        FOR UPDATE
        "#,
        document_id,
        file_type.as_str(),
    )
    .fetch_optional(transaction.as_mut())
    .await?;

    if live.is_none() {
        return Ok(None);
    }

    let newest = sqlx::query!(
        r#"
        SELECT id, sha FROM "DocumentInstance"
        WHERE "documentId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 1
        "#,
        document_id,
    )
    .fetch_optional(transaction.as_mut())
    .await?;

    if let Some(newest) = newest
        && newest.sha == sha
    {
        return Ok(Some(AddedFileVersion {
            document_version_id: newest.id,
            created: false,
        }));
    }

    // Readers take the instance with the latest "createdAt", which has only
    // millisecond precision: stamp the new one at least a millisecond after
    // the newest, so it is the one served even when added right after it.
    let document_version_id = sqlx::query_scalar!(
        r#"
        INSERT INTO "DocumentInstance" ("documentId", sha, "createdAt", "updatedAt")
        SELECT $1, $2, next.stamp, next.stamp
        FROM (
            SELECT GREATEST(
                LOCALTIMESTAMP(3),
                (SELECT max("createdAt") FROM "DocumentInstance" WHERE "documentId" = $1)
                    + interval '1 millisecond'
            ) AS stamp
        ) AS next
        RETURNING id
        "#,
        document_id,
        sha,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    sqlx::query!(
        r#"UPDATE "Document" SET "updatedAt" = NOW() WHERE id = $1"#,
        document_id,
    )
    .execute(transaction.as_mut())
    .await?;

    transaction.commit().await?;

    Ok(Some(AddedFileVersion {
        document_version_id,
        created: true,
    }))
}

/// Delete one instance of a document.
pub(super) async fn remove_document_instance(
    pool: &PgPool,
    document_id: &str,
    document_version_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM "DocumentInstance" WHERE id = $1 AND "documentId" = $2"#,
        document_version_id,
        document_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}
