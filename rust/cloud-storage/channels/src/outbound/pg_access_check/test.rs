use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const CH1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c01);
const CH2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c02);

fn access(pool: Pool<Postgres>) -> PgChannelAccessCheck {
    PgChannelAccessCheck::new(pool)
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn active_member_is_allowed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let check = access(pool);
    assert!(
        check
            .is_channel_member(CH1, "macro|user-a@test.com")
            .await?
    );
    assert!(
        check
            .is_channel_member(CH1, "macro|user-b@test.com")
            .await?
    );
    assert!(
        check
            .is_channel_member(CH1, "macro|user-c@test.com")
            .await?
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn left_user_is_denied(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let check = access(pool);
    assert!(
        !check
            .is_channel_member(CH1, "macro|left-user@test.com")
            .await?
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn non_participant_is_denied(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let check = access(pool);
    assert!(
        !check
            .is_channel_member(CH1, "macro|stranger@test.com")
            .await?
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn member_of_different_channel_is_denied(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let check = access(pool);
    // user-a is in CH1 but not in CH2
    assert!(
        !check
            .is_channel_member(CH2, "macro|user-a@test.com")
            .await?
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn nonexistent_channel_is_denied(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let check = access(pool);
    let fake_channel = Uuid::from_u128(0xdeadbeef);
    assert!(
        !check
            .is_channel_member(fake_channel, "macro|user-a@test.com")
            .await?
    );
    Ok(())
}
