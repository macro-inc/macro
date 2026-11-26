use super::*;
use crate::{
    AccountHolderOrInternal, BotOnly, CredentialAttribution, CredentialOrigin, InternalAuthConfig,
    JwtValidator, MacroAuthorizationExtractor, MacroAuthorizationServiceImpl, NoBotAuthorizer,
    NoUserApiKeyAuthorizer, UserOnly, ValidatedCredential, ValidatedIdentity,
};
use crate::{is_agent_run, is_program_run};
use ::axum::extract::FromRequestParts;
use ::axum::http::{HeaderMap, header};
use std::sync::Arc;

#[derive(Clone)]
struct Validator;
impl JwtValidator for Validator {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.validate(jwt).map(|identity| ValidatedCredential {
            identity,
            origin: if jwt == "user" {
                CredentialOrigin::Session
            } else {
                CredentialOrigin::MacroApiJwt
            },
        })
    }

    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        match jwt {
            "execution" | "api" | "user" | "routine" => Ok(ValidatedIdentity {
                agent_id: (jwt == "execution").then_some(bot_id::MACRO_NEW_BOT_ID),
                agent_via: None,
                routine_id: (jwt == "routine").then_some(ROUTINE_ID),
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

const ROUTINE_ID: uuid::Uuid = uuid::Uuid::from_u128(0x7001);

fn state() -> MacroAuthorizationState<AuthorizationService> {
    MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        Validator,
        InternalAuthConfig {
            api_key: "internal-key".into(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )))
}

/// How a request carrying `token` as `?macro-api-token=` or as the
/// access-token cookie, with no `Authorization` header and no code-execution
/// marker, reads by `check`.
async fn reads_as(token: &str, check: fn(CredentialAttribution, &HeaderMap) -> bool) -> [bool; 2] {
    let state = state();
    let mut verdicts = [false; 2];
    let requests = [
        axum::http::Request::builder().uri(format!("/decide?macro-api-token={token}")),
        axum::http::Request::builder()
            .uri("/decide")
            .header(header::COOKIE, format!("macro-access-token={token}")),
    ];
    for (verdict, request) in verdicts.iter_mut().zip(requests) {
        let (mut parts, _) = request.body(()).unwrap().into_parts();
        let caller =
            MacroAuthorizationExtractor::<AuthorizationService, UserOnly>::from_request_parts(
                &mut parts, &state,
            )
            .await
            .unwrap();
        *verdict = check(caller.authorization.attribution(), &parts.headers);
    }
    verdicts
}

/// A routine code step running as its owner holds a token that signs
/// `routine_id` and no `agent_id`; the token alone must read as a program.
#[tokio::test]
async fn a_routine_owner_token_is_a_program_without_the_marker() {
    assert_eq!(reads_as("routine", is_program_run).await, [true, true]);
}

#[tokio::test]
async fn agent_tokens_stay_programs_and_plain_user_tokens_stay_people() {
    assert_eq!(reads_as("execution", is_program_run).await, [true, true]);
    assert_eq!(reads_as("api", is_program_run).await, [false, false]);
    assert_eq!(reads_as("user", is_program_run).await, [false, false]);
}

/// Owner routines send email and create events on a schedule, so the routes
/// that only ask an agent's program to confirm (`is_agent_run`) and the
/// account-holder policy still admit a routine owner token.
#[tokio::test]
async fn a_routine_owner_token_keeps_its_confirm_and_account_holder_routes() {
    assert_eq!(reads_as("routine", is_agent_run).await, [false, false]);
    assert_eq!(reads_as("execution", is_agent_run).await, [true, true]);

    let (mut parts, _) = axum::http::Request::builder()
        .uri("/account?macro-api-token=routine")
        .body(())
        .unwrap()
        .into_parts();
    let caller = MacroAuthorizationExtractor::<AuthorizationService, AccountHolderOrInternal>::from_request_parts(
        &mut parts,
        &state(),
    )
    .await
    .unwrap();
    assert_eq!(
        caller.authorization.user.attribution(),
        CredentialAttribution::Routine
    );
}

#[tokio::test]
async fn the_signed_routine_survives_extraction() {
    let (mut parts, _) = axum::http::Request::builder()
        .header(header::AUTHORIZATION, "Bearer routine")
        .body(())
        .unwrap()
        .into_parts();
    let caller = MacroAuthorizationExtractor::<AuthorizationService, UserOnly>::from_request_parts(
        &mut parts,
        &state(),
    )
    .await
    .unwrap();
    assert_eq!(caller.authorization.routine_id, Some(ROUTINE_ID));
    assert_eq!(caller.authorization.agent_id, None);
    assert_eq!(
        caller.authorization.attribution(),
        CredentialAttribution::Routine
    );
}

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
        ("api", None),
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
            caller.authorization.origin,
            if token == "user" {
                CredentialOrigin::Session
            } else {
                CredentialOrigin::MacroApiJwt
            }
        );
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
