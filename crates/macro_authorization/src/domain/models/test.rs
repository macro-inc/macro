use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use uuid::Uuid;

use super::{
    BotActingUserClaims, BotAuthentication, BotScope, MacroAuthorization, MacroAuthorizationError,
    MacroUserAuthentication,
};

const BOT_ID: BotId = BotId::new_from_uuid(Uuid::from_u128(1));
const TOKEN_ID: Uuid = Uuid::from_u128(2);
const TEAM_ID: Uuid = Uuid::from_u128(3);

fn user_authentication() -> MacroUserAuthentication {
    MacroUserAuthentication {
        macro_user_id: MacroUserIdStr::try_from("macro|user@example.com".to_string())
            .expect("valid Macro user id"),
        user_context: UserContext {
            user_id: "macro|user@example.com".to_string(),
            fusion_user_id: "fusion-user-id".to_string(),
            permissions: None,
            organization_id: Some(42),
        },
    }
}

fn assert_acting_user(user: &MacroUserAuthentication) {
    assert_eq!(user.macro_user_id.as_ref(), "macro|user@example.com");
    assert_eq!(user.user_context.user_id, "macro|user@example.com");
    assert_eq!(user.user_context.fusion_user_id, "fusion-user-id");
    assert_eq!(user.user_context.organization_id, Some(42));
}

#[test]
fn user_authorization_exposes_its_acting_user() {
    let authorization = MacroAuthorization::User(user_authentication());

    assert_acting_user(
        authorization
            .acting_user()
            .expect("a user principal is its own acting user"),
    );
    assert!(!authorization.is_internal());
    assert!(authorization.bot().is_none());

    let MacroAuthorization::User(user) = authorization else {
        panic!("expected user authorization");
    };
    assert_acting_user(&user);
}

#[test]
fn bot_authorization_exposes_the_bot_and_verified_acting_user() {
    let authorization = MacroAuthorization::Bot(BotAuthentication {
        bot_id: BOT_ID,
        token_id: TOKEN_ID,
        bot_scope: BotScope::Team,
        team_id: Some(TEAM_ID),
        acting_user: Some(user_authentication()),
    });

    assert_acting_user(
        authorization
            .acting_user()
            .expect("bot has a verified acting user"),
    );
    assert!(!authorization.is_internal());

    let bot = authorization.bot().expect("expected bot authorization");
    assert_eq!(bot.bot_id, BOT_ID);
    assert_eq!(bot.token_id, TOKEN_ID);
    assert_eq!(bot.bot_scope, BotScope::Team);
    assert_eq!(bot.team_id, Some(TEAM_ID));
    assert_acting_user(
        bot.acting_user
            .as_ref()
            .expect("bot has a verified acting user"),
    );

    let BotAuthentication {
        bot_id,
        token_id,
        bot_scope,
        team_id,
        acting_user,
    } = bot.clone();
    assert_eq!(bot_id, BOT_ID);
    assert_eq!(token_id, TOKEN_ID);
    assert_eq!(bot_scope, BotScope::Team);
    assert_eq!(team_id, Some(TEAM_ID));
    assert!(acting_user.is_some());
}

#[test]
fn bare_bot_authorization_has_no_acting_user() {
    let authorization = MacroAuthorization::Bot(BotAuthentication {
        bot_id: BOT_ID,
        token_id: TOKEN_ID,
        bot_scope: BotScope::User,
        team_id: None,
        acting_user: None,
    });

    assert!(authorization.acting_user().is_none());
    assert!(!authorization.is_internal());
    assert!(authorization.bot().is_some());
}

#[test]
fn internal_authorization_exposes_its_acting_user() {
    let authorization = MacroAuthorization::Internal(Some(user_authentication()));

    assert_acting_user(
        authorization
            .acting_user()
            .expect("internal principal has an acting user"),
    );
    assert!(authorization.is_internal());
    assert!(authorization.bot().is_none());

    let MacroAuthorization::Internal(Some(user)) = authorization else {
        panic!("expected internal authorization with an acting user");
    };
    assert_acting_user(&user);
}

#[test]
fn internal_authorization_can_have_no_acting_user() {
    let authorization = MacroAuthorization::Internal(None);

    assert!(authorization.acting_user().is_none());
    assert!(authorization.is_internal());
    assert!(authorization.bot().is_none());
}

#[test]
fn bot_acting_user_claims_carry_unverified_values() {
    let claims = BotActingUserClaims {
        user_id: Some("macro|claimed@example.com".to_string()),
        fusion_user_id: Some("claimed-fusion-id".to_string()),
        organization_id: Some(7),
    };

    assert_eq!(claims.user_id.as_deref(), Some("macro|claimed@example.com"));
    assert_eq!(claims.fusion_user_id.as_deref(), Some("claimed-fusion-id"));
    assert_eq!(claims.organization_id, Some(7));
}

#[test]
fn bot_scopes_have_stable_header_values() {
    assert_eq!(BotScope::User.as_str(), "user");
    assert_eq!(BotScope::User.to_string(), "user");
    assert_eq!(BotScope::Team.as_str(), "team");
    assert_eq!(BotScope::Team.to_string(), "team");
}

#[test]
fn authorization_errors_remain_clone_and_copy() {
    fn assert_clone_and_copy<T: Clone + Copy>() {}

    assert_clone_and_copy::<MacroAuthorizationError>();

    let errors = [
        MacroAuthorizationError::CredentialsExpired,
        MacroAuthorizationError::InvalidCredentials,
        MacroAuthorizationError::ActingUserNotAuthorized,
        MacroAuthorizationError::BotScopeNotAuthorized,
        MacroAuthorizationError::Unavailable,
    ];
    let copied_errors = errors;

    assert_eq!(errors, copied_errors);
}
