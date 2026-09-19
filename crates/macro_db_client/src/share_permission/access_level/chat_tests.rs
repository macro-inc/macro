use super::*;

async fn configure_team_link_access(pool: &sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO team (id, name, owner_id)
        VALUES
            ('dddddddd-dddd-dddd-dddd-000000000001', 'Chat owner team', 'user-1'),
            ('dddddddd-dddd-dddd-dddd-000000000002', 'Other team', 'user-2')
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES
            ('user-1', 'dddddddd-dddd-dddd-dddd-000000000001', 'owner'),
            ('user-3', 'dddddddd-dddd-dddd-dddd-000000000001', 'member'),
            ('user-2', 'dddddddd-dddd-dddd-dddd-000000000002', 'owner'),
            ('user-public-access-only', 'dddddddd-dddd-dddd-dddd-000000000002', 'member')
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        UPDATE "SharePermission"
        SET "linkShare" = 'TEAM', "linkShareAccessLevel" = 'comment'
        WHERE id = 'sp-public-edit'
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO entity_access (
            entity_id,
            entity_type,
            source_id,
            source_type,
            access_level
        )
        VALUES (
            'cccccccc-cccc-cccc-cccc-000000000001',
            'chat',
            'user-3',
            'user',
            'view'
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

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
async fn test_batch_team_link_access_for_same_team_user(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    configure_team_link_access(&pool).await?;
    let chat_id = "cccccccc-cccc-cccc-cccc-000000000001".to_string();

    let access_levels =
        get_highest_access_level_for_chats(&pool, std::slice::from_ref(&chat_id), "user-3").await?;

    assert_eq!(
        access_levels.get(&chat_id),
        Some(&Some(AccessLevel::Comment)),
        "expected TEAM link access to exceed the user's explicit view access"
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
async fn test_batch_team_link_denies_other_team_user(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    configure_team_link_access(&pool).await?;
    let chat_id = "cccccccc-cccc-cccc-cccc-000000000001".to_string();

    let access_levels = get_highest_access_level_for_chats(
        &pool,
        std::slice::from_ref(&chat_id),
        "user-public-access-only",
    )
    .await?;

    assert_eq!(
        access_levels.get(&chat_id),
        Some(&None),
        "expected no TEAM link access for a user on another team"
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
