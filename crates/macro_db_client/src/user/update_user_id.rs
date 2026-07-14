#[tracing::instrument(skip(db))]
pub async fn update_legacy_user_id(
    db: &sqlx::PgPool,
    legacy_user_id: &str,
    new_user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            UPDATE "User"
            SET id = $1
            WHERE id = $2
        "#,
        new_user_id,
        legacy_user_id
    )
    .execute(db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn get_legacy_users(db: &sqlx::PgPool) -> anyhow::Result<Vec<(String, String, i64)>> {
    let result = sqlx::query!(
        r#"
        SELECT
            u.id AS user_id,
            u.email,
            COUNT(d.id) AS document_count
        FROM
            "User" u
        LEFT JOIN
            "Document" d ON u.id = d.owner AND d."fileType" IS DISTINCT FROM 'docx'
        WHERE
            u.id NOT LIKE 'macro|%'
        GROUP BY
            u.id, u.email
        ORDER BY
            document_count DESC;
        "#,
    )
    .map(|row| (row.user_id, row.email, row.document_count.unwrap_or(0)))
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("update_legacy_user")))]
    async fn test_update_legacy_user_simple(pool: Pool<Postgres>) -> anyhow::Result<()> {
        update_legacy_user_id(&pool, "legacy|user2@user.com", "macro|user2@user.com").await?;

        let result = sqlx::query!(
            r#"
            SELECT
                "id"
            FROM "User"
            WHERE "email" = $1
        "#,
            "user2@user.com"
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(result.id, "macro|user2@user.com");
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("update_legacy_user")))]
    async fn test_update_legacy_user_with_documnets(pool: Pool<Postgres>) -> anyhow::Result<()> {
        update_legacy_user_id(&pool, "legacy|user@user.com", "macro|user@user.com").await?;

        let result = sqlx::query!(
            r#"
            SELECT
                "id"
            FROM "User"
            WHERE "email" = $1
        "#,
            "user@user.com"
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(result.id, "macro|user@user.com");
        Ok(())
    }
}
