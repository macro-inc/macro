use sqlx::PgPool;

use crate::domain::models::{ProjectItemKind, ProjectTree, ProjectTreeFolder, ProjectTreeItem};

pub(super) async fn get_project_tree(
    pool: &PgPool,
    project_id: &str,
    limit: usize,
) -> Result<ProjectTree, sqlx::Error> {
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);

    // No ORDER BY: Postgres stops expanding the recursive query once `limit`
    // rows are fetched, so an oversized tree is never walked in full.
    let mut folders = sqlx::query!(
        r#"
        WITH RECURSIVE folders AS (
            SELECT child.id, child."parentId" AS parent_id, child.name, 1 AS depth
            FROM "Project" child
            WHERE child."parentId" = $1 AND child."deletedAt" IS NULL
            UNION ALL
            SELECT child.id, child."parentId", child.name, folders.depth + 1
            FROM "Project" child
            JOIN folders ON child."parentId" = folders.id
            WHERE child."deletedAt" IS NULL
        )
        SELECT
            id AS "id!",
            parent_id AS "parent_id!",
            name AS "name!",
            depth AS "depth!"
        FROM folders
        LIMIT $2
        "#,
        project_id,
        limit,
    )
    .fetch_all(pool)
    .await?;
    folders.sort_by_key(|folder| folder.depth);
    let folder_ids = folders
        .iter()
        .map(|folder| folder.id.clone())
        .chain([project_id.to_string()])
        .collect::<Vec<_>>();

    let documents = sqlx::query!(
        r#"
        SELECT id, name, "projectId" AS "project_id!"
        FROM "Document"
        WHERE "projectId" = ANY($1) AND "deletedAt" IS NULL
        LIMIT $2
        "#,
        &folder_ids,
        limit,
    )
    .fetch_all(pool)
    .await?;
    let chats = sqlx::query!(
        r#"
        SELECT id, name, "projectId" AS "project_id!"
        FROM "Chat"
        WHERE "projectId" = ANY($1) AND "deletedAt" IS NULL
        LIMIT $2
        "#,
        &folder_ids,
        limit,
    )
    .fetch_all(pool)
    .await?;

    let items = documents
        .into_iter()
        .map(|row| ProjectTreeItem {
            kind: ProjectItemKind::Document,
            id: row.id,
            project_id: row.project_id,
            name: row.name,
        })
        .chain(chats.into_iter().map(|row| ProjectTreeItem {
            kind: ProjectItemKind::Chat,
            id: row.id,
            project_id: row.project_id,
            name: row.name,
        }))
        .collect();

    Ok(ProjectTree {
        folders: folders
            .into_iter()
            .map(|folder| ProjectTreeFolder {
                id: folder.id,
                parent_id: folder.parent_id,
                name: folder.name,
            })
            .collect(),
        items,
    })
}
