#[tracing::instrument(skip(db))]
pub(in crate::service::db) async fn get_sha_count(
    db: sqlx::Pool<sqlx::Postgres>,
    sha: &str,
) -> anyhow::Result<i64> {
    match sqlx::query!(
        r#"
        SELECT COUNT(*) as count
        FROM "BomPart"
        WHERE sha = $1
        "#,
        sha
    )
    .fetch_one(&db)
    .await
    {
        Ok(row) => Ok(row.count.unwrap_or(0)),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("shas")))]
    async fn test_get_sha_count(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        let result = get_sha_count(pool.clone(), "sha-1").await?;
        assert_eq!(result, 2);
        let result = get_sha_count(pool.clone(), "sha-2").await?;
        assert_eq!(result, 2);
        let result = get_sha_count(pool.clone(), "sha-3").await?;
        assert_eq!(result, 1);
        let result = get_sha_count(pool.clone(), "sha-4").await?;
        assert_eq!(result, 1);
        let result = get_sha_count(pool.clone(), "sha-none").await?;
        assert_eq!(result, 0);
        Ok(())
    }
}
