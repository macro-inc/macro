use model::{chat::Chat, document::BasicDocument, project::Project};

/// Gets all deleted sub-projects of a given project.
/// Includes the root project itself as well.
/// Returns the id and the owner of the project
#[tracing::instrument(skip(transaction))]
pub async fn get_all_deleted_sub_project_ids(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    project_id: &str,
) -> anyhow::Result<Vec<(String, String)>> {
    // Get all items (documents, chats, compare, sub-projects for a given project id)
    let result = sqlx::query!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT
                p.id,
                p."userId" as user_id
            FROM "Project" p
            WHERE p.id = $1 AND p."deletedAt" IS NOT NULL
            UNION ALL
            SELECT
                sub_p.id,
                sub_p."userId" as user_id
            FROM "Project" sub_p
            INNER JOIN project_hierarchy ph ON sub_p."parentId" = ph.id
            WHERE sub_p."deletedAt" IS NOT NULL
        )
        SELECT
            ph.id as "id!",
            ph.user_id as "user_id!"
        FROM project_hierarchy ph
        "#,
        project_id,
    )
    .map(|r| (r.id, r.user_id))
    .fetch_all(transaction.as_mut())
    .await?;

    Ok(result)
}

/// Gets all projects inside of a project.
#[tracing::instrument(skip(transaction))]
pub async fn get_sub_projects(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    project_id: &str,
) -> anyhow::Result<Vec<Project>> {
    let projects: Vec<Project> = sqlx::query_as!(
        Project,
        r#"
            SELECT
                p.id as id,
                p.name,
                p."userId" as user_id,
                p."parentId" as "parent_id?",
                p."createdAt"::timestamptz as created_at,
                p."updatedAt"::timestamptz as updated_at,
                p."deletedAt"::timestamptz as deleted_at
            FROM
                "Project" p
            WHERE p."parentId" = $1 AND p."deletedAt" IS NULL
        "#,
        project_id,
    )
    .fetch_all(transaction.as_mut())
    .await?;

    Ok(projects)
}

/// Gets the documents for a given project.
#[tracing::instrument(skip(transaction))]
pub async fn get_sub_documents(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    project_id: &str,
) -> anyhow::Result<Vec<BasicDocument>> {
    let documents: Vec<BasicDocument> = sqlx::query!(
        r#"
            SELECT
                d.id as document_id,
                d.owner as owner,
                d.name as document_name,
                COALESCE(db.id, di.id) as "document_version_id!",
                d."fileType" as "file_type?",
                d."createdAt"::timestamptz as created_at,
                d."updatedAt"::timestamptz as updated_at,
                d."projectId" as "project_id?"
            FROM
                "Document" d
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
                    i.id,
                    i."documentId",
                    i."createdAt",
                    i."updatedAt"
                FROM
                    "DocumentInstance" i
                WHERE
                    i."documentId" = d.id
                ORDER BY
                    i."updatedAt" DESC
                LIMIT 1
            ) di ON d."fileType" IS DISTINCT FROM 'docx'
            WHERE d."projectId" = $1 AND d."deletedAt" IS NULL
        "#,
        project_id,
    )
    .map(|row| {
        BasicDocument {
            document_id: row.document_id,
            document_name: row.document_name,
            document_version_id: row.document_version_id,
            owner: row.owner,
            file_type: row.file_type,
            project_id: row.project_id,
            sha: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: None, // Don't care about the deleted_at
        }
    })
    .fetch_all(transaction.as_mut())
    .await?;

    Ok(documents)
}

/// Gets the chats for a given project.
#[tracing::instrument(skip(transaction))]
pub async fn get_sub_chats(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    project_id: &str,
) -> anyhow::Result<Vec<Chat>> {
    let chats: Vec<Chat> = sqlx::query_as!(
        Chat,
        r#"
            SELECT
                c.id as id,
                c.name as name,
                c."userId" as user_id,
                c.model as "model?",
                c."projectId" as "project_id?",
                c."tokenCount" as token_count,
                c."createdAt"::timestamptz as created_at,
                c."updatedAt"::timestamptz as updated_at,
                c."deletedAt"::timestamptz as deleted_at,
                c."isPersistent" as is_persistent
            FROM
                "Chat" c
            WHERE c."projectId" = $1 AND c."deletedAt" IS NULL
        "#,
        project_id,
    )
    .fetch_all(transaction.as_mut())
    .await?;

    Ok(chats)
}

/// Gets all sub-projects of a given list of project ids.
/// Includes the original project ids as well.
#[tracing::instrument(skip(db), err)]
pub async fn bulk_get_all_sub_project_ids(
    db: &sqlx::PgPool,
    project_id: &[String],
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT
                p.id
            FROM "Project" p
            WHERE p.id = ANY($1) AND p."deletedAt" IS NULL
            UNION ALL
            SELECT
                sub_p.id
            FROM "Project" sub_p
            INNER JOIN project_hierarchy ph ON sub_p."parentId" = ph.id
            WHERE sub_p."deletedAt" IS NULL
        )
        SELECT
            ph.id as "id!"
        FROM project_hierarchy ph
        "#,
        &project_id,
    )
    .map(|r| r.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Gets all sub-projects of a given project.
/// Includes the root project itself as well.
#[tracing::instrument(skip(transaction))]
pub async fn get_all_sub_project_ids(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    project_id: &str,
) -> anyhow::Result<Vec<String>> {
    // Get all items (documents, chats, compare, sub-projects for a given project id)
    let result = sqlx::query!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT
                p.id
            FROM "Project" p
            WHERE p.id = $1 AND p."deletedAt" IS NULL
            UNION ALL
            SELECT
                sub_p.id
            FROM "Project" sub_p
            INNER JOIN project_hierarchy ph ON sub_p."parentId" = ph.id
            WHERE sub_p."deletedAt" IS NULL
        )
        SELECT
            ph.id as "id!"
        FROM project_hierarchy ph
        "#,
        project_id,
    )
    .map(|r| r.id)
    .fetch_all(transaction.as_mut())
    .await?;

    Ok(result)
}

#[tracing::instrument(skip(transaction))]
pub async fn get_projects_document_ids(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    project_ids: &Vec<String>,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT
            d.id
        FROM
            "Document" d
        WHERE
            d."projectId" = ANY($1::text[])
        "#,
        project_ids
    )
    .fetch_all(transaction.as_mut())
    .await?;

    Ok(result.iter().map(|r| r.id.clone()).collect())
}

#[cfg(test)]
mod test;
