use uuid::Uuid;

/// Gets the merge request macro user id by code
/// Returns the merge request id and the to_merge_macro_user_id
#[tracing::instrument(skip(db))]
pub async fn get_merge_request_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_user_id: &str,
    code: &str,
) -> anyhow::Result<(String, String)> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;

    let merge_request = sqlx::query!(
        r#"
        SELECT
            "id" as "merge_request_id!",
            "to_merge_macro_user_id" as "to_merge_macro_user_id!"
        FROM "account_merge_request"
        WHERE "code" = $1 AND "macro_user_id" = $2
        "#,
        code,
        &macro_user_id
    )
    .map(|row| {
        (
            row.merge_request_id.to_string(),
            row.to_merge_macro_user_id.to_string(),
        )
    })
    .fetch_one(db)
    .await?;

    Ok(merge_request)
}

/// Checks if there is an account merge request for the given macro user id
#[tracing::instrument(skip(db))]
pub async fn check_merge_request_for_to_merge_macro_user_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_user_id: &str,
) -> anyhow::Result<Option<Uuid>> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    let merge_request: Option<Uuid> = sqlx::query!(
        r#"
        SELECT
            id
        FROM account_merge_request
        WHERE to_merge_macro_user_id = $1
        "#,
        &macro_user_id,
    )
    .map(|row| row.id)
    .fetch_optional(db)
    .await?;

    Ok(merge_request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test]
    async fn test_get_merge_request_info(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // create macro user
        sqlx::query!(
            r#"
            INSERT INTO "macro_user" ("id", "email", "stripe_customer_id", "username")
            VALUES ($1, $2, $3, $4)
        "#,
            &macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?,
            "test@macro.com",
            "cus_123",
            "u1",
        )
        .execute(&pool)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO "macro_user" ("id", "email", "stripe_customer_id", "username")
            VALUES ($1, $2, $3, $4)
        "#,
            &macro_uuid::string_to_uuid("22222222-2222-2222-2222-222222222222")?,
            "test2@macro.com",
            "cus_124",
            "u2",
        )
        .execute(&pool)
        .await?;

        // does not exist
        let err = get_merge_request_info(&pool, "11111111-1111-1111-1111-111111111111", "bad")
            .await
            .err()
            .unwrap();

        assert_eq!(
            err.to_string(),
            "no rows returned by a query that expected to return at least one row".to_string()
        );

        sqlx::query!(
            r#"
            INSERT INTO "account_merge_request" ("id", "macro_user_id", "to_merge_macro_user_id", "code", "created_at")
            VALUES ($1, $2, $3, $4, NOW())
            "#,
            &macro_uuid::string_to_uuid("33333333-3333-3333-3333-333333333333")?,
            &macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?,
            &macro_uuid::string_to_uuid("22222222-2222-2222-2222-222222222222")?,
            "code-one"
        ).execute(&pool).await?;

        // exists
        let merge_request_info =
            get_merge_request_info(&pool, "11111111-1111-1111-1111-111111111111", "code-one")
                .await
                .unwrap();

        assert_eq!(
            merge_request_info,
            (
                "33333333-3333-3333-3333-333333333333".to_string(),
                "22222222-2222-2222-2222-222222222222".to_string()
            )
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("account_merge_request")))]
    pub async fn test_check_merge_request_for_to_merge_macro_user_id(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let merge_request_id = macro_uuid::generate_uuid_v7();
        let to_merge_macro_user_id = macro_uuid::generate_uuid_v7();

        sqlx::query!(
            r#"
            INSERT INTO "account_merge_request" ("id", "macro_user_id", "to_merge_macro_user_id", "code", "created_at")
            VALUES ($1, $2, $3, $4, NOW())
            "#,
            &merge_request_id,
            &macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?,
            &to_merge_macro_user_id,
            "code-one"
        )
        .execute(&pool)
        .await?;

        // Exists
        let merge_request = check_merge_request_for_to_merge_macro_user_id(
            &pool,
            &to_merge_macro_user_id.to_string(),
        )
        .await?;

        assert_eq!(merge_request, Some(merge_request_id));

        // Does not exist
        let merge_request = check_merge_request_for_to_merge_macro_user_id(
            &pool,
            &macro_uuid::generate_uuid_v7().to_string(),
        )
        .await?;

        assert_eq!(merge_request, None);

        Ok(())
    }
}
