use super::*;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap()
}

fn row_bot() -> NonSystemBotId {
    NonSystemBotId::new(BotId::TEST_A).unwrap()
}

#[test]
fn user_owns_and_acts() {
    let principal = CreationPrincipal::User(user());

    assert_eq!(principal.owner().principal_id(), "macro|owner@example.com");
    assert_eq!(principal.user(), Some(&user()));
    assert_eq!(principal.bot(), None);
}

#[test]
fn bot_for_user_is_owned_by_the_user() {
    let principal = CreationPrincipal::BotForUser {
        bot: BotId::TEST_A,
        user: user(),
    };

    assert_eq!(principal.owner().principal_id(), "macro|owner@example.com");
    assert_eq!(principal.user(), Some(&user()));
    assert_eq!(principal.bot(), Some(BotId::TEST_A));
}

#[test]
fn team_bot_owns_without_a_user() {
    let principal = CreationPrincipal::TeamBot {
        bot: row_bot(),
        team: Uuid::from_u128(7),
    };

    assert_eq!(
        principal.owner().principal_id(),
        "bot|00000000-0000-0000-0000-00000000b07a"
    );
    assert_eq!(principal.user(), None);
    assert_eq!(principal.bot(), Some(BotId::TEST_A));
}
