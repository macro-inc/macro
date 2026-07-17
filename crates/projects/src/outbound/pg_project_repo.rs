//! PostgreSQL implementation of the [`ProjectRepo`] port.

mod content;
mod create;
mod delete;
mod edit;
mod revert_delete;
mod share;
mod upload_folder;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::project::{
    BasicProject, Project, ProjectPreviewData, ProjectPreviewV2, ProjectWithUploadRequest,
    WithProjectId,
};
use sqlx::PgPool;

use crate::domain::models::{
    CreateProjectArgs, EditProjectArgs, MarkedUploadedTree, PurgedProjectTree, RevertDeleteResult,
    SoftDeleteResult, UploadFolderRepoArgs,
};
use crate::domain::ports::ProjectRepo;

/// PostgreSQL-backed project repository.
#[derive(Clone)]
pub struct PgProjectRepo {
    pool: PgPool,
}

impl PgProjectRepo {
    /// Create a repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ProjectRepo for PgProjectRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self))]
    async fn get_basic_project(&self, project_id: &str) -> Result<Option<BasicProject>, Self::Err> {
        sqlx::query!(
            r#"
            SELECT
                p.id,
                p."userId" AS "user_id",
                p.name,
                p."parentId" AS "parent_id",
                p."deletedAt"::timestamptz AS "deleted_at"
            FROM "Project" p
            WHERE p.id = $1
            "#,
            project_id,
        )
        .try_map(|row| {
            Ok(BasicProject {
                id: row.id,
                user_id: MacroUserIdStr::parse_from_str(&row.user_id)
                    .map_err(|error| sqlx::Error::Decode(Box::new(error)))?
                    .into_owned(),
                parent_id: row.parent_id,
                name: row.name,
                deleted_at: row.deleted_at,
            })
        })
        .fetch_optional(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_by_id(&self, project_id: &str) -> Result<Option<Project>, Self::Err> {
        sqlx::query_as!(
            Project,
            r#"
            SELECT
                p.id,
                p.name,
                p."userId" AS "user_id",
                p."parentId" AS "parent_id",
                p."createdAt"::timestamptz AS "created_at",
                p."updatedAt"::timestamptz AS "updated_at",
                p."deletedAt"::timestamptz AS "deleted_at"
            FROM "Project" p
            WHERE p.id = $1 AND p."deletedAt" IS NULL
            "#,
            project_id,
        )
        .fetch_optional(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_projects_for_user(&self, user_id: &str) -> Result<Vec<Project>, Self::Err> {
        sqlx::query_as!(
            Project,
            r#"
            SELECT
                p.id,
                p.name,
                p."userId" AS "user_id",
                p."parentId" AS "parent_id",
                p."createdAt"::timestamptz AS "created_at",
                p."updatedAt"::timestamptz AS "updated_at",
                p."deletedAt"::timestamptz AS "deleted_at"
            FROM "UserHistory" history
            INNER JOIN "Project" p
                ON history."itemId" = p.id AND history."itemType" = 'project'
            WHERE history."userId" = $1
                AND p."deletedAt" IS NULL
                AND p."uploadPending" = false
            ORDER BY p."updatedAt" DESC
            "#,
            user_id,
        )
        .fetch_all(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_pending_root_projects(
        &self,
        user_id: &str,
    ) -> Result<Vec<ProjectWithUploadRequest>, Self::Err> {
        sqlx::query!(
            r#"
            SELECT
                p.id,
                p.name,
                p."userId" AS "user_id",
                p."parentId" AS "parent_id",
                p."createdAt"::timestamptz AS "created_at",
                p."updatedAt"::timestamptz AS "updated_at",
                p."uploadRequestId" AS "upload_request_id"
            FROM "Project" p
            WHERE p."userId" = $1
                AND p."deletedAt" IS NULL
                AND p."uploadPending" = true
                AND p."parentId" IS NULL
            ORDER BY p."updatedAt" DESC
            "#,
            user_id,
        )
        .map(|row| ProjectWithUploadRequest {
            project: Project {
                id: row.id,
                name: row.name,
                user_id: row.user_id,
                parent_id: row.parent_id,
                created_at: row.created_at,
                updated_at: row.updated_at,
                deleted_at: None,
            },
            upload_request_id: row.upload_request_id,
        })
        .fetch_all(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_children(
        &self,
        project_id: &str,
    ) -> Result<Vec<model::item::Item>, Self::Err> {
        content::get_project_children(&self.pool, project_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_share_permission(
        &self,
        project_id: &str,
    ) -> Result<models_permissions::share_permission::SharePermissionV2, Self::Err> {
        share::get_project_share_permission(&self.pool, project_id).await
    }

    #[tracing::instrument(err, skip(self, project_ids))]
    async fn batch_get_project_preview(
        &self,
        project_ids: &[String],
    ) -> Result<Vec<ProjectPreviewV2>, Self::Err> {
        let found = sqlx::query_as!(
            ProjectPreviewData,
            r#"
            WITH RECURSIVE project_path AS (
                SELECT
                    p.id,
                    p.name,
                    p."userId",
                    p."parentId",
                    p."updatedAt",
                    ARRAY[p.name] AS path
                FROM "Project" p
                WHERE p.id = ANY($1)

                UNION ALL

                SELECT
                    child.id,
                    child.name,
                    child."userId",
                    parent."parentId",
                    child."updatedAt",
                    ARRAY[parent.name] || child.path AS path
                FROM project_path child
                JOIN "Project" parent ON child."parentId" = parent.id
            )
            SELECT DISTINCT ON (id)
                id AS "id!",
                name AS "name!",
                "userId" AS "owner!",
                path AS "path!",
                "updatedAt"::timestamptz AS "updated_at"
            FROM project_path
            WHERE "parentId" IS NULL
            ORDER BY id
            "#,
            project_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        let found_by_id: HashMap<&str, &ProjectPreviewData> = found
            .iter()
            .map(|project| (project.id.as_str(), project))
            .collect();
        Ok(project_ids
            .iter()
            .map(|id| match found_by_id.get(id.as_str()) {
                Some(project) => ProjectPreviewV2::Found((*project).clone()),
                None => ProjectPreviewV2::DoesNotExist(WithProjectId { id: id.clone() }),
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn create_project(&self, args: CreateProjectArgs) -> Result<Project, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let project = create::create_project(&mut transaction, &args).await?;
        transaction.commit().await?;
        Ok(project)
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn edit_project(&self, args: EditProjectArgs) -> Result<Project, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let project = edit::edit_project(&mut transaction, &args).await?;
        transaction.commit().await?;
        Ok(project)
    }

    #[tracing::instrument(err, skip(self))]
    async fn is_project_recursively_nested(
        &self,
        project_id: &str,
        parent_id: &str,
    ) -> Result<bool, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        edit::is_project_recursively_nested(&mut transaction, project_id, parent_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn soft_delete_project(&self, project_id: &str) -> Result<SoftDeleteResult, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let result = delete::soft_delete_project(&mut transaction, project_id).await?;
        transaction.commit().await?;
        Ok(result)
    }

    #[tracing::instrument(err, skip(self))]
    async fn purge_deleted_project_tree(
        &self,
        project_id: &str,
    ) -> Result<PurgedProjectTree, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let result = delete::purge_deleted_project_tree(&mut transaction, project_id).await?;
        transaction.commit().await?;
        Ok(result)
    }

    #[tracing::instrument(err, skip(self))]
    async fn revert_delete_project(
        &self,
        project_id: &str,
        previous_parent_id: Option<String>,
    ) -> Result<RevertDeleteResult, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let result = revert_delete::revert_delete_project(
            &mut transaction,
            project_id,
            previous_parent_id.as_deref(),
        )
        .await?;
        transaction.commit().await?;
        Ok(result)
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn upload_folder(
        &self,
        args: UploadFolderRepoArgs,
    ) -> Result<model::folder::UploadFolderWithIdsResponse, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let result = upload_folder::upload_folder(&mut transaction, args).await?;
        transaction.commit().await?;
        Ok(result)
    }

    #[tracing::instrument(err, skip(self, project_ids, document_ids))]
    async fn delete_uploaded_tree(
        &self,
        project_ids: &[String],
        document_ids: &[String],
    ) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;
        delete::delete_uploaded_tree(&mut transaction, project_ids, document_ids).await?;
        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn mark_projects_uploaded(
        &self,
        root_project_id: &str,
    ) -> Result<MarkedUploadedTree, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let uploaded_tree =
            upload_folder::mark_projects_uploaded(&mut transaction, root_project_id).await?;
        transaction.commit().await?;
        Ok(uploaded_tree)
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
}
