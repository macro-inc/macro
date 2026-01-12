//! Tests for project module

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_search_cursor::SearchCursorOption;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_empty_term(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    let result = search_project_names(&pool, &user_id, &[], "".to_string(), false, 10, None).await;

    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        NameSearchError::EmptySearchTerm
    ));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_ids_only_with_empty_ids(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    let result =
        search_project_names(&pool, &user_id, &[], "mobile".to_string(), true, 10, None).await;

    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        NameSearchError::EmptyIdsWithIdsOnly
    ));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_ids_only_mode(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "mobile" within specific project IDs
    let project_ids = vec![
        Uuid::parse_str("11111111-1111-1111-1111-111111111111")?,
        Uuid::parse_str("22222222-2222-2222-2222-222222222222")?,
        Uuid::parse_str("55555555-5555-5555-5555-555555555555")?, // Marketing Campaign - won't match
    ];

    let response = search_project_names(
        &pool,
        &user_id,
        &project_ids,
        "mobile".to_string(),
        true,
        10,
        None,
    )
    .await?;

    // Should only return the 2 projects that match "mobile" from the provided IDs
    assert_eq!(response.items.len(), 2);

    // Verify results contain expected projects (ordered by updatedAt DESC)
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(response.items[0].entity_type, SearchEntityType::Projects);
    assert_eq!(
        response.items[0].name,
        "<macro_em>Mobile</macro_em> App Redesign"
    );

    assert_eq!(
        response.items[1].entity_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        response.items[1].name,
        "<macro_em>Mobile</macro_em> Development"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_normal_mode_owned_projects(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "mobile" across all user1's owned projects
    let response =
        search_project_names(&pool, &user_id, &[], "mobile".to_string(), false, 10, None).await?;

    // Should return 3 projects matching "mobile" (2 lowercase + 1 uppercase)
    assert_eq!(response.items.len(), 3);

    // Verify ordering by updatedAt DESC
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "66666666-6666-6666-6666-666666666666"
    );
    assert_eq!(
        response.items[0].name,
        "<macro_em>MOBILE</macro_em> PLATFORM"
    );

    assert_eq!(
        response.items[1].entity_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(
        response.items[1].name,
        "<macro_em>Mobile</macro_em> App Redesign"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_case_insensitive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search with uppercase term should match both lowercase and uppercase names
    let response =
        search_project_names(&pool, &user_id, &[], "MOBILE".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 3);

    // Search with lowercase term should also match both
    let response =
        search_project_names(&pool, &user_id, &[], "mobile".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 3);

    // Search with mixed case
    let response =
        search_project_names(&pool, &user_id, &[], "MoBiLe".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 3);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_with_shared_projects(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Include a project from user3 (shared via project_ids parameter)
    let shared_project_ids = vec![Uuid::parse_str("99999999-9999-9999-9999-999999999999")?];

    let response = search_project_names(
        &pool,
        &user_id,
        &shared_project_ids,
        "mobile".to_string(),
        false,
        10,
        None,
    )
    .await?;

    // Should return user1's 3 "mobile" projects + user3's 1 "mobile" project
    assert_eq!(response.items.len(), 4);

    // Verify user3's project is included
    let user3_project = response.items.iter().find(|r| {
        r.entity_id
            .to_string()
            .eq("99999999-9999-9999-9999-999999999999")
    });
    assert!(user3_project.is_some());
    assert_eq!(
        user3_project.unwrap().name,
        "User3 Shared <macro_em>Mobile</macro_em>"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_pagination_limit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search with limit of 2
    let response =
        search_project_names(&pool, &user_id, &[], "mobile".to_string(), false, 2, None).await?;

    assert_eq!(response.items.len(), 2);

    // Should get the 2 most recently updated projects with "mobile"
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
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_pagination_cursor(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // First page with limit of 2
    let first_response =
        search_project_names(&pool, &user_id, &[], "mobile".to_string(), false, 2, None).await?;

    assert_eq!(first_response.items.len(), 2);
    assert!(first_response.cursor.has_more());

    // Extract cursor for second page
    let cursor = match first_response.cursor {
        SearchCursorOption::NotDone(c) => c,
        SearchCursorOption::Done => panic!("Expected more results"),
    };

    // Second page using cursor
    let second_response =
        search_project_names(&pool, &user_id, &[], "mobile".to_string(), false, 2, cursor).await?;

    assert_eq!(second_response.items.len(), 1);

    // Should get the next project (skipping the first 2)
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
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_no_results(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for a term that doesn't match any projects
    let response = search_project_names(
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
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_partial_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for partial term "web" should match "website"
    let response =
        search_project_names(&pool, &user_id, &[], "web".to_string(), false, 10, None).await?;

    assert_eq!(response.items.len(), 2);
    assert_eq!(
        response.items[0].entity_id.to_string(),
        "44444444-4444-4444-4444-444444444444"
    );
    assert_eq!(
        response.items[0].name,
        "<macro_em>Web</macro_em>site Optimization"
    );

    assert_eq!(
        response.items[1].entity_id.to_string(),
        "33333333-3333-3333-3333-333333333333"
    );
    assert_eq!(
        response.items[1].name,
        "<macro_em>Web</macro_em> Platform Upgrade"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_user_isolation(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "User2" - user1 should not see user2's private projects
    let response =
        search_project_names(&pool, &user_id, &[], "User2".to_string(), false, 10, None).await?;

    // Should return 0 results (user2's projects are not owned by user1 and not shared)
    assert_eq!(response.items.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("project"))
)]
async fn test_search_project_names_excludes_soft_deleted(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user1@test.com")
        .map(|l| l.lowercase())
        .unwrap();

    // Search for "mobile" - should NOT include soft-deleted project
    let response =
        search_project_names(&pool, &user_id, &[], "mobile".to_string(), false, 10, None).await?;

    // Should NOT include the deleted project (id: 77777777-7777-7777-7777-777777777777)
    assert!(!response.items.iter().any(|r| {
        r.entity_id
            .to_string()
            .eq("77777777-7777-7777-7777-777777777777")
    }));

    // Should include non-deleted projects
    assert!(response.items.iter().any(|r| {
        r.entity_id
            .to_string()
            .eq("11111111-1111-1111-1111-111111111111")
    }));

    Ok(())
}
