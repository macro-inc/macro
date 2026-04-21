//! Queries for the `mobile_welcome_email` table.

/// Checks if a mobile welcome email has already been sent to the given email address.
#[tracing::instrument(skip(db), err)]
pub async fn get_mobile_welcome_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> anyhow::Result<bool> {
    let email = email.to_lowercase();

    let exists = sqlx::query!(
        r#"
            SELECT email
            FROM mobile_welcome_email
            WHERE email = $1
        "#,
        &email
    )
    .fetch_optional(db)
    .await?;

    Ok(exists.is_some())
}

/// Inserts a record indicating a mobile welcome email was sent.
/// Returns `true` if a new row was inserted, `false` if the email already existed.
#[tracing::instrument(skip(db), err)]
pub async fn insert_mobile_welcome_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> anyhow::Result<bool> {
    let email = email.to_lowercase();

    let result = sqlx::query!(
        r#"
            INSERT INTO mobile_welcome_email (email)
            VALUES ($1)
            ON CONFLICT (email) DO NOTHING
        "#,
        &email
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod test;
