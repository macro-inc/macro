use bot_id::BotId;
use macro_authorization::{BotAuthentication, BotScope, MacroAuthorization};
use uuid::Uuid;

use super::token_identity;

#[test]
fn bot_tokens_keep_the_actor_without_inventing_a_user() {
    let bot_id = BotId::new_from_uuid(Uuid::from_u128(42));
    let bot = BotAuthentication {
        bot_id,
        token_id: Uuid::nil(),
        bot_scope: BotScope::Team,
        team_id: Some(Uuid::from_u128(7)),
        acting_user: None,
    };

    assert_eq!(
        token_identity(Some(&MacroAuthorization::Bot(bot))),
        Ok((None, Some(bot_id.into_storage_id().to_string())))
    );
}

#[test]
fn anonymous_and_identityless_internal_tokens_have_no_identity_claims() {
    assert_eq!(token_identity(None), Ok((None, None)));
    assert_eq!(
        token_identity(Some(&MacroAuthorization::Internal(None))),
        Ok((None, None))
    );
}
