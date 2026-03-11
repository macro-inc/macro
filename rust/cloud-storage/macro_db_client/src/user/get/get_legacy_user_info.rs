use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

#[derive(Debug, serde::Serialize)]
pub struct LegacyUserInfo {
    pub user_id: String,
    pub email: String,
    pub stripe_customer_id: Option<String>,
    pub name: Option<String>,
    pub tutorial_complete: bool,
    pub group: Option<String>,
    pub has_chrome_ext: bool,
    pub ai_data_consent: bool,
    pub has_trialed: bool,
}

/// Gets the legacy user info
#[tracing::instrument(skip(db), err)]
pub async fn get_legacy_user_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> anyhow::Result<LegacyUserInfo> {
    let result = sqlx::query_as!(
        LegacyUserInfo,
        r#"
        SELECT
            u."id" as "user_id",
            u."email" as "email",
            u."stripeCustomerId" as "stripe_customer_id?",
            u."name" as name,
            u."tutorialComplete" as tutorial_complete,
            u."group" as "group?",
            u."hasChromeExt" as has_chrome_ext,
            u."aiDataConsent" as ai_data_consent,
            mu.has_trialed as has_trialed
        FROM "User" u
        JOIN "macro_user" mu ON u.macro_user_id = mu.id
        WHERE u."id" = $1
        "#,
        user_id.as_ref()
    )
    .fetch_one(db)
    .await?;

    Ok(result)
}
