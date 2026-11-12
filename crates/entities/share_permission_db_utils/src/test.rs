use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("team_link_share"))
)]
async fn get_team_default_link_share_returns_the_team_preference(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Note: `team_user` has a unique constraint on `user_id`, so the defensive
    // multi-team tie-break in the query cannot be exercised with fixtures.
    assert_eq!(
        get_team_default_link_share(&pool, "macro|team-scope@user.com").await?,
        Some(TeamLinkShareDefault(Some(LinkShare::Team)))
    );
    assert_eq!(
        get_team_default_link_share(&pool, "macro|public-scope@user.com").await?,
        Some(TeamLinkShareDefault(Some(LinkShare::Public)))
    );
    assert_eq!(
        get_team_default_link_share(&pool, "macro|off-scope@user.com").await?,
        Some(TeamLinkShareDefault(None))
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("team_link_share"))
)]
async fn get_team_default_link_share_returns_none_without_a_team(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert_eq!(
        get_team_default_link_share(&pool, "macro|no-team@user.com").await?,
        None
    );
    assert_eq!(
        get_team_default_link_share(&pool, "macro|unknown@user.com").await?,
        None
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("team_share"))
)]
async fn get_share_permission_id_returns_initiative_share_permission(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert_eq!(
        get_share_permission_id(&pool, "20000000-0000-0000-0000-000000000007", "initiative")
            .await?,
        "initiative"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_share_permission_id_rejects_unsupported_item_type(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let error = get_share_permission_id(&pool, "20000000-0000-0000-0000-000000000007", "reminder")
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "unsupported item type reminder");
    Ok(())
}
