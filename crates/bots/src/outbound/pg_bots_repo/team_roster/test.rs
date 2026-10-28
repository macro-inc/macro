use super::*;
use crate::domain::ports::BotRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const TEAM: Uuid = Uuid::from_u128(0x91000000_0000_0000_0000_000000000011);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x91000000_0000_0000_0000_000000000012);
const TEAM_WITHOUT_BOTS: Uuid = Uuid::from_u128(0x91000000_0000_0000_0000_000000000013);
const UNKNOWN_TEAM: Uuid = Uuid::from_u128(0x91000000_0000_0000_0000_0000000000ff);

fn bot(n: u128) -> BotId {
    BotId::new_from_uuid(Uuid::from_u128(0x91000000_0000_0000_0000_000000000020 + n))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("team_roster"))
)]
async fn team_bot_ids_include_soft_deleted_bots_and_exclude_other_owners(pool: PgPool) {
    let repo = PgBotsRepo::new(pool);
    assert!(repo.delete_bot(bot(2)).await.unwrap());
    assert!(repo.get_bot(bot(2)).await.unwrap().is_none());

    assert_eq!(repo.team_bot_ids(TEAM).await.unwrap(), vec![bot(1), bot(2)]);
    assert_eq!(repo.team_bot_ids(OTHER_TEAM).await.unwrap(), vec![bot(3)]);
    assert_eq!(repo.team_bot_ids(TEAM_WITHOUT_BOTS).await.unwrap(), vec![]);
    assert_eq!(repo.team_bot_ids(UNKNOWN_TEAM).await.unwrap(), vec![]);
}
