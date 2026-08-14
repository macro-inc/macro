use super::*;

const PUBLIC_DOC: &str = "11111111-1111-1111-1111-111111111111";
const PRIVATE_DOC: &str = "22222222-2222-2222-2222-222222222222";

async fn access_level_for(
    pool: &Pool<Postgres>,
    document_id: &str,
    source_id: &str,
) -> Option<String> {
    let entity_id = macro_uuid::string_to_uuid(document_id).unwrap();
    sqlx::query_scalar!(
        r#"
        SELECT access_level::text as "access_level!"
        FROM entity_access
        WHERE entity_id = $1
          AND entity_type = 'document'
          AND source_type = 'user'
          AND source_id = $2
        "#,
        entity_id,
        source_id,
    )
    .fetch_optional(pool)
    .await
    .unwrap()
}

#[sqlx::test(fixtures(path = "../../fixtures", scripts("share_on_mention")))]
async fn shares_public_link_document_with_mentioned_users(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let mentioned = MacroUserIdStr::try_from("macro|mentioned@user.com".to_string()).unwrap();

    share_link_shared_document_with_mentioned_users(
        &pool,
        PUBLIC_DOC,
        std::slice::from_ref(&mentioned),
    )
    .await?;

    // The mentioned user gets access at the document's link-share access level.
    assert_eq!(
        access_level_for(&pool, PUBLIC_DOC, mentioned.as_ref()).await,
        Some("comment".to_string()),
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../fixtures", scripts("share_on_mention")))]
async fn shares_team_link_document_with_off_team_mentioned_user(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO team (id, name, owner_id)
        VALUES ('33333333-3333-3333-3333-333333333333', 'Owner Team', 'macro|owner@user.com')
        "#,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES (
            'macro|owner@user.com',
            '33333333-3333-3333-3333-333333333333',
            'owner'
        )
        "#,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        UPDATE "SharePermission"
        SET "linkShare" = 'TEAM',
            "linkShareAccessLevel" = 'view'
        WHERE id = 'sp-public'
        "#,
    )
    .execute(&pool)
    .await?;

    // This user has no team_user row and is therefore outside the owner's team.
    let off_team_mentioned =
        MacroUserIdStr::try_from("macro|off-team@user.com".to_string()).unwrap();

    share_link_shared_document_with_mentioned_users(
        &pool,
        PUBLIC_DOC,
        std::slice::from_ref(&off_team_mentioned),
    )
    .await?;

    assert_eq!(
        access_level_for(&pool, PUBLIC_DOC, off_team_mentioned.as_ref()).await,
        Some("view".to_string()),
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../fixtures", scripts("share_on_mention")))]
async fn does_not_share_private_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mentioned = MacroUserIdStr::try_from("macro|mentioned@user.com".to_string()).unwrap();

    share_link_shared_document_with_mentioned_users(
        &pool,
        PRIVATE_DOC,
        std::slice::from_ref(&mentioned),
    )
    .await?;

    // Documents without link sharing are left untouched.
    assert_eq!(
        access_level_for(&pool, PRIVATE_DOC, mentioned.as_ref()).await,
        None,
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../fixtures", scripts("share_on_mention")))]
async fn does_not_downgrade_existing_access(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mentioned = MacroUserIdStr::try_from("macro|mentioned@user.com".to_string()).unwrap();
    let entity_id = macro_uuid::string_to_uuid(PUBLIC_DOC).unwrap();

    // The user already has edit access to the PUBLIC-link document.
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'document', $2, 'user', 'edit')
        "#,
        entity_id,
        mentioned.as_ref(),
    )
    .execute(&pool)
    .await?;

    share_link_shared_document_with_mentioned_users(
        &pool,
        PUBLIC_DOC,
        std::slice::from_ref(&mentioned),
    )
    .await?;

    // The pre-existing (higher) access level is preserved, not clobbered.
    assert_eq!(
        access_level_for(&pool, PUBLIC_DOC, mentioned.as_ref()).await,
        Some("edit".to_string()),
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../fixtures", scripts("share_on_mention")))]
async fn empty_recipients_is_a_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let entity_id = macro_uuid::string_to_uuid(PUBLIC_DOC).unwrap();
    share_link_shared_document_with_mentioned_users(&pool, PUBLIC_DOC, &[]).await?;

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM entity_access WHERE entity_id = $1"#,
        entity_id,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 0);

    Ok(())
}
