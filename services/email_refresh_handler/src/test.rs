use crate::outbound::postgres::{
    fetch_inactive_link_ids, fetch_ownerless_link_ids, fetch_unused_link_ids,
};
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_returns_unused_links(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    // Link created 40 days ago with no history should be returned (threshold: 30 days)
    let result = fetch_unused_link_ids(&pool, 30).await?;

    let unused_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    assert!(
        result.contains(&unused_link_id),
        "Should include link with no history older than threshold"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_returns_stale_history_links(pool: Pool<Postgres>) -> Result<()> {
    // Link with history last updated 90 days ago should be returned (threshold: 60 days)
    let result = fetch_inactive_link_ids(&pool, 60).await?;

    let stale_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000002")?;
    assert!(
        result.contains(&stale_link_id),
        "Should include link with stale history"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_excludes_active_links(pool: Pool<Postgres>) -> Result<()> {
    let unused_result = fetch_unused_link_ids(&pool, 30).await?;
    let inactive_result = fetch_inactive_link_ids(&pool, 60).await?;

    // Link with recent history should NOT be returned
    let active_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000003")?;
    assert!(
        !unused_result.contains(&active_link_id) && !inactive_result.contains(&active_link_id),
        "Should not include link with recent history"
    );

    // Recently created link with no history should NOT be returned
    let new_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000004")?;
    assert!(
        !unused_result.contains(&new_link_id) && !inactive_result.contains(&new_link_id),
        "Should not include recently created link"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_excludes_macro_internal_links(pool: Pool<Postgres>) -> Result<()> {
    let unused_result = fetch_unused_link_ids(&pool, 30).await?;
    let inactive_result = fetch_inactive_link_ids(&pool, 60).await?;

    // Links with @macro.com in macro_id should never be deleted
    let internal_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000005")?;
    assert!(
        !unused_result.contains(&internal_link_id) && !inactive_result.contains(&internal_link_id),
        "Should not include internal @macro.com links"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_respects_threshold_parameters(pool: Pool<Postgres>) -> Result<()> {
    // With very high thresholds, nothing should be returned
    let unused_result = fetch_unused_link_ids(&pool, 365).await?;
    let inactive_result = fetch_inactive_link_ids(&pool, 365).await?;
    assert!(
        unused_result.is_empty() && inactive_result.is_empty(),
        "High thresholds should return no links"
    );

    // With very low thresholds, more links should be returned
    let unused_result = fetch_unused_link_ids(&pool, 1).await?;
    let inactive_result = fetch_inactive_link_ids(&pool, 1).await?;
    assert!(
        !unused_result.is_empty() || !inactive_result.is_empty(),
        "Low thresholds should return some links"
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ownerless_links_are_only_those_whose_owner_account_is_gone(
    pool: Pool<Postgres>,
) -> Result<()> {
    // A person's account, and a promoted shared mailbox's minted account.
    for (fusion, macro_id, email) in [
        (
            "00000000-0000-0000-0000-0000000000a1",
            "macro|person@example.com",
            "person@example.com",
        ),
        (
            "00000000-0000-0000-0000-0000000000a2",
            "macro|shared@example.com",
            "shared@example.com",
        ),
    ] {
        let fusion = Uuid::parse_str(fusion)?;
        sqlx::query!(
            "INSERT INTO macro_user (id,username,email,stripe_customer_id) VALUES ($1,$2,$3,$4)",
            fusion,
            macro_id,
            email,
            format!("cus_{fusion}")
        )
        .execute(&pool)
        .await?;
        sqlx::query!(
            r#"INSERT INTO "User" (id,email,macro_user_id) VALUES ($1,$2,$3)"#,
            macro_id,
            email,
            fusion
        )
        .execute(&pool)
        .await?;
    }
    sqlx::query!(
        "INSERT INTO promoted_shared_mailboxes (macro_id) VALUES ('macro|shared@example.com')"
    )
    .execute(&pool)
    .await?;

    let person = Uuid::parse_str("00000000-0000-0000-0000-0000000000b1")?;
    let shared = Uuid::parse_str("00000000-0000-0000-0000-0000000000b2")?;
    let ownerless = Uuid::parse_str("00000000-0000-0000-0000-0000000000b3")?;
    let disconnecting = Uuid::parse_str("00000000-0000-0000-0000-0000000000b4")?;
    let purging = Uuid::parse_str("00000000-0000-0000-0000-0000000000b5")?;
    let also_ownerless = Uuid::parse_str("00000000-0000-0000-0000-0000000000b6")?;
    for (id, owner, address) in [
        (person, "macro|person@example.com", "person@example.com"),
        (shared, "macro|shared@example.com", "shared@example.com"),
        (ownerless, "macro|gone@example.com", "gone@example.com"),
        (
            disconnecting,
            "macro|gone@example.com",
            "gone-2@example.com",
        ),
        (purging, "macro|gone@example.com", "gone-3@example.com"),
        (
            also_ownerless,
            "macro|gone@example.com",
            "gone-4@example.com",
        ),
    ] {
        sqlx::query!(
            "INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider) VALUES ($1,$2,'credentials',$3,'GMAIL')",
            id,
            owner,
            address
        )
        .execute(&pool)
        .await?;
    }
    sqlx::query!(
        "UPDATE email_links SET disconnect_requested_at = now() WHERE id = $1",
        disconnecting
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE email_links SET deleting_at = now() WHERE id = $1",
        purging
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        fetch_ownerless_link_ids(&pool, 100).await?,
        vec![ownerless, also_ownerless],
        "never a live owner, a promoted shared mailbox, or a link whose removal started"
    );
    assert_eq!(fetch_ownerless_link_ids(&pool, 1).await?, vec![ownerless]);

    Ok(())
}
