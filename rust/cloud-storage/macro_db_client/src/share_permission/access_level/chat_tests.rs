use super::*;

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_batch_public_access_user(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Get access for 'user-public-access-only' on multiple chats
    // This user has no explicit grants but should get public access where available
    let chat_ids = vec![
        "cccccccc-cccc-cccc-cccc-000000000001".to_string(),
        "cccccccc-cccc-cccc-cccc-000000000003".to_string(),
    ];

    let access_levels =
        get_highest_access_level_for_chats(&pool, &chat_ids, "user-public-access-only").await?;

    // d-child: public access is edit via grandparent
    assert_eq!(
        access_levels.get("cccccccc-cccc-cccc-cccc-000000000001"),
        Some(&Some(AccessLevel::Edit)),
        "Expected 'edit' access from public permissions"
    );

    // d-private: no public or explicit access
    assert_eq!(
        access_levels.get("cccccccc-cccc-cccc-cccc-000000000003"),
        Some(&None),
        "Expected no access for d-private"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_batch_user_with_mixed_access(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Get access for 'user-2' who has limited explicit access but benefits from public access
    let chat_ids = vec!["cccccccc-cccc-cccc-cccc-000000000001".to_string()];

    let access_levels = get_highest_access_level_for_chats(&pool, &chat_ids, "user-2").await?;

    // user-2 has view explicit access, but public access is edit, so should get edit
    assert_eq!(
        access_levels.get("cccccccc-cccc-cccc-cccc-000000000001"),
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
