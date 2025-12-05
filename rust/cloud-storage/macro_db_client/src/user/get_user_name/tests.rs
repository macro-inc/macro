use super::*;
use crate::user::get_user_name::get_user_names_with_email;
use sqlx::{Pool, Postgres};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn test_get_user_names_with_email_basic(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_profile_ids = vec![
        "macro|user_profile_1@macro.com".to_string(),
        "macro|user_profile_2@macro.com".to_string(),
    ];

    let mut names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
            .await?;
    names.sort_by(|a, b| a.id.cmp(&b.id));

    assert_eq!(names.len(), 2);

    // Sorted: macro|user_profile_1@macro.com, macro|user_profile_2@macro.com
    assert_eq!(names[0].id, "macro|user_profile_1@macro.com");
    assert_eq!(names[0].first_name, Some("JohnMacroContact".to_string()));
    assert_eq!(names[0].last_name, Some("DoeMacroContact".to_string()));

    assert_eq!(names[1].id, "macro|user_profile_2@macro.com");
    assert_eq!(names[1].first_name, Some("JaneMacroContact".to_string()));
    assert_eq!(names[1].last_name, Some("SmithMacroContact".to_string()));

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn test_get_user_names_with_email_fallback_to_contact(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // User with N/A name should fall back to email contact name
    let user_profile_ids = vec!["macro|user_profile_3@macro.com".to_string()];

    let names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
            .await?;

    assert_eq!(names.len(), 1);
    assert_eq!(names[0].id, "macro|user_profile_3@macro.com");
    assert_eq!(names[0].first_name, Some("BobEmailContact".to_string()));
    assert_eq!(names[0].last_name, Some("JohnsonEmailContact".to_string()));

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn test_get_user_names_with_email_contact_only(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // User not in User table, only in email_contacts
    let user_profile_ids = vec!["macro|contact@example.com".to_string()];

    let names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
            .await?;

    assert_eq!(names.len(), 1);
    assert_eq!(names[0].id, "macro|contact@example.com");
    assert_eq!(names[0].first_name, Some("AliceEmailContact".to_string()));
    assert_eq!(names[0].last_name, Some("WilliamsEmailContact".to_string()));

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn test_get_user_names_with_email_mixed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Mix of users with names, N/A fallback, and contact-only
    let user_profile_ids = vec![
        "macro|user_profile_1@macro.com".to_string(),
        "macro|user_profile_3@macro.com".to_string(),
        "macro|contact@example.com".to_string(),
    ];

    let mut names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
            .await?;
    names.sort_by(|a, b| a.id.cmp(&b.id));

    assert_eq!(names.len(), 3);

    // Sorted: macro|contact@example.com, macro|user_profile_1@macro.com, macro|user_profile_3@macro.com
    assert_eq!(names[0].id, "macro|contact@example.com");
    assert_eq!(names[0].first_name, Some("AliceEmailContact".to_string()));
    assert_eq!(names[0].last_name, Some("WilliamsEmailContact".to_string()));

    assert_eq!(names[1].id, "macro|user_profile_1@macro.com");
    assert_eq!(names[1].first_name, Some("JohnMacroContact".to_string()));
    assert_eq!(names[1].last_name, Some("DoeMacroContact".to_string()));

    assert_eq!(names[2].id, "macro|user_profile_3@macro.com");
    assert_eq!(names[2].first_name, Some("BobEmailContact".to_string()));
    assert_eq!(names[2].last_name, Some("JohnsonEmailContact".to_string()));

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn test_get_user_names_with_email_empty_list(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_profile_ids = vec![];

    let names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
            .await?;

    assert_eq!(names.len(), 0);

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn test_get_user_names_with_email_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_profile_ids = vec!["nonexistent_user".to_string()];

    let names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
            .await?;

    // Should return empty list for users that don't exist
    assert_eq!(names.len(), 0);

    Ok(())
}
