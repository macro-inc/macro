/// Gets all sub-projects of a given list of project IDs.
/// Includes the original project IDs as well.
#[tracing::instrument(skip(db), err)]
pub async fn bulk_get_all_sub_project_ids(
    db: &sqlx::PgPool,
    project_ids: &[String],
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
        project_ids,
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod test;
