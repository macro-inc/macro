use sqlx::{Pool, Postgres};

use super::get_user_macro_user_id_and_id_by_email;
use super::get_user_theme_preferences;
use macro_user_id::user_id::MacroUserId;

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("users")))]
async fn test_get_user_theme_preferences_defaults(pool: Pool<Postgres>) {
    let user_id = MacroUserId::parse_from_str("macro|user@user.com")
        .unwrap()
        .lowercase();

    let prefs = get_user_theme_preferences(&pool, &user_id).await.unwrap();

    assert_eq!(prefs.preferred_light_theme, "Macro Light");
    assert_eq!(prefs.preferred_dark_theme, "Macro Dark");
    assert!(prefs.theme_matches_system);
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("users")))]
async fn test_get_user_theme_preferences_user_not_found(pool: Pool<Postgres>) {
    let user_id = MacroUserId::parse_from_str("macro|nonexistent@user.com")
        .unwrap()
        .lowercase();

    let result = get_user_theme_preferences(&pool, &user_id).await;

    assert!(result.is_err());
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("users")))]
async fn test_get_user_macro_user_id_and_id_by_email_success(pool: Pool<Postgres>) {
    let (macro_user_id, id) = get_user_macro_user_id_and_id_by_email(&pool, "user@user.com")
        .await
        .unwrap();

    assert_eq!(
        macro_user_id,
        uuid::Uuid::parse_str("a1111111-1111-1111-1111-111111111111").unwrap()
    );
    assert_eq!(id, "macro|user@user.com");
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("users")))]
async fn test_get_user_macro_user_id_and_id_by_email_not_found(pool: Pool<Postgres>) {
    let result = get_user_macro_user_id_and_id_by_email(&pool, "nonexistent@user.com").await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}
