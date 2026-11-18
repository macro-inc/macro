//! The GraphQL mount refuses every program before any mutation runs. The
//! writes behind it carry the caller's program too (`ForwardedProgram`), so
//! this refusal is the first check, not the only one.

use super::graphql_soup::{GRAPHQL_PATH, GRAPHQL_SUBSCRIPTION_PATH};
use super::refuse_programs;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
    routing::{get, post},
};
use macro_authorization::{
    CODE_EXECUTION_HEADER, InternalIdentityClaims, MacroAuthorizationError,
    MacroAuthorizationService, MacroAuthorizationState, ValidatedCredential,
};
use model_user::UserContext;
use rootcause::Report;
use std::sync::Arc;
use tower::ServiceExt as _;

/// `agent`, `routine` and `person` are JWTs signed for an agent, a routine's
/// run and nobody.
#[derive(Clone)]
struct SignedFor;

impl MacroAuthorizationService for SignedFor {
    async fn authorize(&self, _: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        if !matches!(jwt, "agent" | "routine" | "person") {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        let mut credential = ValidatedCredential::session(UserContext {
            user_id: "macro|owner@example.com".to_owned(),
            fusion_user_id: "fusion-user-id".to_owned(),
            organization_id: None,
            permissions: None,
        });
        credential.identity.agent_id = (jwt == "agent").then_some(bot_id::MACRO_AI_BOT_ID);
        credential.identity.routine_id = (jwt == "routine").then(uuid::Uuid::nil);
        Ok(credential)
    }

    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// The GraphQL routes, standing in for the schema: reaching one means a
/// mutation would run.
fn graphql() -> Router {
    refuse_programs(
        Router::new()
            .route(GRAPHQL_PATH, post(|| async { StatusCode::OK }))
            .route(GRAPHQL_SUBSCRIPTION_PATH, get(|| async { StatusCode::OK })),
        MacroAuthorizationState::new(Arc::new(SignedFor)),
    )
}

const CREATE_EVENT: &str =
    r#"{"query":"mutation { createCalendarEvent(input: {title: \"sync\"}) { id } }"}"#;

fn mutation(token: &str) -> axum::http::request::Builder {
    Request::post(GRAPHQL_PATH)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
}

async fn status(request: Request<Body>) -> StatusCode {
    graphql().oneshot(request).await.unwrap().status()
}

#[tokio::test]
async fn an_agents_credential_cannot_run_a_calendar_mutation() {
    let request = mutation("agent").body(Body::from(CREATE_EVENT)).unwrap();
    assert_eq!(status(request).await, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_routine_runs_credential_cannot_run_a_calendar_mutation() {
    let request = mutation("routine").body(Body::from(CREATE_EVENT)).unwrap();
    assert_eq!(status(request).await, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_code_mode_request_with_a_persons_token_cannot_run_a_calendar_mutation() {
    let request = mutation("person")
        .header(CODE_EXECUTION_HEADER, "1")
        .body(Body::from(CREATE_EVENT))
        .unwrap();
    assert_eq!(status(request).await, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_person_in_the_app_still_runs_a_calendar_mutation() {
    let request = mutation("person").body(Body::from(CREATE_EVENT)).unwrap();
    assert_eq!(status(request).await, StatusCode::OK);
}

/// graphql-ws carries mutations too, and a socket's token may ride the query.
#[tokio::test]
async fn an_agents_socket_is_refused_however_it_sends_its_token() {
    let bearer = Request::get(GRAPHQL_SUBSCRIPTION_PATH)
        .header(header::AUTHORIZATION, "Bearer agent")
        .body(Body::empty())
        .unwrap();
    assert_eq!(status(bearer).await, StatusCode::FORBIDDEN);
    let query = Request::get(format!(
        "{GRAPHQL_SUBSCRIPTION_PATH}?{}=agent",
        macro_auth::credential::USER_TOKEN_QUERY_KEY
    ))
    .body(Body::empty())
    .unwrap();
    assert_eq!(status(query).await, StatusCode::FORBIDDEN);
}
