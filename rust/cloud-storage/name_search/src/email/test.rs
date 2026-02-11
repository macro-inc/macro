//! Tests for email module

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_search_cursor::SearchCursorOption;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_empty_term(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    let result = search_email_subjects(&pool, &user_id, &[], "".to_string(), false, 10, None).await;

    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        NameSearchError::EmptySearchTerm
    ));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_ids_only_with_empty_ids(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    let result =
        search_email_subjects(&pool, &user_id, &[], "invoice".to_string(), true, 10, None).await;

    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        NameSearchError::EmptyIdsWithIdsOnly
    ));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_ids_only_mode(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "invoice" within specific thread IDs
    let thread_ids = vec![
        Uuid::parse_str("11111111-1111-1111-1111-111111111111")?, // Invoice from Q1 2024
        Uuid::parse_str("22222222-2222-2222-2222-222222222222")?, // Monthly Invoice
        Uuid::parse_str("55555555-5555-5555-5555-555555555555")?, // Weekly Update - won't match
    ];

    let response = search_email_subjects(
        &pool,
        &user_id,
        &thread_ids,
        "invoice".to_string(),
        true,
        10,
        None,
    )
    .await?;

    // Should only return the 2 threads that match "invoice" from the provided IDs
    assert_eq!(response.items.len(), 2);

    // Verify results contain expected threads (ordered by latest_non_spam_message_ts DESC)
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(response.items[0].entity_type, SearchEntityType::Emails);
    assert_eq!(
        response.items[0].name,
        "Re: Monthly <macro_em>Invoice</macro_em> - December"
    );

    assert_eq!(
        response.items[1].entity_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        response.items[1].name,
        "<macro_em>Invoice</macro_em> from Q1 2024"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_normal_mode_owned_threads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "invoice" across all user1's email threads
    let response =
        search_email_subjects(&pool, &user_id, &[], "invoice".to_string(), false, 10, None).await?;

    // Should return 3 threads matching "invoice" (2 with "invoice" + 1 with "INVOICE")
    assert_eq!(response.items.len(), 3);

    // Verify ordering by latest_non_spam_message_ts DESC
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "66666666-6666-6666-6666-666666666666"
    );
    assert_eq!(
        response.items[0].name,
        "IMPORTANT: <macro_em>INVOICE</macro_em> DUE"
    );

    assert_eq!(
        response.items[1].entity_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(
        response.items[1].name,
        "Re: Monthly <macro_em>Invoice</macro_em> - December"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_case_insensitive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search with uppercase term should match both lowercase and uppercase subjects
    let response =
        search_email_subjects(&pool, &user_id, &[], "INVOICE".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 3);

    // Search with lowercase term should also match both
    let response =
        search_email_subjects(&pool, &user_id, &[], "invoice".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 3);

    // Search with mixed case
    let response =
        search_email_subjects(&pool, &user_id, &[], "InVoIcE".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 3);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_with_shared_threads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Try to access a thread from user3 by passing its ID
    // In normal mode, even when thread_ids are specified, only threads belonging to
    // the user's link_id are returned. User3's thread belongs to user3's link_id,
    // so it won't be accessible to user1.
    let user3_thread_id = vec![Uuid::parse_str("99999999-9999-9999-9999-999999999999")?];

    let response = search_email_subjects(
        &pool,
        &user_id,
        &user3_thread_id,
        "invoice".to_string(),
        false,
        10,
        None,
    )
    .await?;

    // Should return 0 results because user3's thread doesn't belong to user1's link_id
    // Email isolation is enforced via link_id, not just thread ownership
    assert_eq!(response.items.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_pagination_limit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search with limit of 2
    let response =
        search_email_subjects(&pool, &user_id, &[], "invoice".to_string(), false, 2, None).await?;

    assert_eq!(response.items.len(), 2);

    // Should get the 2 most recently updated threads with "invoice"
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "66666666-6666-6666-6666-666666666666"
    );
    assert_eq!(
        response.items[1].entity_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );

    // Should have a next_cursor since there are more results
    assert!(response.cursor.has_more());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_pagination_cursor(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // First page with limit of 2
    let first_response =
        search_email_subjects(&pool, &user_id, &[], "invoice".to_string(), false, 2, None).await?;

    assert_eq!(first_response.items.len(), 2);
    assert!(first_response.cursor.has_more());

    // Extract cursor for second page
    let cursor = match first_response.cursor {
        SearchCursorOption::NotDone(c) => c,
        SearchCursorOption::Done => panic!("Expected more results"),
    };

    // Second page using cursor
    let second_response = search_email_subjects(
        &pool,
        &user_id,
        &[],
        "invoice".to_string(),
        false,
        2,
        cursor,
    )
    .await?;

    assert_eq!(second_response.items.len(), 1);

    // Should get the next thread (skipping the first 2)
    assert_eq!(
        second_response.items[0].entity_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );

    // Should NOT have next_cursor since we've reached the end
    assert!(second_response.cursor.is_done());

    // Verify no overlap between pages
    let first_ids: Vec<String> = first_response
        .items
        .iter()
        .map(|r| r.entity_id.to_string())
        .collect();
    let second_ids: Vec<String> = second_response
        .items
        .iter()
        .map(|r| r.entity_id.to_string())
        .collect();

    for id in &first_ids {
        assert!(
            !second_ids.contains(id),
            "Found duplicate ID between pages: {}",
            id
        );
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_no_results(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for a term that doesn't match any email subjects
    let response = search_email_subjects(
        &pool,
        &user_id,
        &[],
        "nonexistent".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert_eq!(response.items.len(), 0);
    assert!(response.cursor.is_done());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_partial_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for partial term "meet" should match "meeting"
    let response =
        search_email_subjects(&pool, &user_id, &[], "meet".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 2);
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "44444444-4444-4444-4444-444444444444"
    );
    assert_eq!(
        response.items[0].name,
        "Fwd: Client <macro_em>Meet</macro_em>ing Tomorrow"
    );

    assert_eq!(
        response.items[1].entity_id.to_string(),
        "33333333-3333-3333-3333-333333333333"
    );
    assert_eq!(
        response.items[1].name,
        "Team <macro_em>Meet</macro_em>ing Notes"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_user_isolation(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "User2" - user1 should not see user2's private email threads
    let response =
        search_email_subjects(&pool, &user_id, &[], "User2".to_string(), false, 10, None).await?;

    // Should return 0 results (user2's emails are not linked to user1)
    assert_eq!(response.items.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_searches_oldest_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Thread 22222222 has 3 messages:
    // 1. Oldest (2024-02-01): "Re: Monthly Invoice - December"
    // 2. Middle (2024-02-02): "Re: Re: Monthly Invoice - December"
    // 3. Newest (2024-12-02): "Re: Re: Re: Payment Processed"

    // Searching for "Monthly Invoice" should find the thread because a message matches
    let response = search_email_subjects(
        &pool,
        &user_id,
        &[],
        "Monthly Invoice".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert!(response.items.iter().any(|r| {
        r.entity_id
            .to_string()
            .eq("22222222-2222-2222-2222-222222222222")
    }));

    // Searching for "Payment Processed" should also find it because we search all messages in the thread
    let response = search_email_subjects(
        &pool,
        &user_id,
        &[],
        "Payment Processed".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert!(response.items.iter().any(|r| {
        r.entity_id
            .to_string()
            .eq("22222222-2222-2222-2222-222222222222")
    }));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("email"))
)]
async fn test_search_email_subjects_multiple_messages_per_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Thread 11111111 has multiple messages - should return thread only once with oldest subject
    let response =
        search_email_subjects(&pool, &user_id, &[], "invoice".to_string(), false, 10, None).await?;

    // Count how many times thread 11111111 appears (should be exactly once)
    let count = response
        .items
        .iter()
        .filter(|r| {
            r.entity_id
                .to_string()
                .eq("11111111-1111-1111-1111-111111111111")
        })
        .count();
    assert_eq!(count, 1);

    // Verify it returns the oldest message's subject
    let thread_result = response
        .items
        .iter()
        .find(|r| {
            r.entity_id
                .to_string()
                .eq("11111111-1111-1111-1111-111111111111")
        })
        .unwrap();
    assert_eq!(
        thread_result.name,
        "<macro_em>Invoice</macro_em> from Q1 2024"
    );

    Ok(())
}
