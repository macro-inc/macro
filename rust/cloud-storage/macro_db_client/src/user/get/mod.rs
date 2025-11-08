pub mod get_user_by_email;
pub mod get_user_organization;
pub mod get_user_permissions;

mod get_legacy_user_info;
pub use get_legacy_user_info::*;

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model::user::{UserInfo, UserInfoWithMacroUserId};

/// Gets the stripe customer id for a given user id
#[tracing::instrument(skip(db))]
pub async fn get_stripe_customer_id_by_user_id<'a>(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Option<String>, sqlx::Error> {
    let user_id = user_id.as_ref();

    let stripe_customer_id = sqlx::query!(
        r#"
        SELECT "stripeCustomerId" as "stripe_customer_id?"
        FROM "User"
        WHERE "id" = $1
        "#,
        user_id
    )
    .map(|row| row.stripe_customer_id)
    .fetch_one(db)
    .await?;

    Ok(stripe_customer_id)
}

/// Gets the user macro id for a given email
#[tracing::instrument(skip(db))]
pub async fn get_user_macro_id_by_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> Result<String, sqlx::Error> {
    let macro_user_id: String = sqlx::query!(
        r#"
        SELECT "macro_user_id" as "macro_user_id!"
        FROM "User"
        WHERE "email" = $1
        "#,
        email
    )
    .map(|row| row.macro_user_id.to_string())
    .fetch_one(db)
    .await?;

    Ok(macro_user_id)
}

/// Gets the user id for a given email
#[tracing::instrument(skip(db))]
pub async fn get_user_id_by_email(
    db: sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> Result<String, sqlx::Error> {
    let user_id: String = sqlx::query!(
        r#"
        SELECT "id"
        FROM "User"
        WHERE "email" = $1
        "#,
        email
    )
    .map(|row| row.id)
    .fetch_one(&db)
    .await?;

    Ok(user_id)
}

/// Gets the user id and stripe customer id for a given email
#[tracing::instrument(skip(db))]
pub async fn get_user_id_and_stripe_customer_id_by_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> Result<(String, Option<String>), sqlx::Error> {
    let result = sqlx::query!(
        r#"
        SELECT "id", "stripeCustomerId" as "stripe_customer_id?"
        FROM "User"
        WHERE "email" = $1
        "#,
        email
    )
    .map(|row| (row.id, row.stripe_customer_id))
    .fetch_one(db)
    .await?;

    Ok(result)
}

/// Returns the user profile for a given macro user and email
pub async fn get_user_profile_by_fusionauth_user_id_and_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    fusionauth_user_id: &str,
    email: &str,
) -> anyhow::Result<Option<(String, Option<i32>)>> {
    let fusionauth_user_id = macro_uuid::string_to_uuid(fusionauth_user_id)?;
    let profile = sqlx::query!(
        r#"
        SELECT id, "organizationId" as "organization_id?"
        FROM "User"
        WHERE "macro_user_id" = $1
        AND email = $2
        "#,
        &fusionauth_user_id,
        &email
    )
    .map(|row| (row.id, row.organization_id))
    .fetch_optional(db)
    .await?;

    Ok(profile)
}

/// Returns all the user profiles for a given macro user
pub async fn get_user_profiles_by_fusionauth_user_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    fusionauth_user_id: &str,
) -> anyhow::Result<Vec<String>> {
    let fusionauth_user_id = macro_uuid::string_to_uuid(fusionauth_user_id)?;
    let profiles = sqlx::query!(
        r#"
        SELECT id
        FROM "User"
        WHERE "macro_user_id" = $1
        "#,
        &fusionauth_user_id
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(profiles)
}

/// Gets the user profile by email
#[tracing::instrument(skip(db))]
pub async fn get_user_info_by_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> Result<UserInfoWithMacroUserId, sqlx::Error> {
    let user_info = sqlx::query_as!(
        UserInfoWithMacroUserId,
        r#"
        SELECT 
            id,
            email,
            "organizationId" as "organization_id?",
            macro_user_id as "macro_user_id?"
        FROM "User"
        WHERE "email" = $1
        "#,
        email
    )
    .fetch_one(db)
    .await?;

    Ok(user_info)
}

/// Gets the user profile
#[tracing::instrument(skip(db))]
pub async fn get_user_profile(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> Result<UserInfo, sqlx::Error> {
    let user_info = sqlx::query_as!(
        UserInfo,
        r#"
        SELECT 
            id,
            email,
            "organizationId" as "organization_id?"
        FROM "User"
        WHERE "id" = $1
        "#,
        user_id
    )
    .fetch_one(db)
    .await?;

    Ok(user_info)
}

/// Gets all users emails
#[tracing::instrument(skip(db))]
pub async fn get_user_emails(
    db: sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
) -> anyhow::Result<(Vec<String>, i64)> {
    let count = sqlx::query!(
        r#"
            SELECT COUNT(*) as "count"
            FROM "User" u
        "#,
    )
    .map(|row| row.count)
    .fetch_one(&db)
    .await?;

    let count = count.unwrap_or(0);

    if count == 0 {
        tracing::trace!("no users found");
        return Ok((vec![], 0));
    }

    // Get batch of users
    let users = sqlx::query!(
        r#"
        SELECT
            u.email
        FROM
            "User" u
        LIMIT $1 OFFSET $2
    "#,
        limit,
        offset,
    )
    .map(|row| row.email)
    .fetch_all(&db)
    .await?;

    Ok((users, count))
}
