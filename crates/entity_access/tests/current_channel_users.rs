//! Channel rosters as production reads them: the compiled library has its
//! roster cache on, unlike the crate's unit tests. That cache is shared by the
//! whole test binary and keyed by channel id, so only this test may read the
//! fixture's channel.

use entity_access::{
    domain::{
        ports::{AccessRepository, EntityAudienceLookup},
        service::EntityAccessServiceImpl,
    },
    outbound::PgAccessRepository,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

const CHANNEL_ID: Uuid = uuid::uuid!("00000000-0000-0000-0000-000000000c01");

fn sorted(users: Vec<MacroUserIdStr<'static>>) -> Vec<String> {
    let mut users = users
        .into_iter()
        .map(|user| user.to_string())
        .collect::<Vec<_>>();
    users.sort();
    users
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../call/fixtures", scripts("call_repo"))
)]
async fn the_current_roster_sees_a_member_leave_that_the_cached_roster_has_not(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = PgAccessRepository::new(pool.clone());
    let service = EntityAccessServiceImpl::new(repo.clone());

    let cached = sorted(repo.get_channel_users(&CHANNEL_ID).await?);
    assert_eq!(cached.len(), 3, "the fixture's three members");
    let leaver = cached[0].clone();
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1 AND user_id = $2",
        CHANNEL_ID,
        leaver,
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        sorted(repo.get_channel_users(&CHANNEL_ID).await?),
        cached,
        "the cached roster still lists the member who left"
    );
    assert_eq!(
        sorted(
            service
                .get_current_channel_users(&CHANNEL_ID.to_string())
                .await?
        ),
        cached[1..].to_vec()
    );
    Ok(())
}
