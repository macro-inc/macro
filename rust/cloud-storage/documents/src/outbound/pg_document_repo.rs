//! PostgreSQL implementation of the [`DocumentRepo`] port.
//!
//! All SQL queries are written directly here (not delegated to `macro_db_client`).

#[cfg(test)]
mod tests;

mod copy;
mod create;
mod edit;
mod share;

use document_sub_type::DocumentSubType;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::document::{DocumentBasic, DocumentMetadata};
use sqlx::PgPool;

use model_entity::{Entity, EntityType};

use crate::domain::models::{
    Comment, CommentThread, CopyDocumentRepoArgs, CreateDocumentRepoArgs, EditDocumentRepoArgs,
    Thread,
};
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

    #[tracing::instrument(err, skip(self))]
    async fn get_document_text(&self, document_id: &str) -> Result<String, Self::Err> {
        let content = sqlx::query!(
            r#"
            SELECT
                d.content
            FROM
                "DocumentText" d
            WHERE
                d."documentId" = $1
            "#,
            document_id
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(content.content)
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn create_document(
        &self,
        args: CreateDocumentRepoArgs,
    ) -> Result<DocumentMetadata, Self::Err> {
        let CreateDocumentRepoArgs {
            id,
            sha,
            document_name,
            user_id,
            file_type,
            project_id,
            email_attachment_id,
            created_at: provided_created_at,
            is_task,
            skip_history,
        } = args;

        let now = chrono::Utc::now();
        let created_at = provided_created_at.as_ref().unwrap_or(&now);

        let mut transaction = self.pool.begin().await?;

        // Fetch project name if project_id provided
        let project_name: Option<String> = if let Some(ref proj_id) = project_id {
            sqlx::query_scalar!(
                r#"SELECT name FROM "Project" WHERE id = $1"#,
                &proj_id.to_string(),
            )
            .fetch_optional(&mut *transaction)
            .await?
        } else {
            None
        };

        let document_id = create::insert_document_row(
            &mut transaction,
            id.as_ref(),
            &user_id,
            &document_name,
            file_type,
            project_id.as_ref(),
            created_at,
        )
        .await?;

        // Insert document sub-type
        let sub_type: Option<DocumentSubType> =
            create::set_document_sub_type(&mut transaction, &document_id, is_task).await?;

        // Insert document version (DocumentBom for docx, DocumentInstance for others)
        let document_version = create::set_document_version(
            &mut transaction,
            &document_id,
            file_type,
            sha,
            created_at,
        )
        .await?;

        // Create share permission
        create::set_share_permission(&mut transaction, &document_id, file_type).await?;

        // Add to user history (if not skipped)
        if !skip_history {
            create::insert_history(&mut transaction, &document_id, &user_id, created_at).await?;
        }

        // Insert user entity access (Owner level)
        entity_access_db_utils::insert_entity_access_row(
            &mut transaction,
            &document_id,
            entity_access_db_utils::EntityType::Document,
            user_id.as_ref(),
            entity_access_db_utils::EntityAccessSourceType::User,
            entity_access_db_utils::AccessLevel::Owner,
        )
        .await?;

        // Link to email attachment if provided
        if let Some(attachment_id) = email_attachment_id {
            sqlx::query!(
                r#"
                INSERT INTO "document_email" (document_id, email_attachment_id)
                VALUES ($1, $2)
                "#,
                &document_id.to_string(),
                attachment_id,
            )
            .execute(&mut *transaction)
            .await?;
        }

        transaction.commit().await?;

        Ok(DocumentMetadata::new_document(
            &document_id.to_string(),
            document_version.id,
            user_id,
            &document_name,
            file_type,
            &document_version.sha,
            None,
            None,
            None,
            project_id.map(|s| s.to_string()).as_deref(),
            project_name.as_deref(),
            document_version.created_at,
            document_version.updated_at,
            sub_type,
        ))
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn edit_document(&self, args: EditDocumentRepoArgs) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;

        use crate::domain::models::FileTypeUpdate;
        let file_type_db = args.file_type.map(|update| match update {
            FileTypeUpdate::Set(ft) => Some(ft.to_string()),
            FileTypeUpdate::Clear => None,
        });

        edit::update_document_metadata(
            &mut transaction,
            &args.document_id,
            args.document_name.as_deref(),
            args.project_id.as_deref(),
            file_type_db,
        )
        .await?;

        if let Some(ref share_permission) = args.share_permission {
            edit::update_share_permission(&mut transaction, &args.document_id, share_permission)
                .await?;
        }

        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn update_upload_job(&self, document_id: &str, job_id: &str) -> Result<(), Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE "UploadJob" SET "documentId" = $1 WHERE "jobId" = $2
            "#,
            document_id,
            job_id,
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn update_project_modified(&self, project_id: &str) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE "Project" SET "updatedAt" = NOW() WHERE id = $1"#,
            project_id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_document_by_id(&self, document_id: &str) -> Result<(), Self::Err> {
        sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document_id,)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn share_with_team(&self, user_id: &str, document_id: &str) -> Result<(), Self::Err> {
        share::share_with_team(&self.pool, user_id, document_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_document_metadata_at_version(
        &self,
        document_id: &str,
        version_id: i64,
    ) -> Result<DocumentMetadata, Self::Err> {
        sqlx::query!(
            r#"
            SELECT
                d.id as "document_id",
                d.owner as "owner",
                d.name as "document_name",
                COALESCE(di.id, db.id) as "document_version_id!",
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
                AND
                    i.id = $2
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
                AND
                    b.id = $2
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
            version_id,
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
    async fn get_project_owner(
        &self,
        project_id: &str,
    ) -> Result<MacroUserIdStr<'static>, Self::Err> {
        let row = sqlx::query!(
            r#"SELECT "userId" as user_id FROM "Project" WHERE id = $1"#,
            project_id,
        )
        .fetch_one(&self.pool)
        .await?;

        MacroUserIdStr::parse_from_str(&row.user_id)
            .map(|u| u.into_owned())
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_name(&self, project_id: &str) -> Result<String, Self::Err> {
        let row = sqlx::query!(r#"SELECT name FROM "Project" WHERE id = $1"#, project_id,)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.name)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_children(
        &self,
        project_id: &str,
    ) -> Result<Vec<Entity<'static>>, Self::Err> {
        let documents = sqlx::query!(
            r#"SELECT id FROM "Document" WHERE "projectId" = $1 AND "deletedAt" IS NULL"#,
            project_id,
        )
        .fetch_all(&self.pool)
        .await?;

        let sub_projects = sqlx::query!(
            r#"SELECT id FROM "Project" WHERE "parentId" = $1 AND "deletedAt" IS NULL"#,
            project_id,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut children: Vec<Entity<'static>> =
            Vec::with_capacity(documents.len() + sub_projects.len());
        for row in documents {
            children.push(EntityType::Document.with_entity_string(row.id));
        }
        for row in sub_projects {
            children.push(EntityType::Project.with_entity_string(row.id));
        }
        Ok(children)
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn copy_document(
        &self,
        args: CopyDocumentRepoArgs,
    ) -> Result<DocumentMetadata, Self::Err> {
        let CopyDocumentRepoArgs {
            original_document,
            user_id,
            document_name,
            file_type,
        } = args;

        let mut transaction = self.pool.begin().await?;

        let document = match file_type {
            Some(model::document::FileType::Docx) => {
                copy::copy_docx_document(
                    &mut transaction,
                    &original_document,
                    user_id.clone(),
                    &document_name,
                )
                .await
            }
            _ => {
                copy::copy_non_docx_document(
                    &mut transaction,
                    &original_document,
                    user_id.clone(),
                    &document_name,
                )
                .await
            }
        }?;

        let document_id = uuid::Uuid::parse_str(&document.document_id)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

        // Create share permission
        create::set_share_permission(&mut transaction, &document_id, file_type).await?;

        // Insert user entity access (Owner level)

        // Insert user entity access (Owner level)
        entity_access_db_utils::insert_entity_access_row(
            &mut transaction,
            &document_id,
            entity_access_db_utils::EntityType::Document,
            user_id.as_ref(),
            entity_access_db_utils::EntityAccessSourceType::User,
            entity_access_db_utils::AccessLevel::Owner,
        )
        .await?;

        // Insert user history
        let now = chrono::Utc::now();
        create::insert_history(&mut transaction, &document_id, &user_id, &now).await?;

        transaction.commit().await?;

        Ok(document)
    }

    #[tracing::instrument(err, skip(self))]
    async fn copy_pdf_parts(
        &self,
        new_document_id: &str,
        original_document_id: &str,
    ) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;
        copy::copy_pdf_parts(&mut transaction, new_document_id, original_document_id).await?;
        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_document_comments(
        &self,
        document_id: &str,
    ) -> Result<Vec<CommentThread>, Self::Err> {
        let threads = sqlx::query!(
            r#"
            SELECT
                t.id as "thread_id!",
                t.resolved as "resolved!",
                t."documentId" as "document_id!",
                t."createdAt"::timestamptz as "created_at",
                t."updatedAt"::timestamptz as "updated_at",
                t."deletedAt"::timestamptz as "deleted_at",
                t.metadata as "metadata",
                t.owner as "owner!"
            FROM "Thread" t
            WHERE t."documentId" = $1 AND t."deletedAt" IS NULL
            "#,
            document_id,
        )
        .map(|row| Thread {
            thread_id: row.thread_id,
            resolved: row.resolved,
            document_id: row.document_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            metadata: row.metadata,
            owner: row.owner,
        })
        .fetch_all(&self.pool)
        .await?;

        let comments = sqlx::query!(
            r#"
            SELECT
                c.id as "comment_id!",
                c."threadId" as "thread_id!",
                c.owner as "owner!",
                c.sender,
                c.text as "text!",
                c.metadata,
                c."createdAt"::timestamptz as "created_at",
                c."updatedAt"::timestamptz as "updated_at",
                c."deletedAt"::timestamptz as "deleted_at",
                c.order
            FROM "Comment" c
            JOIN "Thread" t ON c."threadId" = t.id
            WHERE t."documentId" = $1
                AND t."deletedAt" IS NULL
                AND c."deletedAt" IS NULL
            ORDER BY c."createdAt" ASC
            "#,
            document_id,
        )
        .map(|row| Comment {
            comment_id: row.comment_id,
            thread_id: row.thread_id,
            owner: row.owner,
            sender: row.sender,
            text: row.text,
            metadata: row.metadata,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            order: row.order,
        })
        .fetch_all(&self.pool)
        .await?;

        let mut comments_by_thread: std::collections::HashMap<i64, Vec<Comment>> =
            std::collections::HashMap::new();
        for comment in comments {
            comments_by_thread
                .entry(comment.thread_id)
                .or_default()
                .push(comment);
        }

        let comment_threads = threads
            .into_iter()
            .map(|thread| {
                let thread_comments = comments_by_thread
                    .remove(&thread.thread_id)
                    .unwrap_or_default();
                CommentThread {
                    thread,
                    comments: thread_comments,
                }
            })
            .collect();

        Ok(comment_threads)
    }
}
