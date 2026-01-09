//! Tests for document module

use macro_db_migrator::MACRO_DB_MIGRATIONS;
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

    let result = search_document_names(&pool, &user_id, &[], "".to_string(), false, 10, 0).await;

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
        search_document_names(&pool, &user_id, &[], "report".to_string(), true, 10, 0).await;

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

    let results =
        search_document_names(&pool, &user_id, &doc_ids, "report".to_string(), true, 10, 0).await?;

    // Should only return the 2 documents that match "report" from the provided IDs
    assert_eq!(results.len(), 2);

    // Verify results contain expected documents (ordered by updatedAt DESC)
    assert_eq!(
        results[0].entity_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(results[0].entity_type, SearchEntityType::Documents);
    assert_eq!(results[0].name, "Sales Report December");

    assert_eq!(
        results[1].entity_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(results[1].name, "Quarterly Report 2024");

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
    let results =
        search_document_names(&pool, &user_id, &[], "report".to_string(), false, 10, 0).await?;

    // Should return 4 documents matching "report" (3 lowercase + 1 uppercase)
    assert_eq!(results.len(), 4);

    // Verify ordering by updatedAt DESC
    assert_eq!(
        results[0].entity_id.to_string(),
        "88888888-8888-8888-8888-888888888888"
    );
    assert_eq!(results[0].name, "ANNUAL REPORT 2024");

    assert_eq!(
        results[1].entity_id.to_string(),
        "33333333-3333-3333-3333-333333333333"
    );
    assert_eq!(results[1].name, "Financial Report Q3");

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
    let results =
        search_document_names(&pool, &user_id, &[], "REPORT".to_string(), false, 10, 0).await?;

    assert_eq!(results.len(), 4);

    // Search with lowercase term should also match both
    let results =
        search_document_names(&pool, &user_id, &[], "report".to_string(), false, 10, 0).await?;

    assert_eq!(results.len(), 4);

    // Search with mixed case
    let results =
        search_document_names(&pool, &user_id, &[], "RePoRt".to_string(), false, 10, 0).await?;

    assert_eq!(results.len(), 4);

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

    let results = search_document_names(
        &pool,
        &user_id,
        &shared_doc_ids,
        "report".to_string(),
        false,
        10,
        0,
    )
    .await?;

    // Should return user1's 4 "report" documents + user3's 1 "report" document
    assert_eq!(results.len(), 5);

    // Verify user3's document is included
    let user3_doc = results.iter().find(|r| {
        r.entity_id
            .to_string()
            .eq("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    });
    assert!(user3_doc.is_some());
    assert_eq!(user3_doc.unwrap().name, "User3 Report Shared");

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
    let results =
        search_document_names(&pool, &user_id, &[], "report".to_string(), false, 2, 0).await?;

    assert_eq!(results.len(), 2);

    // Should get the 2 most recently updated documents with "report"
    assert_eq!(
        results[0].entity_id.to_string(),
        "88888888-8888-8888-8888-888888888888"
    );
    assert_eq!(
        results[1].entity_id.to_string(),
        "33333333-3333-3333-3333-333333333333"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("document"))
)]
async fn test_search_document_names_pagination_offset(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search with offset of 2
    let results =
        search_document_names(&pool, &user_id, &[], "report".to_string(), false, 10, 2).await?;

    assert_eq!(results.len(), 2);

    // Should skip the first 2 and get the next 2
    assert_eq!(
        results[0].entity_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(
        results[1].entity_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );

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
    let results = search_document_names(
        &pool,
        &user_id,
        &[],
        "nonexistent".to_string(),
        false,
        10,
        0,
    )
    .await?;

    assert_eq!(results.len(), 0);

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
    let results =
        search_document_names(&pool, &user_id, &[], "meet".to_string(), false, 10, 0).await?;

    assert_eq!(results.len(), 2);
    assert_eq!(
        results[0].entity_id.to_string(),
        "55555555-5555-5555-5555-555555555555"
    );
    assert_eq!(results[0].name, "Client Meeting Agenda");

    assert_eq!(
        results[1].entity_id.to_string(),
        "44444444-4444-4444-4444-444444444444"
    );
    assert_eq!(results[1].name, "Team Meeting Notes");

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
    let results =
        search_document_names(&pool, &user_id, &[], "User2".to_string(), false, 10, 0).await?;

    // Should return 0 results (user2's documents are not owned by user1 and not shared)
    assert_eq!(results.len(), 0);

    Ok(())
}
