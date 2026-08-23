/// Creates a new macro user in the database
#[tracing::instrument(skip(transaction))]
pub async fn create_macro_user(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    fusionauth_user_id: &str,
    username: &str,
    stripe_customer_id: &str,
    email: &str,
) -> anyhow::Result<()> {
    let fusionauth_user_id = macro_uuid::string_to_uuid(fusionauth_user_id)?;

    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, stripe_customer_id, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("id") DO NOTHING
        "#,
        &fusionauth_user_id,
        username,
        stripe_customer_id,
        email
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct MacroUser {
    pub id: uuid::Uuid,
    pub username: String,
    pub stripe_customer_id: Option<String>,
}

/// Gets the macro user
pub async fn get_macro_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    id: &str,
) -> anyhow::Result<MacroUser> {
    let id = macro_uuid::string_to_uuid(id)?;

    let result = sqlx::query_as!(
        MacroUser,
        r#"
        SELECT id, username, stripe_customer_id
        FROM macro_user
        WHERE id = $1
        "#,
        &id
    )
    .fetch_one(db)
    .await?;

    Ok(result)
}

pub async fn delete_macro_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    id: &uuid::Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM macro_user
        WHERE id = $1
        "#,
        id
    )
    .execute(db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn check_email_exists(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> anyhow::Result<bool> {
    let result = sqlx::query!(
        r#"
        SELECT id
        FROM "User"
        WHERE email = $1
        "#,
        email
    )
    .fetch_optional(db)
    .await?;

    Ok(result.is_some())
}

#[tracing::instrument(skip(db))]
pub async fn check_username_exists(
    db: &sqlx::Pool<sqlx::Postgres>,
    username: &str,
) -> anyhow::Result<bool> {
    let result = sqlx::query!(
        r#"
        SELECT id
        FROM macro_user
        WHERE username = $1
        "#,
        username
    )
    .fetch_optional(db)
    .await?;

    Ok(result.is_some())
}
