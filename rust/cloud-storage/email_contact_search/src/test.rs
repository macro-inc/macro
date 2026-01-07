//! Tests for email contact search module

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserId;
use sqlx::{Pool, Postgres};

use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_empty_term(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    let result = search_email_contacts(&pool, user_id, "".to_string(), 10, 0).await;

    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        EmailContactSearchError::EmptySearchTerm
    ));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_finds_sender_by_name(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "Alice" - should find Thread 1 where Alice is the sender
    let results = search_email_contacts(&pool, user_id, "Alice".to_string(), 10, 0).await?;

    // Should find matches (Alice is sender in thread 1, recipient in threads 1 and 2)
    assert!(!results.is_empty());

    // Check that we have a From match for Alice
    let from_match = results
        .iter()
        .find(|r| matches!(r.contact_type, ContactType::From) && r.contact_name == "Alice Smith");
    assert!(from_match.is_some());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_finds_recipients(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "Bob" - should find threads where Bob is a recipient
    let results = search_email_contacts(&pool, user_id, "Bob".to_string(), 10, 0).await?;

    assert!(!results.is_empty());

    // Check for CC match (Bob is CC in thread 1)
    let cc_match = results.iter().find(|r| {
        matches!(r.contact_type, ContactType::Cc)
            && r.contact_name == "Bob Johnson"
            && r.thread_id.to_string() == "11111111-1111-1111-1111-111111111111"
    });
    assert!(cc_match.is_some());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_finds_bcc_recipients(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "David" - should find thread 2 where David is BCC
    let results = search_email_contacts(&pool, user_id, "David".to_string(), 10, 0).await?;

    assert!(!results.is_empty());

    // Check for BCC match
    let bcc_match = results.iter().find(|r| {
        matches!(r.contact_type, ContactType::Bcc)
            && r.contact_name == "David Miller"
            && r.thread_id.to_string() == "22222222-2222-2222-2222-222222222222"
    });
    assert!(bcc_match.is_some());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_sorted_by_latest_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "Smith" - Alice Smith appears in multiple threads
    let results = search_email_contacts(&pool, user_id, "Smith".to_string(), 10, 0).await?;

    assert!(!results.is_empty());

    // Thread 11111111 has latest_non_spam_message_ts: 2024-12-06 (most recent)
    // Thread 22222222 has latest_non_spam_message_ts: 2024-12-05 (second most recent)
    // Results should be sorted by latest_non_spam_message_ts DESC
    if results.len() >= 2 {
        assert_eq!(
            results[0].thread_id.to_string(),
            "11111111-1111-1111-1111-111111111111"
        );
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_case_insensitive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search with different cases
    let results_lower =
        search_email_contacts(&pool, user_id.clone(), "alice".to_string(), 10, 0).await?;
    let results_upper =
        search_email_contacts(&pool, user_id.clone(), "ALICE".to_string(), 10, 0).await?;
    let results_mixed = search_email_contacts(&pool, user_id, "AlIcE".to_string(), 10, 0).await?;

    // All should return the same number of results
    assert_eq!(results_lower.len(), results_upper.len());
    assert_eq!(results_lower.len(), results_mixed.len());
    assert!(!results_lower.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_partial_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for partial term "John" should match "Bob Johnson"
    let results = search_email_contacts(&pool, user_id, "John".to_string(), 10, 0).await?;

    assert!(!results.is_empty());
    assert!(results.iter().any(|r| r.contact_name.contains("Johnson")));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_pagination_limit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search with limit of 2
    let results = search_email_contacts(&pool, user_id, "a".to_string(), 2, 0).await?;

    assert!(results.len() <= 2);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_pagination_offset(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Get all results first
    let all_results =
        search_email_contacts(&pool, user_id.clone(), "a".to_string(), 100, 0).await?;

    if all_results.len() > 2 {
        // Get with offset of 2
        let offset_results = search_email_contacts(&pool, user_id, "a".to_string(), 100, 2).await?;

        // Should skip the first 2
        assert_eq!(offset_results.len(), all_results.len() - 2);
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_user_isolation(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "Frank" - Frank belongs to user2, not user1
    let results = search_email_contacts(&pool, user_id, "Frank".to_string(), 10, 0).await?;

    // Should return 0 results (Frank is not accessible to user1)
    assert_eq!(results.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_no_results(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for a name that doesn't exist
    let results =
        search_email_contacts(&pool, user_id, "NonexistentPerson".to_string(), 10, 0).await?;

    assert_eq!(results.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_includes_email_address(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "Alice"
    let results = search_email_contacts(&pool, user_id, "Alice".to_string(), 10, 0).await?;

    assert!(!results.is_empty());

    // Check that email address is included
    let alice_result = results
        .iter()
        .find(|r| r.contact_name == "Alice Smith")
        .unwrap();
    assert_eq!(alice_result.contact_email, "alice@example.com");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_uses_message_level_name_override(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "Charles" - Thread 3 has from_name = "Charles B. Brown" which overrides contact name "Charlie Brown"
    let results =
        search_email_contacts(&pool, user_id.clone(), "Charles".to_string(), 10, 0).await?;

    // Should find the message with from_name override
    let charles_match = results
        .iter()
        .find(|r| r.contact_name == "Charles B. Brown");
    assert!(charles_match.is_some());

    // The returned name should be the from_name (override), not the contact name
    assert_eq!(charles_match.unwrap().contact_name, "Charles B. Brown");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_searches_both_from_name_and_contact_name(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "Charlie" - should find thread 3 because the contact name is "Charlie Brown"
    // even though the from_name is "Charles B. Brown"
    let charlie_results =
        search_email_contacts(&pool, user_id, "Charlie".to_string(), 10, 0).await?;

    // Should find thread 3's sender by searching the contact name
    let charlie_from_match = charlie_results.iter().find(|r| {
        matches!(r.contact_type, ContactType::From)
            && r.thread_id.to_string() == "33333333-3333-3333-3333-333333333333"
    });
    assert!(charlie_from_match.is_some());

    // But the displayed name should still be the from_name override
    assert_eq!(charlie_from_match.unwrap().contact_name, "Charles B. Brown");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_recipient_name_override(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "Robert" - Thread 3 has recipient with name override "Robert J." for Bob Johnson
    let results = search_email_contacts(&pool, user_id, "Robert".to_string(), 10, 0).await?;

    // Should find the recipient with name override
    let robert_match = results.iter().find(|r| r.contact_name == "Robert J.");
    assert!(robert_match.is_some());

    Ok(())
}
