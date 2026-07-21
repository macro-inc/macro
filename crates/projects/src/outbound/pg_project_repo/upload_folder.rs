use std::collections::HashMap;

use async_recursion::async_recursion;
use entity_access_db_utils::{
    AccessLevel, EntityAccessSourceType, EntityType, insert_entity_access_row,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{DocumentMetadata, FileType, FileTypeExt};
use model::folder::{FileSystemNode, FileSystemNodeWithIds, UploadFolderWithIdsResponse};
use model::project::Project;
use models_permissions::share_permission::SharePermissionV2;
use sqlx::{Postgres, Transaction};

use crate::domain::models::{MarkedUploadedTree, UploadFolderRepoArgs};

use super::share;

pub(super) async fn upload_folder(
    transaction: &mut Transaction<'_, Postgres>,
    args: UploadFolderRepoArgs,
) -> Result<UploadFolderWithIdsResponse, sqlx::Error> {
    let root_project = create_pending_project(
        transaction,
        args.user_id.clone(),
        &args.share_permission,
        &args.root_folder_name,
        args.parent_id.as_deref(),
        &args.upload_request_id,
    )
    .await?;

    let FileSystemNode::Folder(root_content) = &args.root_folder else {
        return Err(sqlx::Error::Protocol(
            "expected a folder node, found a file".to_owned(),
        ));
    };

    let mut project_ids = vec![root_project.id.clone()];
    let mut documents = Vec::new();
    let mut extended_content = HashMap::new();
    for (name, node) in root_content {
        let extended_node = traverse_with_ids(
            transaction,
            node,
            args.user_id.clone(),
            &args.share_permission,
            name,
            &root_project,
            &args.upload_request_id,
            &mut project_ids,
            &mut documents,
        )
        .await?;
        extended_content.insert(name.clone(), extended_node);
    }

    insert_tree_history(transaction, args.user_id.as_ref(), &project_ids, &documents).await?;

    Ok(UploadFolderWithIdsResponse {
        file_system: FileSystemNodeWithIds::Folder {
            content: extended_content,
            project_id: root_project.id,
        },
        project_ids,
        documents,
    })
}

#[async_recursion]
#[expect(clippy::too_many_arguments, reason = "recursive tree traversal state")]
async fn traverse_with_ids(
    transaction: &mut Transaction<'_, Postgres>,
    node: &FileSystemNode,
    user_id: MacroUserIdStr<'static>,
    share_permission: &SharePermissionV2,
    name: &str,
    parent_project: &Project,
    upload_request_id: &str,
    project_ids: &mut Vec<String>,
    documents: &mut Vec<DocumentMetadata>,
) -> Result<FileSystemNodeWithIds, sqlx::Error> {
    match node {
        FileSystemNode::File(item) => {
            let document =
                create_empty_document(transaction, user_id, share_permission, item, parent_project)
                    .await?;
            let document_id = document.document_id.clone();
            documents.push(document);
            Ok(FileSystemNodeWithIds::File {
                item: item.clone(),
                document_id,
            })
        }
        FileSystemNode::Folder(content) => {
            let project = create_pending_project(
                transaction,
                user_id.clone(),
                share_permission,
                name,
                Some(&parent_project.id),
                upload_request_id,
            )
            .await?;
            project_ids.push(project.id.clone());

            let mut extended_content = HashMap::new();
            for (child_name, child) in content {
                let extended_node = traverse_with_ids(
                    transaction,
                    child,
                    user_id.clone(),
                    share_permission,
                    child_name,
                    &project,
                    upload_request_id,
                    project_ids,
                    documents,
                )
                .await?;
                extended_content.insert(child_name.clone(), extended_node);
            }
            Ok(FileSystemNodeWithIds::Folder {
                content: extended_content,
                project_id: project.id,
            })
        }
    }
}

async fn create_pending_project(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: MacroUserIdStr<'static>,
    share_permission: &SharePermissionV2,
    name: &str,
    parent_id: Option<&str>,
    upload_request_id: &str,
) -> Result<Project, sqlx::Error> {
    let project = sqlx::query_as!(
        Project,
        r#"
        INSERT INTO "Project"
            (name, "userId", "parentId", "createdAt", "updatedAt", "uploadPending", "uploadRequestId")
        VALUES ($1, $2, $3, NOW(), NOW(), true, $4)
        RETURNING
            id,
            name,
            "userId" AS user_id,
            "parentId" AS parent_id,
            "createdAt"::timestamptz AS created_at,
            "updatedAt"::timestamptz AS updated_at,
            "deletedAt"::timestamptz AS deleted_at
        "#,
        name,
        user_id.as_ref(),
        parent_id,
        upload_request_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    share::create_project_share_permission(transaction, &project.id, share_permission).await?;
    let entity_id = project
        .id
        .parse()
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    insert_entity_access_row(
        transaction,
        &entity_id,
        EntityType::Project,
        user_id.as_ref(),
        EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await?;
    Ok(project)
}

async fn create_empty_document(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: MacroUserIdStr<'static>,
    share_permission: &SharePermissionV2,
    item: &model::folder::FolderItem,
    project: &Project,
) -> Result<DocumentMetadata, sqlx::Error> {
    let document_name =
        FileType::clean_document_name(&item.name).unwrap_or_else(|| item.name.clone());
    let document = sqlx::query!(
        r#"
        INSERT INTO "Document" (owner, name, "fileType", "projectId", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id, "createdAt"::timestamptz AS created_at, "updatedAt"::timestamptz AS updated_at
        "#,
        user_id.as_ref(),
        document_name,
        item.file_type
            .map(|file_type| file_type.as_str().to_owned()),
        project.id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    let (version_id, created_at, updated_at) = if item.file_type == Some(FileType::Docx) {
        let version = sqlx::query!(
            r#"
            INSERT INTO "DocumentBom" ("documentId", "createdAt", "updatedAt")
            VALUES ($1, NOW(), NOW())
            RETURNING id, "createdAt"::timestamptz AS created_at, "updatedAt"::timestamptz AS updated_at
            "#,
            document.id,
        )
        .fetch_one(transaction.as_mut())
        .await?;
        (version.id, version.created_at, version.updated_at)
    } else {
        let version = sqlx::query!(
            r#"
            INSERT INTO "DocumentInstance" ("documentId", sha, "createdAt", "updatedAt")
            VALUES ($1, $2, NOW(), NOW())
            RETURNING id, "createdAt"::timestamptz AS created_at, "updatedAt"::timestamptz AS updated_at
            "#,
            document.id,
            item.sha,
        )
        .fetch_one(transaction.as_mut())
        .await?;
        (version.id, version.created_at, version.updated_at)
    };

    create_document_share_permission(transaction, &document.id, share_permission).await?;
    let entity_id = document
        .id
        .parse()
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    insert_entity_access_row(
        transaction,
        &entity_id,
        EntityType::Document,
        user_id.as_ref(),
        EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await?;

    Ok(DocumentMetadata::new_document(
        &document.id,
        version_id,
        user_id,
        &document_name,
        item.file_type,
        &item.sha,
        None,
        None,
        None,
        Some(&project.id),
        Some(&project.name),
        created_at,
        updated_at,
        None,
    ))
}

async fn create_document_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    document_id: &str,
    permission: &SharePermissionV2,
) -> Result<(), sqlx::Error> {
    let permission_id = sqlx::query_scalar!(
        r#"
        INSERT INTO "SharePermission" ("isPublic", "publicAccessLevel", "createdAt", "updatedAt")
        VALUES ($1, $2, NOW(), NOW())
        RETURNING id
        "#,
        permission.is_public,
        permission
            .public_access_level
            .as_ref()
            .map(ToString::to_string),
    )
    .fetch_one(transaction.as_mut())
    .await?;
    sqlx::query!(
        r#"INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") VALUES ($1, $2)"#,
        document_id,
        permission_id,
    )
    .execute(transaction.as_mut())
    .await?;
    for channel in permission.channel_share_permissions.iter().flatten() {
        sqlx::query!(
            r#"
            INSERT INTO "ChannelSharePermission" (share_permission_id, channel_id, access_level)
            VALUES ($1, $2, $3::text::"AccessLevel")
            "#,
            permission_id,
            channel.channel_id,
            channel.access_level.to_string(),
        )
        .execute(transaction.as_mut())
        .await?;
    }
    Ok(())
}

async fn insert_tree_history(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    project_ids: &[String],
    documents: &[DocumentMetadata],
) -> Result<(), sqlx::Error> {
    let document_ids = documents
        .iter()
        .map(|document| document.document_id.clone())
        .collect::<Vec<_>>();
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT $1, id, 'project', NOW(), NOW() FROM UNNEST($2::text[]) AS id
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE SET "updatedAt" = NOW()
        "#,
        user_id,
        project_ids,
    )
    .execute(transaction.as_mut())
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT $1, id, 'document', NOW(), NOW() FROM UNNEST($2::text[]) AS id
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE SET "updatedAt" = NOW()
        "#,
        user_id,
        &document_ids,
    )
    .execute(transaction.as_mut())
    .await?;
    Ok(())
}

pub(super) async fn mark_projects_uploaded(
    transaction: &mut Transaction<'_, Postgres>,
    root_project_id: &str,
) -> Result<MarkedUploadedTree, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT id FROM "Project" WHERE id = $1
            UNION ALL
            SELECT child.id
            FROM "Project" child
            JOIN project_hierarchy parent ON child."parentId" = parent.id
        ),
        updated_projects AS (
            UPDATE "Project"
            SET "uploadPending" = false
            WHERE id IN (SELECT id FROM project_hierarchy)
              AND "uploadPending" = true
            RETURNING id
        )
        SELECT
            project.id,
            project.name,
            project."userId" AS user_id,
            project."parentId" AS parent_id,
            EXISTS (
                SELECT 1 FROM updated_projects WHERE id = $1
            ) AS "upload_pending_transitioned!"
        FROM "Project" project
        JOIN project_hierarchy hierarchy ON hierarchy.id = project.id
        "#,
        root_project_id,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    if rows.is_empty() {
        return Err(sqlx::Error::RowNotFound);
    }

    let root = rows
        .iter()
        .find(|row| row.id == root_project_id)
        .ok_or_else(|| {
            sqlx::Error::Protocol("updated project tree did not include its root".to_owned())
        })?;
    let user_id = MacroUserIdStr::try_from(root.user_id.clone())
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;

    Ok(MarkedUploadedTree {
        id: root.id.clone(),
        name: root.name.clone(),
        user_id,
        parent_id: root.parent_id.clone(),
        upload_pending_transitioned: root.upload_pending_transitioned,
        project_ids: rows.into_iter().map(|row| row.id).collect(),
    })
}
