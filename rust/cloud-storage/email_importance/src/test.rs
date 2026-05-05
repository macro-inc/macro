use crate::build_sender_importance_override_filter;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres, QueryBuilder};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Embeds `build_sender_importance_override_filter` in a real query and returns
/// whether it matches for the given `email_messages` row.
async fn fragment_matches(pool: &Pool<Postgres>, message_id: Uuid, is_important: bool) -> bool {
    let mut builder = QueryBuilder::new("SELECT EXISTS(SELECT 1 FROM email_messages m WHERE m.id = ");
    builder.push_bind(message_id);
    builder.push(" AND ");
    build_sender_importance_override_filter(is_important).push_into(&mut builder);
    builder.push(")");
    builder
        .build_query_scalar::<bool>()
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Asserts that `build_sender_importance_override_filter` produces the expected result.
/// `expected = Some(true)`: fragment(true) matches, fragment(false) does not.
/// `expected = Some(false)`: fragment(false) matches, fragment(true) does not.
/// `expected = None`: neither fragment matches.
async fn assert_fragment_result(
    pool: &Pool<Postgres>,
    message_id: Uuid,
    expected: Option<bool>,
) {
    let frag_true = fragment_matches(pool, message_id, true).await;
    let frag_false = fragment_matches(pool, message_id, false).await;

    match expected {
        Some(true) => {
            assert!(frag_true, "fragment(true) should match");
            assert!(!frag_false, "fragment(false) should not match");
        }
        Some(false) => {
            assert!(!frag_true, "fragment(true) should not match");
            assert!(frag_false, "fragment(false) should match");
        }
        None => {
            assert!(!frag_true, "fragment(true) should not match with no filter");
            assert!(!frag_false, "fragment(false) should not match with no filter");
        }
    }
}

async fn setup_link_contact_message(
    pool: &Pool<Postgres>,
    link_id: Uuid,
    contact_id: Uuid,
    message_id: Uuid,
    sender_email: &str,
) {
    let fauth_id = link_id.to_string();
    let macro_id = format!("macro|{sender_email}");
    sqlx::query(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'GMAIL', true, NOW(), NOW())",
    )
    .bind(link_id)
    .bind(&macro_id)
    .bind(&fauth_id)
    .bind(sender_email)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())",
    )
    .bind(contact_id)
    .bind(link_id)
    .bind(sender_email)
    .execute(pool)
    .await
    .unwrap();

    let thread_id = Uuid::new_v4();
    let provider_id = format!("provider-{message_id}");
    sqlx::query(
        "INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
         VALUES ($1, $2, false, false, NOW(), NOW())",
    )
    .bind(thread_id)
    .bind(link_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id,
                                     internal_date_ts, has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, $5, NOW(), false, false, false, false, NOW(), NOW())",
    )
    .bind(message_id)
    .bind(thread_id)
    .bind(link_id)
    .bind(&provider_id)
    .bind(contact_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_email_filter(
    pool: &Pool<Postgres>,
    link_id: Uuid,
    email: Option<&str>,
    domain: Option<&str>,
    is_important: bool,
) {
    sqlx::query(
        "INSERT INTO email_filters (link_id, email_address, email_domain, is_important)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(link_id)
    .bind(email)
    .bind(domain)
    .bind(is_important)
    .execute(pool)
    .await
    .unwrap();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// No email_filters entries → no override → both fragments are false.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_filter_returns_none(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@example.com").await;

    assert_fragment_result(&pool, message_id, None).await;
    Ok(())
}

/// Email-level override is_important=true → fragment(true) matches.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_level_important_true(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@example.com").await;
    insert_email_filter(&pool, link_id, Some("sender@example.com"), None, true).await;

    assert_fragment_result(&pool, message_id, Some(true)).await;
    Ok(())
}

/// Email-level override is_important=false → fragment(false) matches.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_level_important_false(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@example.com").await;
    insert_email_filter(&pool, link_id, Some("sender@example.com"), None, false).await;

    assert_fragment_result(&pool, message_id, Some(false)).await;
    Ok(())
}

/// Domain-level override is_important=true (no email-level) → fragment(true) matches.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn domain_level_important_true(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@important.com").await;
    insert_email_filter(&pool, link_id, None, Some("important.com"), true).await;

    assert_fragment_result(&pool, message_id, Some(true)).await;
    Ok(())
}

/// Domain-level override is_important=false (no email-level) → fragment(false) matches.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn domain_level_important_false(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@noise.com").await;
    insert_email_filter(&pool, link_id, None, Some("noise.com"), false).await;

    assert_fragment_result(&pool, message_id, Some(false)).await;
    Ok(())
}

/// Email-level true takes precedence over domain-level false.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_true_overrides_domain_false(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@mixed.com").await;
    insert_email_filter(&pool, link_id, Some("sender@mixed.com"), None, true).await;
    insert_email_filter(&pool, link_id, None, Some("mixed.com"), false).await;

    assert_fragment_result(&pool, message_id, Some(true)).await;
    Ok(())
}

/// Email-level false takes precedence over domain-level true, and suppresses the domain match.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_false_overrides_domain_true(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@mixed.com").await;
    insert_email_filter(&pool, link_id, Some("sender@mixed.com"), None, false).await;
    insert_email_filter(&pool, link_id, None, Some("mixed.com"), true).await;

    assert_fragment_result(&pool, message_id, Some(false)).await;
    Ok(())
}

/// Email address matching is case-insensitive: filter stored in uppercase still matches
/// a lowercase contact address.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_level_case_insensitive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@example.com").await;
    insert_email_filter(&pool, link_id, Some("Sender@EXAMPLE.COM"), None, true).await;

    assert_fragment_result(&pool, message_id, Some(true)).await;
    Ok(())
}

/// Domain matching is case-insensitive: filter stored with uppercase domain still matches.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn domain_level_case_insensitive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@example.com").await;
    insert_email_filter(&pool, link_id, None, Some("EXAMPLE.COM"), true).await;

    assert_fragment_result(&pool, message_id, Some(true)).await;
    Ok(())
}

/// A filter belonging to a different link_id has no effect on the result.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn filter_for_other_link_is_ignored(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let other_link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@example.com").await;
    let other_fauth = other_link_id.to_string();
    sqlx::query(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
         VALUES ($1, 'macro|other@example.com', $2, 'other@example.com', 'GMAIL', true, NOW(), NOW())",
    )
    .bind(other_link_id)
    .bind(&other_fauth)
    .execute(&pool)
    .await
    .unwrap();
    insert_email_filter(&pool, other_link_id, Some("sender@example.com"), None, true).await;

    assert_fragment_result(&pool, message_id, None).await;
    Ok(())
}

/// Domain suppression is per-address: a different sender at the same domain having an
/// email-level override of the opposite importance must NOT suppress our sender's domain match.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn domain_suppression_scoped_to_sender_address(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "alice@company.com").await;
    insert_email_filter(&pool, link_id, None, Some("company.com"), true).await;
    insert_email_filter(&pool, link_id, Some("bob@company.com"), None, false).await;

    assert_fragment_result(&pool, message_id, Some(true)).await;
    Ok(())
}

/// Domain matching is exact, not suffix-based: a filter for `example.com` must not match
/// a sender whose domain is `mail.example.com`.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subdomain_does_not_match_parent_domain_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    setup_link_contact_message(&pool, link_id, contact_id, message_id, "sender@mail.example.com").await;
    insert_email_filter(&pool, link_id, None, Some("example.com"), true).await;

    assert_fragment_result(&pool, message_id, None).await;
    Ok(())
}
