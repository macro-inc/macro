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
            SELECT
                p.id as id,
                p.name as name,
                p."userId" as owner,
                p."updatedAt"::timestamptz as "updated_at"
            FROM
                "Project" p
            WHERE
                p."id" = ANY($1)
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
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("project_preview")))]
    async fn test_batch_get_project_preview_v2(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let project_ids = vec![
            "project-one".to_string(),
            "project-two".to_string(),
            "non-existent-proj".to_string(),
        ];

        let results = batch_get_project_preview_v2(&pool, &project_ids).await?;

        assert_eq!(results.len(), 3);

        match &results[0] {
            ProjectPreviewV2::Found(data) => {
                assert_eq!(data.id, "project-one");
                assert_eq!(data.name, "test_project_name");
            }
            _ => panic!("Expected Found variant for project-one"),
        }

        match &results[1] {
            ProjectPreviewV2::Found(data) => {
                assert_eq!(data.id, "project-two");
            }
            _ => panic!("Expected Found variant for project-two"),
        }

        match &results[2] {
            ProjectPreviewV2::DoesNotExist(data) => {
                assert_eq!(data.id, "non-existent-proj");
            }
            _ => panic!("Expected DoesNotExist variant for non-existent-proj"),
        }

        Ok(())
    }
}
