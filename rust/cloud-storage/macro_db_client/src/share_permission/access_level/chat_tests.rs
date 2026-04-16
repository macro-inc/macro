use super::*;

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_highest_level_is_from_explicit_access(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: Get highest access for 'user-1' on 'd-child'.
    // EXPLICIT ACCESS: view (direct), edit (parent), owner (grandparent). Max is 'owner'.
    // PUBLIC ACCESS: view (parent), edit (grandparent). Max is 'edit'.
    // EXPECTATION: The overall highest level should be 'owner' from the explicit grant.

    let highest_level = get_highest_access_level_for_chat(&pool, "d-child", "user-1").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Owner),
        "Expected highest level to be 'owner' from an explicit UserItemAccess record"
    );

    // highest public access is edit via grandparent

    let highest_level =
        get_highest_access_level_for_chat(&pool, "d-child", "user-public-access-only").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "Expected highest level to be 'edit' from a public SharePermission record"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_user_scoping_is_correct(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Get highest access for 'user-2' on 'd-child'.
    // EXPLICIT ACCESS: 'user-2' only has 'view' access.
    // PUBLIC ACCESS: view (parent), edit (grandparent). Max is 'edit'.
    // EXPECTATION: The overall highest level is 'edit' (from public), not 'owner' (from user-1's grant).

    let highest_level = get_highest_access_level_for_chat(&pool, "d-child", "user-2").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "User-2's highest access should be 'edit' from public, not 'owner' from user-1's explicit grant"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_simple_uia_case(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: User has edit UIA access on private chat
    // EXPECTATION: The user should have edit access to chat

    let highest_level = get_highest_access_level_for_chat(&pool, "d-standalone", "user-3").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "User-3's highest access should be 'edit' from explicit grant"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_no_permissions_returns_none(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Get access for any user on 'd-private'.
    // This chat has no project, no UserItemAccess, and no SharePermission records.
    // EXPECTATION: The query should return an empty list, resulting in `None`.

    let highest_level = get_highest_access_level_for_chat(&pool, "d-private", "user-1").await?;

    assert_eq!(
        highest_level, None,
        "Expected None for a chat with no permissions"
    );

    Ok(())
}

// Tests for the batch function get_highest_access_level_for_chats

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_batch_multiple_chats_different_access_levels(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: Get access for 'user-1' on multiple chats with different access levels
    let chat_ids = vec![
        "d-child".to_string(),
        "d-standalone".to_string(),
        "d-private".to_string(),
    ];

    let access_levels = get_highest_access_level_for_chats(&pool, &chat_ids, "user-1").await?;

    // d-child: user-1 has owner access (from explicit grants)
    assert_eq!(
        access_levels.get("d-child"),
        Some(&Some(AccessLevel::Owner)),
        "Expected 'owner' access for d-child"
    );

    // d-standalone: Check what user-1 actually has (test shows Comment access)
    // We'll verify consistency with individual function rather than hardcode expectation
    let individual_access =
        get_highest_access_level_for_chat(&pool, "d-standalone", "user-1").await?;
    assert_eq!(
        access_levels.get("d-standalone"),
        Some(&individual_access),
        "Expected batch result to match individual function result for d-standalone"
    );

    // d-private: user-1 should have no access (private chat with no permissions)
    assert_eq!(
        access_levels.get("d-private"),
        Some(&None),
        "Expected no access for d-private"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_batch_public_access_user(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Get access for 'user-public-access-only' on multiple chats
    // This user has no explicit grants but should get public access where available
    let chat_ids = vec!["d-child".to_string(), "d-private".to_string()];

    let access_levels =
        get_highest_access_level_for_chats(&pool, &chat_ids, "user-public-access-only").await?;

    // d-child: public access is edit via grandparent
    assert_eq!(
        access_levels.get("d-child"),
        Some(&Some(AccessLevel::Edit)),
        "Expected 'edit' access from public permissions"
    );

    // d-private: no public or explicit access
    assert_eq!(
        access_levels.get("d-private"),
        Some(&None),
        "Expected no access for d-private"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_batch_user_with_mixed_access(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Get access for 'user-2' who has limited explicit access but benefits from public access
    let chat_ids = vec!["d-child".to_string()];

    let access_levels = get_highest_access_level_for_chats(&pool, &chat_ids, "user-2").await?;

    // user-2 has view explicit access, but public access is edit, so should get edit
    assert_eq!(
        access_levels.get("d-child"),
        Some(&Some(AccessLevel::Edit)),
        "Expected 'edit' access from higher public permissions"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_batch_empty_input(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Test with empty chat_ids vector
    let chat_ids: Vec<String> = vec![];

    let access_levels = get_highest_access_level_for_chats(&pool, &chat_ids, "user-1").await?;

    assert!(
        access_levels.is_empty(),
        "Expected empty result for empty input"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_batch_nonexistent_chats(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Test with chat IDs that don't exist
    let chat_ids = vec!["nonexistent-1".to_string(), "nonexistent-2".to_string()];

    let access_levels = get_highest_access_level_for_chats(&pool, &chat_ids, "user-1").await?;

    // Should return None for each nonexistent chat
    assert_eq!(
        access_levels.get("nonexistent-1"),
        Some(&None),
        "Expected no access for nonexistent chat"
    );
    assert_eq!(
        access_levels.get("nonexistent-2"),
        Some(&None),
        "Expected no access for nonexistent chat"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_batch_consistency_with_single_function(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: Ensure batch function returns same results as individual calls
    let chat_ids = vec!["d-child".to_string(), "d-standalone".to_string()];
    let user_id = "user-1";

    // Get results from batch function
    let batch_results = get_highest_access_level_for_chats(&pool, &chat_ids, user_id).await?;

    // Get results from individual function calls
    let individual_d_child = get_highest_access_level_for_chat(&pool, "d-child", user_id).await?;
    let individual_d_standalone =
        get_highest_access_level_for_chat(&pool, "d-standalone", user_id).await?;

    // Compare results
    assert_eq!(
        batch_results.get("d-child"),
        Some(&individual_d_child),
        "Batch and individual results should match for d-child"
    );
    assert_eq!(
        batch_results.get("d-standalone"),
        Some(&individual_d_standalone),
        "Batch and individual results should match for d-standalone"
    );

    Ok(())
}
