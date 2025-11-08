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
}

pub async fn get_legacy_user_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> anyhow::Result<LegacyUserInfo> {
    let result = sqlx::query_as!(
        LegacyUserInfo,
        r#"
        SELECT
            "id" as "user_id",
            "email" as "email",
            "stripeCustomerId" as "stripe_customer_id?",
            "name" as name,
            "tutorialComplete" as tutorial_complete,
            "group" as "group?",
            "hasChromeExt" as has_chrome_ext
        FROM "User"
        WHERE "id" = $1
        "#,
        user_id.as_ref()
    )
    .fetch_one(db)
    .await?;

    Ok(result)
}
