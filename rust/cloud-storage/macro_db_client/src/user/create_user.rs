use std::collections::HashSet;

use sqlx::{Pool, Postgres};

/// Creates a new user in the database and attaches provided roles
#[expect(clippy::too_many_arguments, reason = "too annoying to fix")]
#[tracing::instrument(skip(db))]
pub async fn create_user(
    db: &Pool<Postgres>,
    id: &str,
    username: &str,
    email: &str,
    is_verified: bool,
    stripe_customer_id: &str,
    organization_id: Option<i32>,
    roles: HashSet<String>,
) -> anyhow::Result<String> {
    let id = macro_uuid::string_to_uuid(id)?;

    let mut transaction = db.begin().await?;

    // Create macro user
    let macro_user_id = sqlx::query!(
        r#"
        INSERT INTO "macro_user" ("id", "username", "stripe_customer_id", "email")
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
        &id,
        username,
        stripe_customer_id,
        email
    )
    .map(|row| row.id)
    .fetch_one(&mut *transaction)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "macro_user_email_verification" ("macro_user_id", "email", "is_verified")
        VALUES ($1, $2, $3)
        "#,
        &id,
        email,
        is_verified
    )
    .execute(&mut *transaction)
    .await?;

    // Create user profile
    let id = format!("macro|{}", email);

    let user_id = sqlx::query!(
        r#"
        INSERT INTO "User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
        &id,
        email,
        stripe_customer_id,
        organization_id,
        &macro_user_id
    )
    .map(|row| row.id)
    .fetch_one(&mut *transaction)
    .await?;

    for role in roles {
        sqlx::query!(
            r#"
            INSERT INTO "RolesOnUsers" ("userId", "roleId")
            VALUES ($1, $2)
        "#,
            user_id,
            role
        )
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;

    Ok(id)
}

/// Creates a new user profile in the database and attaches provided roles
#[tracing::instrument(skip(db))]
pub async fn create_user_profile(
    db: &Pool<Postgres>,
    id: &str,
    email: &str,
    organization_id: Option<i32>,
    roles: HashSet<String>,
) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::string_to_uuid(id)?;
    let user_profile_id = format!("macro|{}", email);

    let mut transaction = db.begin().await?;

    let user_id = sqlx::query!(
        r#"
        INSERT INTO "User" ("id", "email", "organizationId", "macro_user_id")
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
        &user_profile_id,
        email,
        organization_id,
        &macro_user_id
    )
    .map(|row| row.id)
    .fetch_one(&mut *transaction)
    .await?;

    for role in roles {
        sqlx::query!(
            r#"
            INSERT INTO "RolesOnUsers" ("userId", "roleId")
            VALUES ($1, $2)
        "#,
            user_id,
            role
        )
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;

    Ok(())
}
