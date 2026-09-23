use crate::domain::ports::ChannelSideEffectContext;
use crate::outbound::pg_side_effect_context::PgChannelSideEffectContext;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const USER_A: &str = "macro|user-a@test.com";
const USER_B: &str = "macro|user-b@test.com";
const USER_C: &str = "macro|user-c@test.com";
const USER_E: &str = "macro|user-e@test.com";
const LEFT_USER: &str = "macro|left-user@test.com";

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_notification_context_excludes_departed_senders(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let ctx = PgChannelSideEffectContext::new(pool);
    // ch3 thread parent (msg id 0x..31) was authored by an active participant,
    // while its only reply was authored by a participant who has since left.
    let parent = Uuid::from_u128(0x00000000_0000_0000_0000_000000000031);
    let context = ctx.get_thread_notification_context(parent).await?;

    let ids: Vec<&str> = context.participants.iter().map(|p| p.as_ref()).collect();
    assert!(
        ids.contains(&USER_A),
        "active thread participant should be a notification recipient"
    );
    assert!(
        !ids.contains(&LEFT_USER),
        "departed sender must not be a thread notification recipient"
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_notification_context_excludes_deleted_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let ctx = PgChannelSideEffectContext::new(pool);
    // ch4 thread t41 (msg id 0x..41): user-b rooted it and user-c replied. user-e
    // only appears in soft-deleted replies: one they authored, and one from
    // user-b that @-mentioned them (whose mention row still exists). Neither may
    // keep notifying user-e about later replies.
    let parent = Uuid::from_u128(0x00000000_0000_0000_0000_000000000041);
    let context = ctx.get_thread_notification_context(parent).await?;

    let ids: Vec<&str> = context.participants.iter().map(|p| p.as_ref()).collect();
    assert!(
        ids.contains(&USER_B) && ids.contains(&USER_C),
        "senders of live thread messages should be notification recipients"
    );
    assert!(
        !ids.contains(&USER_E),
        "a user who only sent, or was only mentioned in, deleted replies must not be a recipient"
    );
    assert!(
        !ids.contains(&LEFT_USER),
        "departed sender must not be a thread notification recipient"
    );
    Ok(())
}
