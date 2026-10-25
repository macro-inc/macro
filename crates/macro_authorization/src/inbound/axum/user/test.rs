use super::*;
use crate::{
    BotOnly, InternalAuthConfig, JwtValidator, MacroAuthorizationExtractor,
    MacroAuthorizationServiceImpl, NoBotAuthorizer, NoUserApiKeyAuthorizer, UserOnly,
    ValidatedIdentity,
};
use std::sync::Arc;

#[derive(Clone)]
struct Validator;
impl JwtValidator for Validator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        match jwt {
            "execution" | "user" => Ok(ValidatedIdentity {
                agent_id: (jwt == "execution").then_some(bot_id::MACRO_NEW_BOT_ID),
                user_id: "macro|owner@example.com".into(),
                fusion_user_id: "fusion-owner".into(),
                organization_id: Some(42),
                permissions: None,
            }),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }
}

type AuthorizationService = MacroAuthorizationServiceImpl<Validator>;

#[tokio::test]
async fn bearer_agent_attribution_survives_user_policy_without_becoming_bot_authority() {
    let state = MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        Validator,
        InternalAuthConfig {
            api_key: "internal-key".into(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )));
    for (token, agent) in [
        ("execution", Some(bot_id::MACRO_NEW_BOT_ID)),
        ("user", None),
    ] {
        let (mut parts, _) = axum::http::Request::builder()
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(())
            .unwrap()
            .into_parts();
        let caller = MacroAuthorizationExtractor::<
            MacroAuthorizationServiceImpl<Validator>,
            UserOnly,
        >::from_request_parts(&mut parts, &state)
        .await
        .unwrap();
        assert_eq!(caller.authorization.agent_id, agent);
        assert_eq!(
            caller.authorization.macro_user_id.as_ref(),
            "macro|owner@example.com"
        );
        assert_eq!(caller.authorization.user_context.organization_id, Some(42));
        assert!(
            MacroAuthorizationExtractor::<AuthorizationService, BotOnly>::from_request_parts(
                &mut parts, &state
            )
            .await
            .is_err()
        );
    }
    let (mut parts, _) = axum::http::Request::builder()
        .header(header::AUTHORIZATION, "Bearer user")
        .header(
            "x-macro-agent-id",
            bot_id::MACRO_NEW_BOT_ID.as_uuid().to_string(),
        )
        .body(())
        .unwrap()
        .into_parts();
    let caller = MacroAuthorizationExtractor::<AuthorizationService, UserOnly>::from_request_parts(
        &mut parts, &state,
    )
    .await
    .unwrap();
    assert_eq!(caller.authorization.agent_id, None);
}
