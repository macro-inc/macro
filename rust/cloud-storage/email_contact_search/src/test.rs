//! Tests for email contact search module

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserId;
use models_search_cursor::SearchCursorOption;
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

    let result = search_email_contacts(&pool, user_id, "".to_string(), 10, None).await;

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
    let response = search_email_contacts(&pool, user_id, "Alice".to_string(), 10, None).await?;

    // Should find matches (Alice is sender in thread 1, recipient in threads 1 and 2)
    assert!(!response.items.is_empty());

    // Check that we have a From match for Alice
    let from_match = response.items.iter().find(|r| {
        matches!(r.contact_type, ContactType::From)
            && r.contact_name.as_deref() == Some("Alice Smith")
    });
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
    let response = search_email_contacts(&pool, user_id, "Bob".to_string(), 10, None).await?;

    assert!(!response.items.is_empty());

    // Check for CC match (Bob is CC in thread 1)
    let cc_match = response.items.iter().find(|r| {
        matches!(r.contact_type, ContactType::Cc)
            && r.contact_name.as_deref() == Some("Bob Johnson")
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
    let response = search_email_contacts(&pool, user_id, "David".to_string(), 10, None).await?;

    assert!(!response.items.is_empty());

    // Check for BCC match
    let bcc_match = response.items.iter().find(|r| {
        matches!(r.contact_type, ContactType::Bcc)
            && r.contact_name.as_deref() == Some("David Miller")
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
    let response = search_email_contacts(&pool, user_id, "Smith".to_string(), 10, None).await?;

    assert!(!response.items.is_empty());

    // Thread 11111111 has latest_non_spam_message_ts: 2024-12-06 (most recent)
    // Thread 22222222 has latest_non_spam_message_ts: 2024-12-05 (second most recent)
    // Results should be sorted by latest_non_spam_message_ts DESC
    if response.items.len() >= 2 {
        assert_eq!(
            response.items[0].thread_id.to_string(),
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
    let response_lower =
        search_email_contacts(&pool, user_id.clone(), "alice".to_string(), 10, None).await?;
    let response_upper =
        search_email_contacts(&pool, user_id.clone(), "ALICE".to_string(), 10, None).await?;
    let response_mixed =
        search_email_contacts(&pool, user_id, "AlIcE".to_string(), 10, None).await?;

    // All should return the same number of results
    assert_eq!(response_lower.items.len(), response_upper.items.len());
    assert_eq!(response_lower.items.len(), response_mixed.items.len());
    assert!(!response_lower.items.is_empty());

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
    let response = search_email_contacts(&pool, user_id, "John".to_string(), 10, None).await?;

    assert!(!response.items.is_empty());
    assert!(response.items.iter().any(|r| {
        r.contact_name
            .as_ref()
            .map_or(false, |n| n.contains("Johnson"))
    }));

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

    // Search with limit of 2 threads - may return multiple rows per thread (one per contact match)
    let response = search_email_contacts(&pool, user_id, "a".to_string(), 2, None).await?;

    // Limit applies to threads, not rows - verify we get at most 2 unique threads
    let unique_threads: std::collections::HashSet<_> =
        response.items.iter().map(|r| r.thread_id).collect();
    assert!(unique_threads.len() <= 2);

    // Should have more results available
    assert!(response.cursor.has_more());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_pagination_cursor(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // First page with limit of 2
    let first_response =
        search_email_contacts(&pool, user_id.clone(), "a".to_string(), 2, None).await?;

    // Count unique threads in first page
    let first_threads: std::collections::HashSet<_> =
        first_response.items.iter().map(|r| r.thread_id).collect();
    assert!(first_threads.len() <= 2);
    assert!(first_response.cursor.has_more());

    // Extract cursor for second page
    let cursor = match first_response.cursor {
        SearchCursorOption::NotDone(c) => c,
        SearchCursorOption::Done => panic!("Expected more results"),
    };

    // Second page using cursor
    let second_response =
        search_email_contacts(&pool, user_id.clone(), "a".to_string(), 2, cursor).await?;

    // Count unique threads in second page
    let second_threads: std::collections::HashSet<_> =
        second_response.items.iter().map(|r| r.thread_id).collect();

    // Verify no overlap between pages
    assert!(first_threads.is_disjoint(&second_threads));

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
    let response = search_email_contacts(&pool, user_id, "Frank".to_string(), 10, None).await?;

    // Should return 0 results (Frank is not accessible to user1)
    assert_eq!(response.items.len(), 0);
    assert!(response.cursor.is_done());

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
    let response =
        search_email_contacts(&pool, user_id, "NonexistentPerson".to_string(), 10, None).await?;

    assert_eq!(response.items.len(), 0);
    assert!(response.cursor.is_done());

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
    let response = search_email_contacts(&pool, user_id, "Alice".to_string(), 10, None).await?;

    assert!(!response.items.is_empty());

    // Check that email address is included
    let alice_result = response
        .items
        .iter()
        .find(|r| r.contact_name.as_deref() == Some("Alice Smith"))
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
    let response =
        search_email_contacts(&pool, user_id.clone(), "Charles".to_string(), 10, None).await?;

    // Should find the message with from_name override
    let charles_match = response
        .items
        .iter()
        .find(|r| r.contact_name.as_deref() == Some("Charles B. Brown"));
    assert!(charles_match.is_some());

    // The returned name should be the from_name (override), not the contact name
    assert_eq!(
        charles_match.unwrap().contact_name.as_deref(),
        Some("Charles B. Brown")
    );

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
    let response = search_email_contacts(&pool, user_id, "Charlie".to_string(), 10, None).await?;

    // Should find thread 3's sender by searching the contact name
    let charlie_from_match = response.items.iter().find(|r| {
        matches!(r.contact_type, ContactType::From)
            && r.thread_id.to_string() == "33333333-3333-3333-3333-333333333333"
    });
    assert!(charlie_from_match.is_some());

    // But the displayed name should still be the from_name override
    assert_eq!(
        charlie_from_match.unwrap().contact_name.as_deref(),
        Some("Charles B. Brown")
    );

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
    let response = search_email_contacts(&pool, user_id, "Robert".to_string(), 10, None).await?;

    // Should find the recipient with name override
    let robert_match = response
        .items
        .iter()
        .find(|r| r.contact_name.as_deref() == Some("Robert J."));
    assert!(robert_match.is_some());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_pagination_by_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "Smith" - matches Alice Smith who appears in:
    // - Thread 1 (Dec 6) as sender and TO recipient
    // - Thread 2 (Dec 5) as TO recipient
    // This ensures we have 2 threads to paginate over

    // Get first thread (limit=1, cursor=None) - should be Thread 1 (most recent)
    let page1 = search_email_contacts(&pool, user_id.clone(), "Smith".to_string(), 1, None).await?;

    // All results on page 1 should be from Thread 1 (the most recent)
    assert!(!page1.items.is_empty());
    let page1_thread_ids: std::collections::HashSet<_> =
        page1.items.iter().map(|r| r.thread_id).collect();
    assert_eq!(page1_thread_ids.len(), 1);
    assert!(
        page1_thread_ids
            .contains(&uuid::Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap())
    );
    assert!(page1.cursor.has_more());

    // Extract cursor for page 2
    let cursor1 = match page1.cursor {
        SearchCursorOption::NotDone(c) => c,
        SearchCursorOption::Done => panic!("Expected more results"),
    };

    // Get second thread using cursor - should be Thread 2 (second most recent)
    let page2 =
        search_email_contacts(&pool, user_id.clone(), "Smith".to_string(), 1, cursor1).await?;

    // All results on page 2 should be from Thread 2
    assert!(!page2.items.is_empty());
    let page2_thread_ids: std::collections::HashSet<_> =
        page2.items.iter().map(|r| r.thread_id).collect();
    assert_eq!(page2_thread_ids.len(), 1);
    assert!(
        page2_thread_ids
            .contains(&uuid::Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap())
    );

    // Verify the two pages return different threads
    assert!(page1_thread_ids.is_disjoint(&page2_thread_ids));

    // Page 2 should indicate no more results since there are only 2 threads matching "Smith"
    assert!(page2.cursor.is_done());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("email_contacts"))
)]
async fn test_search_email_contacts_by_email_address(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "bob.johnson" - should match bob.johnson@example.com
    let response =
        search_email_contacts(&pool, user_id.clone(), "bob.johnson".to_string(), 10, None).await?;

    assert!(!response.items.is_empty());

    // Should find Bob Johnson by email address
    let bob_match = response
        .items
        .iter()
        .find(|r| r.contact_email == "bob.johnson@example.com");
    assert!(bob_match.is_some());

    // Search for partial email domain - should match all @example.com contacts
    let domain_response =
        search_email_contacts(&pool, user_id, "@example.com".to_string(), 10, None).await?;

    assert!(!domain_response.items.is_empty());

    Ok(())
}
