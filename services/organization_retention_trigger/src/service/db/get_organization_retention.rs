pub async fn get_organization_retention(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<Vec<(i32, i32)>> {
    let result = sqlx::query!(
        r#"
            SELECT
                organization_id,
                retention_days
            FROM
                "OrganizationRetentionPolicy"
        "#,
    )
    .map(|row| (row.organization_id, row.retention_days))
    .fetch_all(&pool)
    .await?;

    let result = result
        .into_iter()
        .filter_map(|(organization_id, retention_days)| {
            retention_days.map(|retention_days| (organization_id, retention_days))
        })
        .collect::<Vec<(i32, i32)>>();

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("testing")))]
    async fn test_soft_delete_documents(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        let result = get_organization_retention(pool.clone()).await?;

        assert_eq!(result.len(), 1);
        assert_eq!(result[0], (1, 30));

        Ok(())
    }
}
