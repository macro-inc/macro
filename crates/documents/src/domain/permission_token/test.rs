use bot_id::{BotId, MACRO_AI_BOT_ID, NonSystemBotId};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::CreationPrincipal;
use models_permissions::share_permission::access_level::AccessLevel;
use uuid::Uuid;

use super::{decode_permission_token, encode_principal_permission_token};

const SECRET: &str = "creation-token-secret";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|user@macro.com".to_string()).expect("valid user id")
}

fn identity_claims(principal: &CreationPrincipal) -> (Option<String>, Option<String>) {
    let token = encode_principal_permission_token(
        principal,
        "doc-1".to_string(),
        AccessLevel::Edit,
        SECRET,
    )
    .expect("token should encode");
    let claims = decode_permission_token(&token, SECRET).expect("token should decode");
    assert_eq!(claims.document_id, "doc-1");
    assert_eq!(claims.access_level, AccessLevel::Edit);
    (
        claims.user_id.map(|user| user.as_ref().to_string()),
        claims.actor,
    )
}

#[test]
fn user_token_names_the_user_without_an_actor() {
    assert_eq!(
        identity_claims(&CreationPrincipal::User(user())),
        (Some("macro|user@macro.com".to_string()), None),
    );
}

#[test]
fn bot_for_user_token_names_the_user_and_the_bot_actor() {
    let principal = CreationPrincipal::BotForUser {
        bot: MACRO_AI_BOT_ID,
        user: user(),
    };
    assert_eq!(
        identity_claims(&principal),
        (
            Some("macro|user@macro.com".to_string()),
            Some("bot|00000000-0000-0000-0000-00000000a1a1".to_string()),
        ),
    );
}

#[test]
fn team_bot_token_names_the_bot_actor_without_a_user() {
    let principal = CreationPrincipal::TeamBot {
        bot: NonSystemBotId::new(BotId::TEST_A).expect("test bot is not a system bot"),
        team: Uuid::from_u128(7),
    };
    assert_eq!(
        identity_claims(&principal),
        (
            None,
            Some("bot|00000000-0000-0000-0000-00000000b07a".to_string()),
        ),
    );
}
