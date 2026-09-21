use model_owner::Owner;
use sqlx::{Pool, Postgres};

use model::project::BasicProject;

#[tracing::instrument(skip(db))]
pub async fn get_basic_project(
    db: &Pool<Postgres>,
    project_id: &str,
) -> Result<BasicProject, sqlx::Error> {
    let result = sqlx::query!(
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
    .try_map(|row| {
        Ok(BasicProject {
            id: row.id,
            user_id: Owner::from_principal_str(&row.user_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
            parent_id: row.parent_id,
            name: row.name,
            deleted_at: row.deleted_at,
        })
    })
    .fetch_one(db)
    .await?;

    Ok(result)
}
