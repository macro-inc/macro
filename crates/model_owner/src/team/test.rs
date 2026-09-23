use super::*;

#[test]
fn resolves_only_the_typed_owners_audience() {
    let user = Owner::from_principal_str("macro|owner@example.com").unwrap();
    let bot = Owner::from_principal_str("bot|00000000-0000-0000-0000-000000000001").unwrap();
    let team = Uuid::from_u128(2);
    let other = Uuid::from_u128(3);
    let facts = OwnerTeamFacts {
        user_team: Some(other),
        bot_team: Some(team),
        bot_user_team: Some(other),
    };
    assert_eq!(owner_team(&user, facts), Some(other));
    assert_eq!(owner_team(&bot, facts), Some(team));
    assert_eq!(owner_team(&Owner::Team(team), facts), Some(team));
    assert_eq!(
        owner_team(
            &bot,
            OwnerTeamFacts {
                bot_team: None,
                ..facts
            }
        ),
        Some(other)
    );
    assert_eq!(owner_team(&user, OwnerTeamFacts::default()), None);
    assert_eq!(owner_team(&bot, OwnerTeamFacts::default()), None);
    assert_eq!(
        owner_team(&Owner::Team(team), OwnerTeamFacts::default()),
        Some(team)
    );
}
