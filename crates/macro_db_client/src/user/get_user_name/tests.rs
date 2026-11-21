#[allow(unused_imports)]
use super::*;
use crate::user::get_user_name::get_user_names_with_email;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserId;
use non_empty::NonEmpty;
use sqlx::{Pool, Postgres};

const NAMES_WITH_EMAIL_SQL: &str = include_str!("names_with_email.sql");

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

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn deduplicates_requested_user_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_profile_ids = parse_user_ids(vec![
        "macro|user_profile_1@macro.com",
        "macro|user_profile_1@macro.com",
    ])?;

    let names =
        get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", user_profile_ids)
            .await?;

    assert_eq!(names.len(), 1);
    assert_eq!(names[0].id, "macro|user_profile_1@macro.com");

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

#[sqlx::test]
async fn test_get_user_name_without_info_row(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // The macro_user_info row is created lazily by the first name write, so a
    // brand-new user has none — the lookup must report "no name yet", not
    // error.
    let user_id = "00000000-0000-0000-0000-000000000042";

    let name = get_user_name(&pool, user_id).await?;

    assert_eq!(name.id, user_id);
    assert_eq!(name.first_name, None);
    assert_eq!(name.last_name, None);
    Ok(())
}

/// Every mailbox is the viewer's when statistics are taken, so they say each
/// `email_links` row is theirs. Once other people have mailboxes, a plan that
/// joins the viewer's mailboxes per requested id expects to visit all of them,
/// and searches every mailbox's contacts for the address instead. The lookup
/// must keep probing contacts by the viewer's own mailboxes and the address.
#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_names_with_email")))]
async fn address_book_names_are_read_through_the_viewers_mailboxes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::raw_sql(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES
            ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'macro|user_profile_1@macro.com', 'fa_user_1', 'second@example.com', 'GMAIL'),
            ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'macro|user_profile_1@macro.com', 'fa_user_1', 'third@example.com', 'GMAIL');
        ANALYZE email_links;
        ALTER TABLE email_links SET (autovacuum_enabled = false);
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        SELECT md5('link' || n)::uuid, 'macro|owner' || n || '@example.com', 'fa_owner_' || n,
               'owner' || n || '@example.com', 'GMAIL'
        FROM generate_series(1, 5000) n;
        INSERT INTO email_contacts (id, link_id, email_address, name)
        SELECT md5('contact' || n)::uuid, md5('link' || (n % 5000 + 1))::uuid,
               'person' || n || '@example.org', 'Person ' || n
        FROM generate_series(1, 20000) n;
        COMMIT;
        ANALYZE email_contacts;
        "#,
    )
    .execute(&pool)
    .await?;
    // EXPLAIN of the statement itself plans it for the values bound to it,
    // whatever the plan mode. Only a prepared statement gets a generic plan.
    let mut connection = pool.acquire().await?;
    sqlx::raw_sql(&format!(
        "PREPARE names_with_email (text, text[]) AS {NAMES_WITH_EMAIL_SQL}"
    ))
    .execute(&mut *connection)
    .await?;

    for (plan_cache_mode, viewer_in_plan) in [
        ("force_custom_plan", "'macro|user_profile_1@macro.com'"),
        ("force_generic_plan", "$1"),
    ] {
        sqlx::raw_sql(&format!("SET plan_cache_mode = {plan_cache_mode}"))
            .execute(&mut *connection)
            .await?;
        let plan: Vec<String> = sqlx::query_scalar(
            "EXPLAIN (COSTS OFF) EXECUTE names_with_email \
             ('macro|user_profile_1@macro.com', ARRAY['macro|no_profile_name@example.com'])",
        )
        .persistent(false)
        .fetch_all(&mut *connection)
        .await?;
        let plan_text = plan.join("\n");

        assert!(
            plan_text.contains(&format!("macro_id = {viewer_in_plan}")),
            "the plan is a {plan_cache_mode} one:\n{plan_text}"
        );
        assert!(
            plan_text
                .contains("Index Scan using contacts_link_id_email_address_idx on email_contacts")
                && plan_text.contains("Index Cond: ((link_id = ANY"),
            "contacts are probed by mailbox and address ({plan_cache_mode}):\n{plan_text}"
        );
    }

    Ok(())
}
