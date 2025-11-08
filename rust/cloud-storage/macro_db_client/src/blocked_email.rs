/// Upserts a blocked emails in bulk into the database
/// Automatically handles lowercase conversion
#[tracing::instrument(skip(db))]
pub async fn bulk_upsert_block_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    emails: &[impl ToString + std::fmt::Debug],
) -> anyhow::Result<()> {
    let emails = emails
        .iter()
        .map(|email| email.to_string().to_lowercase())
        .collect::<Vec<_>>();

    sqlx::query!(
        r#"
            INSERT INTO "BlockedEmail" (email)
            SELECT email FROM unnest($1::text[]) AS email
            ON CONFLICT (email) DO NOTHING
        "#,
        &emails
    )
    .execute(db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn upsert_block_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: impl ToString + std::fmt::Debug,
) -> anyhow::Result<()> {
    let email = email.to_string().to_lowercase();
    sqlx::query!(
        r#"
            INSERT INTO "BlockedEmail" (email)
            VALUES ($1)
            ON CONFLICT (email) DO NOTHING
        "#,
        &email
    )
    .execute(db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn get_blocked_emails(
    db: &sqlx::Pool<sqlx::Postgres>,
    emails: &[impl ToString + std::fmt::Debug],
) -> anyhow::Result<Vec<String>> {
    let emails = emails
        .iter()
        .map(|email| email.to_string().to_lowercase())
        .collect::<Vec<_>>();

    let blocked_emails = sqlx::query!(
        r#"
            SELECT email
            FROM "BlockedEmail"
            WHERE email = ANY($1::text[])
        "#,
        &emails
    )
    .map(|row| row.email)
    .fetch_all(db)
    .await?;

    Ok(blocked_emails)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test]
    async fn test_bulk_upsert_block_email(pool: Pool<Postgres>) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO "BlockedEmail" (email)
            VALUES ('test@test.com')
        "#
        )
        .execute(&pool)
        .await?;

        bulk_upsert_block_email(&pool, &["TeSt@test.com", "random@random.com"]).await?;

        let blocked_emails =
            get_blocked_emails(&pool, &["TeSt@test.com", "random@random.com", "bad"]).await?;
        assert_eq!(blocked_emails.len(), 2);

        assert_eq!(blocked_emails[0], "test@test.com");
        assert_eq!(blocked_emails[1], "random@random.com");

        Ok(())
    }

    #[sqlx::test]
    async fn test_upsert_block_email(pool: Pool<Postgres>) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO "BlockedEmail" (email)
            VALUES ('test@test.com')
        "#
        )
        .execute(&pool)
        .await?;

        // Should handle conflict
        upsert_block_email(&pool, "TeST@test.com").await?;

        Ok(())
    }

    #[sqlx::test]
    async fn test_get_blocked_emails(pool: Pool<Postgres>) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO "BlockedEmail" (email)
            VALUES ('test@test.com')
        "#
        )
        .execute(&pool)
        .await?;

        let blocked_emails =
            get_blocked_emails(&pool, &["TeSt@test.com", "random@random.com"]).await?;
        assert_eq!(blocked_emails.len(), 1);

        assert_eq!(blocked_emails[0], "test@test.com");

        Ok(())
    }
}
