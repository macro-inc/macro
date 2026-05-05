use crate::{build_importance_condition, build_sender_importance_override_filter};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres, QueryBuilder};

// ---------------------------------------------------------------------------
// Shared UUIDs — match the values used in the fixture SQL scripts.
// ---------------------------------------------------------------------------

const MESSAGE_ID: Uuid = Uuid::from_bytes([
    0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Embeds `build_sender_importance_override_filter` in a real query and returns
/// whether it matches for the given `email_messages` row.
async fn fragment_matches(pool: &Pool<Postgres>, message_id: Uuid, is_important: bool) -> bool {
    let mut builder =
        QueryBuilder::new("SELECT EXISTS(SELECT 1 FROM email_messages m WHERE m.id = ");
    builder.push_bind(message_id);
    builder.push(" AND ");
    build_sender_importance_override_filter(is_important, &mut builder);
    builder.push(")");
    builder
        .build_query_scalar::<bool>()
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Asserts that `build_sender_importance_override_filter` produces the expected result.
async fn assert_fragment_result(pool: &Pool<Postgres>, message_id: Uuid, expected: Option<bool>) {
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
            assert!(
                !frag_false,
                "fragment(false) should not match with no filter"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Pins the contract that `build_importance_condition` emits no bind placeholders.
/// Callers in `filters.rs` round-trip its output through `SqlFragment::raw(qb.sql())`,
/// which would silently drop bound values — so any future `.push_bind()` here would
/// produce SQL with unbound `$N` at runtime.
#[test]
fn build_importance_condition_emits_no_binds() {
    for is_important in [true, false] {
        let mut qb = QueryBuilder::<Postgres>::new("");
        build_importance_condition(is_important, &mut qb);
        assert!(
            !qb.sql().contains('$'),
            "build_importance_condition({is_important}) emitted a $N placeholder; \
             callers rely on bind-free output. SQL: {}",
            qb.sql()
        );
    }
}

/// No email_filters entries → no override → both fragments are false.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("no_filter"))
)]
async fn no_filter_returns_none(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, None).await;
    Ok(())
}

/// Email-level override is_important=true → fragment(true) matches.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_important_true"))
)]
async fn email_level_important_true(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, Some(true)).await;
    Ok(())
}

/// Email-level override is_important=false → fragment(false) matches.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_important_false"))
)]
async fn email_level_important_false(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, Some(false)).await;
    Ok(())
}

/// Domain-level override is_important=true (no email-level) → fragment(true) matches.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("domain_important_true"))
)]
async fn domain_level_important_true(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, Some(true)).await;
    Ok(())
}

/// Domain-level override is_important=false (no email-level) → fragment(false) matches.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("domain_important_false"))
)]
async fn domain_level_important_false(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, Some(false)).await;
    Ok(())
}

/// Email-level true takes precedence over domain-level false.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_true_overrides_domain_false"))
)]
async fn email_true_overrides_domain_false(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, Some(true)).await;
    Ok(())
}

/// Email-level false takes precedence over domain-level true, and suppresses the domain match.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_false_overrides_domain_true"))
)]
async fn email_false_overrides_domain_true(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, Some(false)).await;
    Ok(())
}

/// Email address matching is case-insensitive: filter stored in uppercase still matches
/// a lowercase contact address.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_case_insensitive"))
)]
async fn email_level_case_insensitive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, Some(true)).await;
    Ok(())
}

/// Domain matching is case-insensitive: filter stored with uppercase domain still matches.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("domain_case_insensitive"))
)]
async fn domain_level_case_insensitive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, Some(true)).await;
    Ok(())
}

/// A filter belonging to a different link_id has no effect on the result.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("other_link_ignored"))
)]
async fn filter_for_other_link_is_ignored(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, None).await;
    Ok(())
}

/// Domain suppression is per-address: a different sender at the same domain having an
/// email-level override of the opposite importance must NOT suppress our sender's domain match.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("domain_suppression_scoped"))
)]
async fn domain_suppression_scoped_to_sender_address(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, Some(true)).await;
    Ok(())
}

/// Domain matching is exact, not suffix-based: a filter for `example.com` must not match
/// a sender whose domain is `mail.example.com`.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("subdomain_not_matched"))
)]
async fn subdomain_does_not_match_parent_domain_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_fragment_result(&pool, MESSAGE_ID, None).await;
    Ok(())
}
