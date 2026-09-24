use super::*;
use bot_id::{BotId, SYSTEM_BOTS};
use harness_id::HarnessId;
use macro_authorization::{
    HarnessAuthentication, HarnessAuthorizationOwner, MacroUserAuthentication,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

const ROW_BOT: BotId = BotId::new_from_uuid(Uuid::from_u128(0xB07A));
const TEAM: Uuid = Uuid::from_u128(0x7EA3);
const GATES: [NonUserOwners; 2] = [NonUserOwners::Disabled, NonUserOwners::Enabled];

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|user@example.com".to_string()).unwrap()
}

fn user() -> MacroUserAuthentication {
    MacroUserAuthentication {
        macro_user_id: user_id(),
        user_context: Default::default(),
    }
}

fn bot(
    bot_id: BotId,
    bot_scope: BotScope,
    team_id: Option<Uuid>,
    acting_user: Option<MacroUserAuthentication>,
) -> MacroAuthorization {
    MacroAuthorization::Bot(BotAuthentication {
        bot_id,
        token_id: Uuid::from_u128(1),
        bot_scope,
        team_id,
        acting_user,
    })
}

fn harness() -> MacroAuthorization {
    MacroAuthorization::Harness(HarnessAuthentication {
        harness_id: HarnessId::new_from_uuid(Uuid::from_u128(2)),
        token_id: Uuid::from_u128(3),
        owner: HarnessAuthorizationOwner::Team { team_id: TEAM },
        acting_user: user(),
    })
}

fn resolve(
    authorization: MacroAuthorization,
    gate: NonUserOwners,
) -> Result<CreationPrincipal, CreationPrincipalError> {
    resolve_creation_principal(&authorization, gate)
}

#[test]
fn gate_independent_principals_resolve_the_same_either_way() {
    for gate in GATES {
        assert_eq!(
            resolve(MacroAuthorization::User(user()), gate),
            Ok(CreationPrincipal::User(user_id())),
            "user under {gate:?}"
        );
        assert_eq!(
            resolve(MacroAuthorization::Internal(Some(user())), gate),
            Ok(CreationPrincipal::User(user_id())),
            "internal for a user under {gate:?}"
        );
        assert_eq!(
            resolve(MacroAuthorization::Internal(None), gate),
            Err(CreationPrincipalError::InternalWithoutUser),
            "internal without a user under {gate:?}"
        );
        assert_eq!(
            resolve(harness(), gate),
            Err(CreationPrincipalError::Harness),
            "harness under {gate:?}"
        );
    }
}

#[test]
fn a_bot_with_an_acting_user_creates_for_that_user() {
    let bots = SYSTEM_BOTS.iter().map(|bot| bot.id).chain([ROW_BOT]);
    for bot_id in bots {
        for (scope, team) in [
            (BotScope::User, None),
            (BotScope::Team, Some(TEAM)),
            (BotScope::Team, None),
        ] {
            for gate in GATES {
                assert_eq!(
                    resolve(bot(bot_id, scope, team, Some(user())), gate),
                    Ok(CreationPrincipal::BotForUser {
                        bot: bot_id,
                        user: user_id(),
                    }),
                    "{bot_id} in {scope} scope under {gate:?}"
                );
            }
        }
    }
}

#[test]
fn a_system_bot_without_a_user_never_creates() {
    for system_bot in SYSTEM_BOTS {
        for (scope, team) in [
            (BotScope::User, None),
            (BotScope::User, Some(TEAM)),
            (BotScope::Team, None),
            (BotScope::Team, Some(TEAM)),
        ] {
            for gate in GATES {
                assert_eq!(
                    resolve(bot(system_bot.id, scope, team, None), gate),
                    Err(CreationPrincipalError::SystemBotWithoutUser),
                    "{} in {scope} scope under {gate:?}",
                    system_bot.handle
                );
            }
        }
    }
}

#[test]
fn a_row_bot_without_a_user_owns_only_in_verified_team_scope_behind_the_gate() {
    let cases = [
        (
            BotScope::User,
            None,
            NonUserOwners::Disabled,
            Err(CreationPrincipalError::UserScopeWithoutUser),
        ),
        (
            BotScope::User,
            None,
            NonUserOwners::Enabled,
            Err(CreationPrincipalError::UserScopeWithoutUser),
        ),
        (
            BotScope::User,
            Some(TEAM),
            NonUserOwners::Disabled,
            Err(CreationPrincipalError::UserScopeWithoutUser),
        ),
        (
            BotScope::User,
            Some(TEAM),
            NonUserOwners::Enabled,
            Err(CreationPrincipalError::UserScopeWithoutUser),
        ),
        (
            BotScope::Team,
            None,
            NonUserOwners::Disabled,
            Err(CreationPrincipalError::MissingTeam),
        ),
        (
            BotScope::Team,
            None,
            NonUserOwners::Enabled,
            Err(CreationPrincipalError::MissingTeam),
        ),
        (
            BotScope::Team,
            Some(TEAM),
            NonUserOwners::Disabled,
            Err(CreationPrincipalError::NonUserOwnersDisabled),
        ),
        (
            BotScope::Team,
            Some(TEAM),
            NonUserOwners::Enabled,
            Ok(CreationPrincipal::TeamBot {
                bot: NonSystemBotId::new(ROW_BOT).unwrap(),
                team: TEAM,
            }),
        ),
    ];
    for (scope, team, gate, expected) in cases {
        assert_eq!(
            resolve(bot(ROW_BOT, scope, team, None), gate),
            expected,
            "{scope} scope with team {team:?} under {gate:?}"
        );
    }
}
