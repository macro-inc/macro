use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

pub mod add_user_role;

pub async fn update_macro_user_id(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
    macro_user_id: &str,
) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    sqlx::query!(
        r#"
            UPDATE "User"
            SET macro_user_id = $1
            WHERE id = $2
        "#,
        macro_user_id,
        user_id,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Updates the user's group.
#[tracing::instrument(skip(db))]
pub async fn patch_user_group(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserId<Lowercase<'_>>,
    group: &str,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
            UPDATE "User"
            SET "group" = $1
            WHERE id = $2
        "#,
        group,
        user_id.as_ref(),
    )
    .execute(db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!("user not found"));
    }

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn patch_user_tutorial(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserId<Lowercase<'_>>,
    tutorial_complete: bool,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
            UPDATE "User"
            SET "tutorialComplete" = $1
            WHERE id = $2
        "#,
        tutorial_complete,
        user_id.as_ref(),
    )
    .execute(db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!("user not found"));
    }

    Ok(())
}

#[derive(Debug, Clone)]
pub struct UserOnboarding<'a> {
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub title: &'a str,
    pub industry: &'a str,
}

#[tracing::instrument(skip(db))]
pub async fn patch_user_onboarding(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserId<Lowercase<'_>>,
    onboarding: &UserOnboarding<'_>,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
            UPDATE "User"
            SET "firstName" = $1,
                "lastName" = $2,
                "title" = $3,
                "industry" = $4
            WHERE id = $5
        "#,
        onboarding.first_name,
        onboarding.last_name,
        onboarding.title,
        onboarding.industry,
        user_id.as_ref(),
    )
    .execute(db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!("user not found"));
    }

    Ok(())
}
