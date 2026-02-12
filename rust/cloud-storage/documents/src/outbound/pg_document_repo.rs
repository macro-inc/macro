//! PostgreSQL implementation of the [`DocumentRepo`] port.
//!
//! All SQL queries are written directly here (not delegated to `macro_db_client`).

#[cfg(test)]
mod tests;

use document_sub_type::DocumentSubType;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::document::{DocumentBasic, DocumentMetadata};
use sqlx::PgPool;

use crate::domain::ports::DocumentRepo;

/// PostgreSQL-backed document repository.
#[derive(Clone)]
pub struct PgDocumentRepo {
    pool: PgPool,
}

impl PgDocumentRepo {
    /// Create a new repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl DocumentRepo for PgDocumentRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self))]
    async fn get_document_metadata(
        &self,
        document_id: &str,
    ) -> Result<DocumentMetadata, Self::Err> {
        sqlx::query!(
            r#"
            SELECT
                d.id as "document_id",
                d.owner as "owner",
                COALESCE(db.id, di.id) as "document_version_id!",
                d.name as "document_name",
                d."branchedFromId" as "branched_from_id",
                d."branchedFromVersionId" as "branched_from_version_id",
                d."documentFamilyId" as "document_family_id",
                d."createdAt"::timestamptz as "created_at",
                d."updatedAt"::timestamptz as "updated_at",
                d."fileType" as "file_type",
                db.bom_parts as "document_bom?",
                di.modification_data as "modification_data?",
                d."projectId" as "project_id",
                p.name as "project_name?",
                di.sha as "sha?",
                dt.sub_type as "sub_type?: DocumentSubType",
                d."deletedAt"::timestamptz as "deleted_at"
            FROM
                "Document" d
            LEFT JOIN document_sub_type dt ON dt.document_id = d.id
            LEFT JOIN LATERAL (
                SELECT
                    i.id,
                    i.sha,
                    i."createdAt",
                    (
                        SELECT
                            imod."modificationData"
                        FROM
                            "DocumentInstanceModificationData" imod
                        WHERE
                            imod."documentInstanceId" = i.id
                    ) as modification_data,
                    i."updatedAt"
                FROM
                    "DocumentInstance" i
                WHERE
                    i."documentId" = d.id
                ORDER BY
                    i."createdAt" DESC
                LIMIT 1
            ) di ON true
            LEFT JOIN LATERAL (
                SELECT
                    b.id,
                    (
                        SELECT
                            json_agg(
                                json_build_object(
                                    'id', bp.id,
                                    'sha', bp.sha,
                                    'path', bp.path
                                )
                            )
                        FROM
                            "BomPart" bp
                        WHERE
                            bp."documentBomId" = b.id
                    ) as bom_parts
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
                    p.name
                FROM "Project" p
                WHERE p.id = d."projectId"
            ) p ON d."projectId" IS NOT NULL
            WHERE
                d.id = $1
            LIMIT 1
            "#,
            document_id,
        )
        .try_map(|row| {
            Ok(DocumentMetadata {
                document_id: row.document_id,
                document_version_id: row.document_version_id,
                owner: MacroUserIdStr::parse_from_str(&row.owner)
                    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                    .into_owned(),
                document_name: row.document_name,
                file_type: row.file_type,
                sha: row.sha,
                project_id: row.project_id,
                project_name: row.project_name,
                branched_from_id: row.branched_from_id,
                branched_from_version_id: row.branched_from_version_id,
                document_family_id: row.document_family_id,
                document_bom: row.document_bom,
                modification_data: row.modification_data,
                created_at: row.created_at,
                updated_at: row.updated_at,
                sub_type: row.sub_type,
                deleted_at: row.deleted_at,
            })
        })
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_user_view_location(
        &self,
        user_id: &str,
        document_id: &str,
    ) -> Result<Option<String>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT location
            FROM "UserDocumentViewLocation"
            WHERE user_id = $1 AND document_id = $2
            "#,
            user_id,
            document_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| r.location))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_basic_document(&self, document_id: &str) -> Result<DocumentBasic, Self::Err> {
        sqlx::query!(
            r#"
            SELECT
                d.id as "document_id",
                d.owner,
                d.name as "document_name",
                d."branchedFromId" as "branched_from_id",
                d."branchedFromVersionId" as "branched_from_version_id",
                d."documentFamilyId" as "document_family_id",
                d."fileType" as "file_type",
                d."projectId" as "project_id",
                d."deletedAt"::timestamptz as "deleted_at"
            FROM
                "Document" d
            WHERE
                d.id = $1
            LIMIT 1
            "#,
            document_id,
        )
        .try_map(|row| {
            Ok(DocumentBasic {
                document_id: row.document_id,
                document_name: row.document_name,
                owner: MacroUserIdStr::parse_from_str(&row.owner)
                    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                    .into_owned(),
                file_type: row.file_type,
                branched_from_id: row.branched_from_id,
                branched_from_version_id: row.branched_from_version_id,
                document_family_id: row.document_family_id,
                project_id: row.project_id,
                deleted_at: row.deleted_at,
            })
        })
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn soft_delete_document(&self, document_id: &str) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;

        // Delete pins
        sqlx::query!(
            r#"
            DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = $2
            "#,
            document_id,
            "document",
        )
        .execute(&mut *transaction)
        .await?;

        // Delete from history
        sqlx::query!(
            r#"
            DELETE FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = $2
            "#,
            document_id,
            "document",
        )
        .execute(&mut *transaction)
        .await?;

        // Soft delete the document
        sqlx::query!(
            r#"
            UPDATE "Document"
            SET "deletedAt" = NOW()
            WHERE id = $1
            "#,
            document_id,
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_latest_document_version_id(
        &self,
        document_id: &str,
    ) -> Result<(i64, bool), Self::Err> {
        sqlx::query!(
            r#"
            SELECT
                di.id,
                d.uploaded
            FROM "DocumentInstance" di
            JOIN "Document" d ON di."documentId" = d.id
            WHERE di."documentId" = $1
            ORDER BY di."createdAt" DESC
            LIMIT 1
            "#,
            document_id,
        )
        .map(|row| (row.id, row.uploaded))
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_document_version_id(&self, document_id: &str) -> Result<(i64, bool), Self::Err> {
        sqlx::query!(
            r#"
            SELECT
                COALESCE(db.id, di.id) as "id!",
                d.uploaded
            FROM
                "Document" d
            LEFT JOIN LATERAL (
                SELECT
                    i.id
                FROM
                    "DocumentInstance" i
                WHERE
                    i."documentId" = d.id
                ORDER BY
                    i."createdAt" ASC
                LIMIT 1
            ) di ON d."fileType" IS DISTINCT FROM 'docx'
            LEFT JOIN LATERAL (
                SELECT
                    b.id
                FROM
                    "DocumentBom" b
                WHERE
                    b."documentId" = d.id
                ORDER BY
                    b."createdAt" ASC
                LIMIT 1
            ) db ON d."fileType" = 'docx'
            WHERE
                d.id = $1
            LIMIT 1
            "#,
            document_id,
        )
        .map(|row| (row.id, row.uploaded))
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_document_shas(&self, document_version_id: i64) -> Result<Vec<String>, Self::Err> {
        sqlx::query!(
            r#"
            SELECT bp.sha
            FROM "BomPart" bp
            WHERE bp."documentBomId" = $1
            "#,
            document_version_id,
        )
        .map(|r| r.sha)
        .fetch_all(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_document_shas_by_document_id(
        &self,
        document_id: &str,
    ) -> Result<Vec<String>, Self::Err> {
        sqlx::query!(
            r#"
            SELECT bp.sha
            FROM "BomPart" bp
            JOIN "DocumentBom" db ON bp."documentBomId" = db.id
            WHERE db."documentId" = $1
            AND db.id = (
                SELECT db_inner.id
                FROM "DocumentBom" db_inner
                WHERE db_inner."documentId" = $1
                ORDER BY db_inner."updatedAt" DESC
                LIMIT 1
            )
            "#,
            document_id,
        )
        .map(|r| r.sha)
        .fetch_all(&self.pool)
        .await
    }
}
