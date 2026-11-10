use super::*;
use macro_authorization::{
    BotAuthentication, BotScope, CredentialOrigin, HarnessAuthentication,
    HarnessAuthorizationOwner, MacroUserAuthentication,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;

#[test]
fn email_filters_require_user_or_internal_credentials() {
    let user_id = "macro|owner@example.com";
    let user = MacroUserAuthentication {
        origin: CredentialOrigin::Session,
        agent_id: None,
        agent_via: None,
        macro_user_id: MacroUserIdStr::try_from(user_id.to_owned()).unwrap(),
        user_context: UserContext {
            user_id: user_id.to_owned(),
            ..UserContext::default()
        },
    };
    let api_key_user = MacroUserAuthentication {
        origin: CredentialOrigin::UserApiKey,
        ..user.clone()
    };
    let internal_user = MacroUserAuthentication {
        origin: CredentialOrigin::Internal,
        ..user.clone()
    };
    let bot_user = MacroUserAuthentication {
        origin: CredentialOrigin::Bot,
        ..user.clone()
    };
    let harness_user = MacroUserAuthentication {
        origin: CredentialOrigin::Harness,
        ..user.clone()
    };
    let principals = [
        ("session user", MacroAuthorization::User(user), true),
        ("user API key", MacroAuthorization::User(api_key_user), true),
        (
            "internal acting for user",
            MacroAuthorization::Internal(Some(internal_user)),
            true,
        ),
        (
            "bot acting for user",
            MacroAuthorization::Bot(BotAuthentication {
                bot_id: bot_id::BotId::TEST_A,
                token_id: Default::default(),
                bot_scope: BotScope::User,
                team_id: None,
                acting_user: Some(bot_user),
            }),
            false,
        ),
        (
            "harness acting for user",
            MacroAuthorization::Harness(HarnessAuthentication {
                harness_id: "00000000-0000-0000-0000-000000000001".parse().unwrap(),
                token_id: Default::default(),
                owner: HarnessAuthorizationOwner::User {
                    user_id: user_id.to_owned(),
                },
                acting_user: harness_user,
            }),
            false,
        ),
    ];
    let email = [WebhookFilter {
        events: vec!["email.message_received".to_owned()],
        ids: None,
    }];
    let document = [WebhookFilter {
        events: vec!["document.created".to_owned()],
        ids: None,
    }];

    for (name, principal, email_allowed) in &principals {
        assert_eq!(
            authorize_email_event_filters(principal, &email).is_ok(),
            *email_allowed,
            "{name}"
        );
        assert!(
            authorize_email_event_filters(principal, &document).is_ok(),
            "{name}"
        );
    }

    let bot = &principals[3].1;
    let mixed = [
        document[0].clone(),
        WebhookFilter {
            events: vec!["email.thread_read".to_owned()],
            ids: None,
        },
    ];
    assert!(authorize_email_event_filters(bot, &mixed).is_err());
    assert!(authorize_email_event_filters(bot, &[]).is_ok());

    for event in ["emailish.thing", "email"] {
        let filter = [WebhookFilter {
            events: vec![event.to_owned()],
            ids: None,
        }];
        assert!(
            authorize_email_event_filters(bot, &filter).is_ok(),
            "{event}"
        );
    }
}
