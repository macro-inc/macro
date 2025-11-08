use sqlx::{Pool, Postgres};

use model::project::BasicProject;

#[tracing::instrument(skip(db))]
pub async fn get_basic_project(
    db: &Pool<Postgres>,
    project_id: &str,
) -> Result<BasicProject, sqlx::Error> {
    let result = sqlx::query_as!(
        BasicProject,
        r#"
            SELECT
                p.id,
                p."userId" as user_id,
                p."name" as name,
                p."parentId" as parent_id,
                p."deletedAt"::timestamptz as "deleted_at"
            FROM "Project" p
            WHERE id = $1
        "#,
        project_id
    )
    .fetch_one(db)
    .await?;

    Ok(result)
}
