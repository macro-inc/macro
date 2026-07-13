use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use macro_uuid::ShortUuidConverter;

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
    pub referral_code: String,
}

/// Gets the legacy user info
#[tracing::instrument(skip(db), err)]
pub async fn get_legacy_user_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> anyhow::Result<LegacyUserInfo> {
    let converter = ShortUuidConverter::default();

    let result = sqlx::query!(
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
            mu.has_trialed as has_trialed,
            u.macro_user_id as "macro_user_id"
        FROM "User" u
        JOIN "macro_user" mu ON u.macro_user_id = mu.id
        WHERE u."id" = $1
        "#,
        user_id.as_ref()
    )
    .map(|row| LegacyUserInfo {
        user_id: row.user_id,
        email: row.email,
        stripe_customer_id: row.stripe_customer_id,
        name: row.name,
        tutorial_complete: row.tutorial_complete,
        group: row.group,
        has_chrome_ext: row.has_chrome_ext,
        ai_data_consent: row.ai_data_consent,
        has_trialed: row.has_trialed,
        referral_code: converter.from_uuid(&row.macro_user_id),
    })
    .fetch_one(db)
    .await?;

    Ok(result)
}
