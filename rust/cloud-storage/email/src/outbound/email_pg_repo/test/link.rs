use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_link_by_fusionauth_and_macro_id_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let macro_id = MacroUserIdStr::parse_from_str("macro|user1@test.com")?;
    let link = repo
        .link_by_fusionauth_and_macro_id("fa-user-1", macro_id, UserProvider::Gmail)
        .await?;

    assert!(link.is_some(), "Link should exist");
    let link = link.unwrap();
    assert_eq!(
        link.id,
        Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?
    );
    assert_eq!(link.fusionauth_user_id, "fa-user-1");
    assert_eq!(link.provider, UserProvider::Gmail);
    assert!(link.is_sync_active);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_link_by_fusionauth_and_macro_id_wrong_fusionauth(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let macro_id = MacroUserIdStr::parse_from_str("macro|user1@test.com")?;
    let link = repo
        .link_by_fusionauth_and_macro_id("nonexistent-fa-user", macro_id, UserProvider::Gmail)
        .await?;

    assert!(
        link.is_none(),
        "Wrong fusionauth_user_id should return None"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_link_by_fusionauth_and_macro_id_wrong_macro_id(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let macro_id = MacroUserIdStr::parse_from_str("macro|other@test.com")?;
    let link = repo
        .link_by_fusionauth_and_macro_id("fa-user-1", macro_id, UserProvider::Gmail)
        .await?;

    assert!(link.is_none(), "Wrong macro_id should return None");

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_links_by_fusionauth_user_id_returns_all_owned_inboxes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
        VALUES
            ('a1000000-0000-0000-0000-000000000001'::uuid, 'macro|alice@test.com', 'fa-alice', 'alice@test.com', 'GMAIL', true, NOW() - INTERVAL '1 hour', NOW()),
            ('a2000000-0000-0000-0000-000000000002'::uuid, 'macro|alice@test.com', 'fa-alice', 'alice.work@test.com', 'GMAIL', true, NOW(), NOW()),
            ('b1000000-0000-0000-0000-000000000001'::uuid, 'macro|bob@test.com', 'fa-bob', 'bob@test.com', 'GMAIL', true, NOW(), NOW())
        "#,
    )
    .execute(&pool)
    .await?;

    let repo = EmailPgRepo::new(pool);
    let links = repo.links_by_fusionauth_user_id("fa-alice").await?;

    assert_eq!(links.len(), 2, "should return both of fa-alice's inboxes");
    // ordered by created_at DESC: the newer work inbox comes first
    assert_eq!(links[0].email_address.0.as_ref(), "alice.work@test.com");
    assert_eq!(links[1].email_address.0.as_ref(), "alice@test.com");
    assert!(links.iter().all(|l| l.fusionauth_user_id == "fa-alice"));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_links_by_fusionauth_user_id_empty_when_no_inboxes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let links = repo.links_by_fusionauth_user_id("fa-nobody").await?;
    assert!(
        links.is_empty(),
        "user with no inboxes should yield empty vec"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_link_by_fusionauth_email_provider_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link = repo
        .link_by_fusionauth_email_provider("fa-user-1", "user1@test.com", UserProvider::Gmail)
        .await?;

    assert!(link.is_some(), "Link should exist for the fixture row");
    let link = link.unwrap();
    assert_eq!(link.fusionauth_user_id, "fa-user-1");
    assert_eq!(link.email_address.0.as_ref(), "user1@test.com");
    assert_eq!(link.provider, UserProvider::Gmail);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_link_by_fusionauth_email_provider_wrong_email(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link = repo
        .link_by_fusionauth_email_provider("fa-user-1", "unknown@test.com", UserProvider::Gmail)
        .await?;

    assert!(link.is_none(), "Wrong email should return None");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_link_by_fusionauth_email_provider_wrong_fusionauth(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link = repo
        .link_by_fusionauth_email_provider(
            "nonexistent-fa-user",
            "user1@test.com",
            UserProvider::Gmail,
        )
        .await?;

    assert!(
        link.is_none(),
        "Wrong fusionauth_user_id should return None"
    );

    Ok(())
}
