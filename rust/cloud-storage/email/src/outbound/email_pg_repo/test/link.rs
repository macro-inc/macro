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
