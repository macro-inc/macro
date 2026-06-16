use sqlx::{Pool, Postgres};

use super::patch_user_theme_preferences;
use crate::user::get::get_user_theme_preferences;
use macro_user_id::user_id::MacroUserId;
use model::authentication::user::UserThemePreferences;

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("users")))]
async fn test_patch_user_theme_preferences_roundtrip(pool: Pool<Postgres>) {
    let user_id = MacroUserId::parse_from_str("macro|user@user.com")
        .unwrap()
        .lowercase();

    let prefs = UserThemePreferences {
        preferred_light_theme: "Satsuma".to_string(),
        preferred_dark_theme: "Void".to_string(),
        theme_matches_system: false,
    };

    patch_user_theme_preferences(&pool, &user_id, &prefs)
        .await
        .unwrap();

    let stored = get_user_theme_preferences(&pool, &user_id).await.unwrap();

    assert_eq!(stored.preferred_light_theme, "Satsuma");
    assert_eq!(stored.preferred_dark_theme, "Void");
    assert!(!stored.theme_matches_system);
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("users")))]
async fn test_patch_user_theme_preferences_user_not_found(pool: Pool<Postgres>) {
    let user_id = MacroUserId::parse_from_str("macro|nonexistent@user.com")
        .unwrap()
        .lowercase();

    let prefs = UserThemePreferences::default();

    let result = patch_user_theme_preferences(&pool, &user_id, &prefs).await;

    assert!(result.is_err());
}
