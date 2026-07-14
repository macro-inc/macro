#[allow(unused_imports)]
use super::*;
use crate::user::get_user_name::get_user_names_with_email;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserId;
use non_empty::NonEmpty;
use sqlx::{Pool, Postgres};

fn parse_user_ids(
    ids: Vec<&str>,
) -> anyhow::Result<NonEmpty<Vec<MacroUserId<macro_user_id::lowercased::Lowercase<'static>>>>> {
    NonEmpty::new(
        ids.into_iter()
            .map(|id| MacroUserId::parse_from_str(id).map(|u| u.lowercase().into_owned()))
            .collect::<Result<Vec<_>, _>>()?,
    )
    .map_err(|e| anyhow::anyhow!("Empty user_ids: {}", e))
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn test_get_user_names_with_email_basic(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_profile_ids = parse_user_ids(vec![
        "macro|user_profile_1@macro.com",
        "macro|user_profile_2@macro.com",
    ])?;

    let mut names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", user_profile_ids)
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
    let user_profile_ids = parse_user_ids(vec!["macro|user_profile_3@macro.com"])?;

    let names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", user_profile_ids)
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
    let user_profile_ids = parse_user_ids(vec!["macro|contact@example.com"])?;

    let names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", user_profile_ids)
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
    let user_profile_ids = parse_user_ids(vec![
        "macro|user_profile_1@macro.com",
        "macro|user_profile_3@macro.com",
        "macro|contact@example.com",
    ])?;

    let mut names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", user_profile_ids)
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
async fn test_get_user_names_with_email_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_profile_ids = parse_user_ids(vec!["macro|nonexistent@example.com"])?;

    let names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", user_profile_ids)
            .await?;

    // Should return empty list for users that don't exist
    assert_eq!(names.len(), 0);

    Ok(())
}

/// only fallback to using email contact names if the user has neither first nor last name set
/// in macro. don't use the email contact last name with the macro first name if exists.
#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn uses_macro_names_if_either_first_or_last_present(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_profile_ids = parse_user_ids(vec![
        "macro|user_profile_4@macro.com",
        "macro|user_profile_5@macro.com",
    ])?;

    let mut names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", user_profile_ids)
            .await?;
    names.sort_by(|a, b| a.id.cmp(&b.id));

    let u4 = names
        .iter()
        .find(|n| n.id == "macro|user_profile_4@macro.com")
        .expect("user_profile_4 should be returned");
    assert_eq!(u4.first_name.as_deref(), Some("OnlyFirstMacro"));
    assert_eq!(u4.last_name.as_deref(), None);

    let u5 = names
        .iter()
        .find(|n| n.id == "macro|user_profile_5@macro.com")
        .expect("user_profile_5 should be returned");
    assert_eq!(u5.first_name.as_deref(), None);
    assert_eq!(u5.last_name.as_deref(), Some("OnlyLastMacro"));

    Ok(())
}
