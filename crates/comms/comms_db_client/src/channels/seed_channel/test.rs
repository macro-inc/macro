use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn seeds_channel_without_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
    let channel_id: Uuid = "11111111-1111-1111-1111-111111111111".parse().unwrap();

    let id = seed_channel(
        &pool,
        SeedChannelOptions {
            channel_id,
            name: Some("general".to_string()),
            owner_id: "macro|owner@example.com".to_string(),
            org_id: None,
            channel_type: ChannelType::Public,
            participants: vec!["macro|member@example.com".to_string()],
            team_id: None,
        },
    )
    .await?;

    assert_eq!(id, channel_id);

    let team_id: Option<Uuid> =
        sqlx::query_scalar("SELECT team_id FROM comms_channels WHERE id = $1")
            .bind(channel_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(team_id, None);

    let participants: i64 =
        sqlx::query_scalar("SELECT count(*) FROM comms_channel_participants WHERE channel_id = $1")
            .bind(channel_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(participants, 2);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn seeds_team_channel_with_team_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id: Uuid = "22222222-2222-2222-2222-222222222222".parse().unwrap();
    let channel_id: Uuid = "33333333-3333-3333-3333-333333333333".parse().unwrap();

    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id)
         VALUES ('55555555-5555-5555-5555-555555555555', 'owner', 'owner@example.com', 'stripe-test')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"INSERT INTO "User" (id, email, macro_user_id)
           VALUES ('macro|owner@example.com', 'owner@example.com', '55555555-5555-5555-5555-555555555555')"#,
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'acme', 'macro|owner@example.com')",
    )
    .bind(team_id)
    .execute(&pool)
    .await?;

    seed_channel(
        &pool,
        SeedChannelOptions {
            channel_id,
            name: Some("acme-hq".to_string()),
            owner_id: "macro|owner@example.com".to_string(),
            org_id: None,
            channel_type: ChannelType::Team,
            participants: vec![],
            team_id: Some(team_id),
        },
    )
    .await?;

    let stored: Option<Uuid> =
        sqlx::query_scalar("SELECT team_id FROM comms_channels WHERE id = $1")
            .bind(channel_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(stored, Some(team_id));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rejects_team_channel_without_team_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let channel_id: Uuid = "44444444-4444-4444-4444-444444444444".parse().unwrap();

    let result = seed_channel(
        &pool,
        SeedChannelOptions {
            channel_id,
            name: Some("orphan".to_string()),
            owner_id: "macro|owner@example.com".to_string(),
            org_id: None,
            channel_type: ChannelType::Team,
            participants: vec![],
            team_id: None,
        },
    )
    .await;

    assert!(result.is_err(), "team channels require a team_id");
    Ok(())
}
