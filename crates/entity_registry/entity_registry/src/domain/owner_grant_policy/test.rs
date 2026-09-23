use super::*;
use bot_id::{BotId, SYSTEM_BOTS};
use model_owner::OwnerType;
use uuid::Uuid;

const OWNED_BOT: BotId = BotId::new_from_uuid(Uuid::from_u128(42));

struct FakeBotFacts(Option<Owner>);

impl BotFacts for FakeBotFacts {
    async fn sponsor(&self, bot: BotId) -> EntityRegistryResult<Option<Owner>> {
        assert_eq!(bot, OWNED_BOT);
        Ok(self.0.clone())
    }
}

struct NoLookup;

impl BotFacts for NoLookup {
    async fn sponsor(&self, _: BotId) -> EntityRegistryResult<Option<Owner>> {
        panic!("this owner must not require a bot lookup")
    }
}

fn user() -> Owner {
    Owner::parse(OwnerType::User, "macro|sponsor@example.com").unwrap()
}

#[tokio::test]
async fn personal_owner_gets_only_the_user_grant() {
    assert_eq!(
        OwnerGrantPolicy::new(NoLookup)
            .grants_for(&user())
            .await
            .unwrap(),
        vec![user()]
    );
}

#[tokio::test]
async fn team_owner_gets_only_the_team_grant() {
    let owner = Owner::Team(Uuid::from_u128(1));
    assert_eq!(
        OwnerGrantPolicy::new(NoLookup)
            .grants_for(&owner)
            .await
            .unwrap(),
        vec![owner]
    );
}

#[tokio::test]
async fn personal_bot_gets_bot_and_sponsor_grants() {
    assert_eq!(
        OwnerGrantPolicy::new(FakeBotFacts(Some(user())))
            .grants_for(&Owner::Bot(OWNED_BOT))
            .await
            .unwrap(),
        vec![Owner::Bot(OWNED_BOT), user()]
    );
}

#[tokio::test]
async fn team_bot_gets_bot_and_team_grants() {
    let team = Owner::Team(Uuid::from_u128(1));
    assert_eq!(
        OwnerGrantPolicy::new(FakeBotFacts(Some(team.clone())))
            .grants_for(&Owner::Bot(OWNED_BOT))
            .await
            .unwrap(),
        vec![Owner::Bot(OWNED_BOT), team]
    );
}

#[tokio::test]
async fn assigned_system_bots_get_only_bot_grants_without_lookup() {
    for bot in SYSTEM_BOTS {
        let owner = Owner::Bot(bot.id);
        assert_eq!(
            OwnerGrantPolicy::new(NoLookup)
                .grants_for(&owner)
                .await
                .unwrap(),
            vec![owner]
        );
    }
}

#[tokio::test]
async fn missing_and_bot_sponsors_fail_closed() {
    for sponsor in [None, Some(Owner::Bot(OWNED_BOT))] {
        let error = OwnerGrantPolicy::new(FakeBotFacts(sponsor))
            .grants_for(&Owner::Bot(OWNED_BOT))
            .await
            .unwrap_err();
        assert_eq!(
            *error.current_context(),
            EntityRegistryError::InvalidBotSponsor
        );
    }
}

struct Unavailable;

impl BotFacts for Unavailable {
    async fn sponsor(&self, _: BotId) -> EntityRegistryResult<Option<Owner>> {
        Err(EntityRegistryError::Infrastructure.into())
    }
}

#[tokio::test]
async fn lookup_errors_are_not_silently_replaced_by_bot_only_grants() {
    let error = OwnerGrantPolicy::new(Unavailable)
        .grants_for(&Owner::Bot(OWNED_BOT))
        .await
        .unwrap_err();
    assert_eq!(
        *error.current_context(),
        EntityRegistryError::Infrastructure
    );
}
