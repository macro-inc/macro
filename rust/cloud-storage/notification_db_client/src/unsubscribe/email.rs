/// Returns a list of whether the given email is unsubscribed from notifications
/// Make sure all emails are lowercased before calling this function
#[tracing::instrument(skip(db))]
pub async fn is_email_unsubscribed_batch(
    db: &sqlx::Pool<sqlx::Postgres>,
    emails: &[String],
) -> anyhow::Result<Vec<(String, bool)>> {
    let result: Vec<(String, bool)> = sqlx::query!(
        r#"
        SELECT t.email as "email!", 
               EXISTS(SELECT 1 FROM notification_email_unsubscribe u WHERE u.email = t.email) as "is_unsubscribed!"
        FROM UNNEST($1::text[]) AS t(email)
        "#,
        emails
    )
    .map(|row| (row.email, row.is_unsubscribed))
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Upserts the given email into the notification_email_unsubscribe table
/// This will forcefully set the email to be lowercased before insertion
#[tracing::instrument(skip(db))]
pub async fn upsert_email_unsubscribe(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO notification_email_unsubscribe (email) VALUES ($1)
        ON CONFLICT (email) DO NOTHING
        "#,
        email.to_lowercase()
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Removes the given email from the notification_email_unsubscribe table
/// This will forcefully set the email to be lowercased before removal
#[tracing::instrument(skip(db))]
pub async fn remove_email_unsubscribe(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM notification_email_unsubscribe WHERE email = $1
        "#,
        email.to_lowercase()
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[sqlx::test(fixtures(path = "../../fixtures", scripts("email_unsubscribe_list")))]
    async fn test_is_email_unsubscribed_batch(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let result = is_email_unsubscribed_batch(
            &pool,
            &[
                "a".to_string(),
                "b".to_string(),
                "d".to_string(),
                "e".to_string(),
            ],
        )
        .await?;

        assert_eq!(
            result,
            vec![
                ("a".to_string(), true),
                ("b".to_string(), true),
                ("d".to_string(), false),
                ("e".to_string(), false),
            ]
        );
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("email_unsubscribe_list")))]
    async fn test_upsert_email_unsubscribe(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        upsert_email_unsubscribe(&pool, "A").await?;
        upsert_email_unsubscribe(&pool, "NeW").await?;
        let result = sqlx::query!(
            r#"
            SELECT email FROM notification_email_unsubscribe WHERE email = 'new'
            "#,
        )
        .fetch_optional(&pool)
        .await?;

        assert!(result.is_some());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("email_unsubscribe_list")))]
    async fn test_remove_email_unsubscribe(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        remove_email_unsubscribe(&pool, "A").await?;
        let result = sqlx::query!(
            r#"
            SELECT email FROM notification_email_unsubscribe WHERE email = 'a'
            "#,
        )
        .fetch_optional(&pool)
        .await?;

        assert!(result.is_none());

        Ok(())
    }
}
