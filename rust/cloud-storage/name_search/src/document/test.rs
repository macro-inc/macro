//! Tests for document module

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_empty_term(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    let result = search_document_names(&pool, &user_id, &[], "".to_string(), false, 10, None).await;

    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        NameSearchError::EmptySearchTerm
    ));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_ids_only_with_empty_ids(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    let result =
        search_document_names(&pool, &user_id, &[], "report".to_string(), true, 10, None).await;

    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        NameSearchError::EmptyIdsWithIdsOnly
    ));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_ids_only_mode(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "report" within specific document IDs
    let doc_ids = vec![
        Uuid::parse_str("11111111-1111-1111-1111-111111111111")?,
        Uuid::parse_str("22222222-2222-2222-2222-222222222222")?,
        Uuid::parse_str("66666666-6666-6666-6666-666666666666")?, // Budget Analysis - won't match
    ];

    let response = search_document_names(
        &pool,
        &user_id,
        &doc_ids,
        "report".to_string(),
        true,
        10,
        None,
    )
    .await?;

    // Should only return the 2 documents that match "report" from the provided IDs
    assert_eq!(response.items.len(), 2);

    // Verify results contain expected documents (ordered by updatedAt DESC)
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(response.items[0].entity_type, SearchEntityType::Documents);
    assert_eq!(
        response.items[0].name,
        "Sales <macro_em>Report</macro_em> December"
    );

    assert_eq!(
        response.items[1].entity_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        response.items[1].name,
        "Quarterly <macro_em>Report</macro_em> 2024"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_normal_mode_owned_documents(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "report" across all user1's owned documents
    let response =
        search_document_names(&pool, &user_id, &[], "report".to_string(), false, 10, None).await?;

    // Should return 4 documents matching "report" (3 lowercase + 1 uppercase)
    assert_eq!(response.items.len(), 4);

    // Verify ordering by updatedAt DESC
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "88888888-8888-8888-8888-888888888888"
    );
    assert_eq!(
        response.items[0].name,
        "ANNUAL <macro_em>REPORT</macro_em> 2024"
    );

    assert_eq!(
        response.items[1].entity_id.to_string(),
        "33333333-3333-3333-3333-333333333333"
    );
    assert_eq!(
        response.items[1].name,
        "Financial <macro_em>Report</macro_em> Q3"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_case_insensitive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search with uppercase term should match both lowercase and uppercase names
    let response =
        search_document_names(&pool, &user_id, &[], "REPORT".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 4);

    // Search with lowercase term should also match both
    let response =
        search_document_names(&pool, &user_id, &[], "report".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 4);

    // Search with mixed case
    let response =
        search_document_names(&pool, &user_id, &[], "RePoRt".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 4);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_with_shared_documents(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Include a document from user3 (shared via document_ids parameter)
    let shared_doc_ids = vec![Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?];

    let response = search_document_names(
        &pool,
        &user_id,
        &shared_doc_ids,
        "report".to_string(),
        false,
        10,
        None,
    )
    .await?;

    // Should return user1's 4 "report" documents + user3's 1 "report" document
    assert_eq!(response.items.len(), 5);

    // Verify user3's document is included
    let user3_doc = response.items.iter().find(|r| {
        r.entity_id
            .to_string()
            .eq("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    });
    assert!(user3_doc.is_some());
    assert_eq!(
        user3_doc.unwrap().name,
        "User3 <macro_em>Report</macro_em> Shared"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_pagination_limit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search with limit of 2
    let response =
        search_document_names(&pool, &user_id, &[], "report".to_string(), false, 2, None).await?;

    assert_eq!(response.items.len(), 2);

    // Should get the 2 most recently updated documents with "report"
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "88888888-8888-8888-8888-888888888888"
    );
    assert_eq!(
        response.items[1].entity_id.to_string(),
        "33333333-3333-3333-3333-333333333333"
    );

    // Should have a next_cursor since there are more results
    assert!(response.cursor.has_more());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_pagination_cursor(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // First page with limit of 2
    let first_response =
        search_document_names(&pool, &user_id, &[], "report".to_string(), false, 2, None).await?;

    assert_eq!(first_response.items.len(), 2);
    assert!(first_response.cursor.has_more());

    // Extract cursor for second page
    let cursor = match first_response.cursor {
        SearchCursorOption::NotDone(c) => c,
        SearchCursorOption::Done => panic!("Expected more results"),
    };

    // Second page using cursor
    let second_response =
        search_document_names(&pool, &user_id, &[], "report".to_string(), false, 2, cursor).await?;

    assert_eq!(second_response.items.len(), 2);

    // Should get the next 2 documents (skipping the first 2)
    assert_eq!(
        second_response.items[0].entity_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(
        second_response.items[1].entity_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );

    // Should NOT have next_cursor since we've reached the end (fetched limit+1, got only 2)
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
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_no_results(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for a term that doesn't match any documents
    let response = search_document_names(
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
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_partial_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for partial term "meet" should match "meeting"
    let response =
        search_document_names(&pool, &user_id, &[], "meet".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 2);
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "55555555-5555-5555-5555-555555555555"
    );
    assert_eq!(
        response.items[0].name,
        "Client <macro_em>Meet</macro_em>ing Agenda"
    );

    assert_eq!(
        response.items[1].entity_id.to_string(),
        "44444444-4444-4444-4444-444444444444"
    );
    assert_eq!(
        response.items[1].name,
        "Team <macro_em>Meet</macro_em>ing Notes"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_user_isolation(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "User2" - user1 should not see user2's private documents
    let response =
        search_document_names(&pool, &user_id, &[], "User2".to_string(), false, 10, None).await?;

    // Should return 0 results (user2's documents are not owned by user1 and not shared)
    assert_eq!(response.items.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_rejects_thread_cursor(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    let cursor = SearchMethodCursor::Thread {
        thread_id: Uuid::new_v4(),
        message_id: Uuid::new_v4(),
    };

    let result = search_document_names(
        &pool,
        &user_id,
        &[],
        "test".to_string(),
        false,
        10,
        Some(cursor),
    )
    .await;

    assert!(matches!(
        result.unwrap_err(),
        NameSearchError::IncompatibleCursor
    ));

    Ok(())
}
