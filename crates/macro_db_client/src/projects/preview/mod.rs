use std::collections::HashSet;

use model::project::{ProjectPreviewData, ProjectPreviewV2, WithProjectId};

#[tracing::instrument(skip(db))]
pub async fn batch_get_project_preview_v2(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_ids: &[String],
) -> anyhow::Result<Vec<ProjectPreviewV2>> {
    let found_documents: Vec<ProjectPreviewData> = sqlx::query_as!(
        ProjectPreviewData,
        r#"
            WITH RECURSIVE project_path AS (
                SELECT
                    p.id,
                    p.name,
                    p."userId",
                    p."parentId",
                    p."updatedAt",
                    ARRAY[p.name] as path
                FROM "Project" p
                WHERE p.id = ANY($1)

                UNION ALL

                SELECT
                    pp.id,
                    pp.name,
                    pp."userId",
                    parent."parentId",
                    pp."updatedAt",
                    ARRAY[parent.name] || pp.path as path
                FROM project_path pp
                JOIN "Project" parent ON pp."parentId" = parent.id
            )
            SELECT DISTINCT ON (id)
                id as "id!",
                name as "name!",
                "userId" as "owner!",
                path as "path!",
                "updatedAt"::timestamptz as "updated_at"
            FROM project_path
            WHERE "parentId" IS NULL
            ORDER BY id
        "#,
        project_ids,
    )
    .fetch_all(db)
    .await?;

    let found_projects: HashSet<String> =
        found_documents.iter().map(|row| row.id.clone()).collect();

    let result: Vec<ProjectPreviewV2> = project_ids
        .iter()
        .map(|id| {
            if !found_projects.contains(id) {
                ProjectPreviewV2::DoesNotExist(WithProjectId { id: id.clone() })
            } else {
                let row = found_documents.iter().find(|r| r.id == *id).unwrap();

                ProjectPreviewV2::Found(row.clone())
            }
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod test;
