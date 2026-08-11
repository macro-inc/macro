use super::*;
use crate::links::get::fetch_link_by_id;
use crate::links::insert::upsert_link;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::link::{Link, UserProvider};
use sqlx::{Pool, Postgres};

async fn insert_test_link(pool: &Pool<Postgres>, email: &str) -> anyhow::Result<Uuid> {
    let link = Link {
        id: macro_uuid::generate_uuid_v7(),
        macro_id: MacroUserIdStr::try_from(format!("macro|{email}"))?,
        fusionauth_user_id: "22222222-2222-2222-2222-222222222222".to_string(),
        email_address: EmailStr::try_from(email.to_string())?,
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    };
    let mut conn = pool.acquire().await?;
    let inserted = upsert_link(&mut conn, link).await?;
    Ok(inserted.id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_needs_reauth_is_edge_triggered(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "edge@reauth.test").await?;

    // First failure flips the flag and reports the transition.
    assert!(set_link_needs_reauth(&pool, id).await?);

    let link = fetch_link_by_id(&pool, id).await?.expect("link exists");
    assert!(link.needs_reauth);
    assert!(link.last_sync_error_at.is_some());

    // A repeat failure does not re-report the transition (so it won't re-notify).
    assert!(!set_link_needs_reauth(&pool, id).await?);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn clear_needs_reauth_resets_health(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "clear@reauth.test").await?;

    set_link_needs_reauth(&pool, id).await?;
    clear_link_needs_reauth(&pool, id).await?;

    let link = fetch_link_by_id(&pool, id).await?.expect("link exists");
    assert!(!link.needs_reauth);
    assert!(link.last_sync_error_at.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_sync_status_skips_row_when_already_set(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "guard@sync.test").await?;

    update_link_sync_status(&pool, id, false).await?;
    let link = fetch_link_by_id(&pool, id).await?.expect("link exists");
    assert!(!link.is_sync_active);

    // A repeat call must not touch the row (updated_at unchanged), so it never
    // waits on a row lock held by an in-flight link deletion.
    update_link_sync_status(&pool, id, false).await?;
    let after = fetch_link_by_id(&pool, id).await?.expect("link exists");
    assert_eq!(after.updated_at, link.updated_at);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_needs_reauth_on_missing_link_is_not_a_transition(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let missing = macro_uuid::generate_uuid_v7();
    assert!(!set_link_needs_reauth(&pool, missing).await?);
    Ok(())
}
