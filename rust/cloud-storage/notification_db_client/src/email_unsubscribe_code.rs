/// Upserts the given email/code into the email_unsubscribe_code table
/// This will forcefully set the email to be lowercased before insertion
/// Returns the code that was generated
#[tracing::instrument(skip(db))]
pub async fn upsert_email_unsubscribe_code(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> anyhow::Result<String> {
    let code = macro_uuid::generate_uuid_v7();
    let code = sqlx::query!(
        r#"
        INSERT INTO email_unsubscribe_code (email, code) VALUES ($1, $2)
        ON CONFLICT (email) DO UPDATE 
        SET code = email_unsubscribe_code.code
        RETURNING email_unsubscribe_code.code
        "#,
        email.to_lowercase(),
        code
    )
    .map(|row| row.code)
    .fetch_one(db)
    .await?;

    Ok(code.to_string())
}

/// Get email by code
#[tracing::instrument(skip(db))]
pub async fn get_email_by_code(
    db: &sqlx::Pool<sqlx::Postgres>,
    code: &str,
) -> anyhow::Result<Option<String>> {
    let email = sqlx::query!(
        r#"
        SELECT email FROM email_unsubscribe_code WHERE code = $1
        "#,
        macro_uuid::string_to_uuid(code)?
    )
    .map(|row| row.email)
    .fetch_optional(db)
    .await?;

    Ok(email)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test]
    async fn test_upsert_email_unsubscribe_code(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let code = macro_uuid::generate_uuid_v7();

        sqlx::query!(
            r#"
            INSERT INTO email_unsubscribe_code(email, code)
            VALUES ($1, $2)
            "#,
            "a",
            code,
        )
        .execute(&pool)
        .await?;

        let result = upsert_email_unsubscribe_code(&pool, "A").await?;

        assert_eq!(result, code.to_string());

        let result = upsert_email_unsubscribe_code(&pool, "b").await?;

        assert_ne!(result, code.to_string());

        Ok(())
    }

    #[sqlx::test]
    async fn test_get_email_by_code(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        let code = macro_uuid::generate_uuid_v7();

        sqlx::query!(
            r#"
            INSERT INTO email_unsubscribe_code(email, code)
            VALUES ($1, $2)
            "#,
            "a",
            code,
        )
        .execute(&pool)
        .await?;

        let result = get_email_by_code(&pool, &code.to_string()).await?;

        assert_eq!(result, Some("a".to_string()));

        Ok(())
    }
}
