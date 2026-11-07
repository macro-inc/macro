use super::*;
use crate::domain::ports::BotRepo;
use entity_registry::OwnerGrantPolicy;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("owner_grants"))
)]
async fn deleted_bots_keep_their_sponsor_not_their_creator(pool: PgPool) {
    let repo = PgBotsRepo::new(pool);
    let policy = OwnerGrantPolicy::new(repo.clone());
    let cases = [
        (
            BotId::new_from_uuid(Uuid::from_u128(0x90000000_0000_0000_0000_000000000021)),
            Owner::Team(Uuid::from_u128(0x90000000_0000_0000_0000_000000000011)),
        ),
        (
            BotId::new_from_uuid(Uuid::from_u128(0x90000000_0000_0000_0000_000000000022)),
            Owner::parse(OwnerType::User, "macro|sponsor@example.com").unwrap(),
        ),
    ];
    for (bot, sponsor) in cases {
        let expected = vec![Owner::Bot(bot), sponsor];
        assert_eq!(policy.grants_for(&Owner::Bot(bot)).await.unwrap(), expected);
        assert!(repo.delete_bot(bot).await.unwrap());
        assert!(repo.get_bot(bot).await.unwrap().is_none());
        assert_eq!(policy.grants_for(&Owner::Bot(bot)).await.unwrap(), expected);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_bot_fails_closed(pool: PgPool) {
    let policy = OwnerGrantPolicy::new(PgBotsRepo::new(pool));
    let error = policy
        .grants_for(&Owner::Bot(BotId::new_from_uuid(Uuid::from_u128(42))))
        .await
        .unwrap_err();
    assert_eq!(
        *error.current_context(),
        EntityRegistryError::InvalidBotSponsor
    );
}
