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
async fn test_inboxes_for_macro_id_includes_own_and_delegated(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // macro_user_links FK-references "User" (which FK-references macro_user), so
    // the delegating and delegated accounts must exist as real users.
    sqlx::query(
        r#"
        INSERT INTO "macro_user" (id, username, email, stripe_customer_id) VALUES
            ('c1000000-0000-0000-0000-000000000001', 'alice', 'alice@test.com', 'stripe_alice'),
            ('c2000000-0000-0000-0000-000000000002', 'shared', 'shared@test.com', 'stripe_shared')
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, name, macro_user_id) VALUES
            ('macro|alice@test.com', 'alice@test.com', 'Alice', 'c1000000-0000-0000-0000-000000000001'),
            ('macro|shared@test.com', 'shared@test.com', 'Shared Inbox', 'c2000000-0000-0000-0000-000000000002')
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at) VALUES
            ('a1000000-0000-0000-0000-000000000001'::uuid, 'macro|alice@test.com', 'fa-alice', 'alice@test.com', 'GMAIL', true, NOW() - INTERVAL '2 hours', NOW()),
            ('a2000000-0000-0000-0000-000000000002'::uuid, 'macro|alice@test.com', 'fa-alice', 'alice.work@test.com', 'GMAIL', true, NOW() - INTERVAL '1 hour', NOW()),
            ('5e000000-0000-0000-0000-000000000003'::uuid, 'macro|shared@test.com', 'fa-shared', 'shared@test.com', 'GMAIL', true, NOW(), NOW()),
            ('5f000000-0000-0000-0000-000000000005'::uuid, 'macro|shared@test.com', 'fa-shared', 'shared.other@test.com', 'GMAIL', true, NOW(), NOW()),
            ('b0000000-0000-0000-0000-000000000004'::uuid, 'macro|bob@test.com', 'fa-bob', 'bob@test.com', 'GMAIL', true, NOW(), NOW())
        "#,
    )
    .execute(&pool)
    .await?;

    // alice is the primary; only shared@'s first inbox is delegated to her.
    // bob is unrelated.
    sqlx::query(
        r#"
        INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES
            ('macro|alice@test.com', 'macro|shared@test.com', '5e000000-0000-0000-0000-000000000003'::uuid)
        "#,
    )
    .execute(&pool)
    .await?;

    let repo = EmailPgRepo::new(pool);
    let macro_id = MacroUserIdStr::parse_from_str("macro|alice@test.com")?;
    let links = repo.inboxes_for_macro_id(macro_id).await?;

    let emails: std::collections::HashSet<&str> =
        links.iter().map(|l| l.email_address.0.as_ref()).collect();

    assert_eq!(
        links.len(),
        3,
        "alice's two own inboxes plus the one delegated inbox"
    );
    assert!(emails.contains("alice@test.com"));
    assert!(emails.contains("alice.work@test.com"));
    assert!(
        emails.contains("shared@test.com"),
        "delegated inbox must be included"
    );
    assert!(
        !emails.contains("shared.other@test.com"),
        "child's inbox outside the link-scoped grant must be excluded"
    );
    assert!(
        !emails.contains("bob@test.com"),
        "unrelated inbox must be excluded"
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_owned_link_for_thread_resolves_own_and_delegated(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // macro_user_links FK-references "User" (which FK-references macro_user).
    sqlx::query(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
            ('d1000000-0000-0000-0000-000000000001'::uuid, 'child', 'child@test.com', 'stripe_child'),
            ('d2000000-0000-0000-0000-000000000002'::uuid, 'primary', 'primary@test.com', 'stripe_primary'),
            ('d3000000-0000-0000-0000-000000000003'::uuid, 'stranger', 'stranger@test.com', 'stripe_stranger')
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, macro_user_id) VALUES
            ('macro|child@test.com', 'child@test.com', 'd1000000-0000-0000-0000-000000000001'::uuid),
            ('macro|primary@test.com', 'primary@test.com', 'd2000000-0000-0000-0000-000000000002'::uuid),
            ('macro|stranger@test.com', 'stranger@test.com', 'd3000000-0000-0000-0000-000000000003'::uuid)
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at) VALUES
            ('c0000000-0000-0000-0000-000000000001'::uuid, 'macro|child@test.com', 'fa-child', 'child@test.com', 'GMAIL', true, NOW(), NOW())
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"INSERT INTO email_threads (id, link_id)
           VALUES ('c0000000-0000-0000-0000-0000000000ff'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid)"#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
           VALUES ('macro|primary@test.com', 'macro|child@test.com', 'c0000000-0000-0000-0000-000000000001'::uuid)"#,
    )
    .execute(&pool)
    .await?;

    let repo = EmailPgRepo::new(pool);
    let thread_id = Uuid::parse_str("c0000000-0000-0000-0000-0000000000ff")?;
    let link_id = Uuid::parse_str("c0000000-0000-0000-0000-000000000001")?;

    // delegate resolves the shared inbox
    let delegated = repo
        .owned_link_for_thread(
            thread_id,
            MacroUserIdStr::parse_from_str("macro|primary@test.com")?,
        )
        .await?;
    assert_eq!(delegated.map(|l| l.id), Some(link_id));

    // owner resolves their own inbox
    let owned = repo
        .owned_link_for_thread(
            thread_id,
            MacroUserIdStr::parse_from_str("macro|child@test.com")?,
        )
        .await?;
    assert_eq!(owned.map(|l| l.id), Some(link_id));

    // an unrelated but real user resolves nothing
    let none = repo
        .owned_link_for_thread(
            thread_id,
            MacroUserIdStr::parse_from_str("macro|stranger@test.com")?,
        )
        .await?;
    assert!(none.is_none());

    Ok(())
}
