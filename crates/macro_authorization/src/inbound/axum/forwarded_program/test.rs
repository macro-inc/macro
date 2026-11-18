use super::super::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use super::*;
use crate::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationExtractor,
    MacroAuthorizationService, MacroAuthorizationState, UserOrInternal, ValidatedCredential,
    is_agent_run, is_program_run,
};
use ::axum::{
    Json, Router,
    body::Body,
    http::{Request, header},
    routing::get,
};
use http_body_util::BodyExt as _;
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use std::sync::Arc;
use tower::ServiceExt as _;

const OWNER: &str = "macro|owner@example.com";
const INTERNAL_KEY: &str = "internal-key";

/// `person` is a session JWT signed for nobody; `INTERNAL_KEY` is the
/// internal key, acting as whichever user the call names.
#[derive(Clone)]
struct Owner;

fn owner() -> UserContext {
    UserContext {
        user_id: OWNER.to_owned(),
        fusion_user_id: "fusion-user-id".to_owned(),
        organization_id: None,
        permissions: None,
    }
}

impl MacroAuthorizationService for Owner {
    async fn authorize(&self, _: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        match jwt {
            "person" => Ok(ValidatedCredential::session(owner())),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(claims.user_id.map(|_| owner()))
    }
}

/// What a downstream program guard sees.
async fn guards(
    authorization: MacroAuthorizationExtractor<Owner, UserOrInternal>,
    headers: HeaderMap,
) -> Json<Value> {
    let attribution = authorization.authorization.user.attribution();
    let approval = forwarded_approval(authorization.authorization.caller, &headers);
    Json(json!({
        "attribution": format!("{attribution:?}"),
        "agentRun": is_agent_run(attribution, &headers),
        "programRun": is_program_run(attribution, &headers),
        "approval": approval.map(ProgramApproval::as_str),
    }))
}

fn downstream() -> Router {
    Router::new()
        .route("/", get(guards))
        .with_state(MacroAuthorizationState::new(Arc::new(Owner)))
}

/// An internal call for the owner, carrying `forwarded`.
fn internal_call(forwarded: HeaderMap) -> Request<Body> {
    let mut request = Request::get("/")
        .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, OWNER)
        .body(Body::empty())
        .unwrap();
    request.headers_mut().extend(forwarded);
    request
}

async fn seen(request: Request<Body>) -> (StatusCode, Value) {
    let response = downstream().oneshot(request).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

#[tokio::test]
async fn an_agents_program_reaches_the_downstream_guard_as_an_agent() {
    let program = ForwardedProgram::new(Some(bot_id::MACRO_AI_BOT_ID), None, false);
    let (status, seen) = seen(internal_call(program.headers())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        seen,
        json!({"attribution": "Agent", "agentRun": true, "programRun": true, "approval": null})
    );
}

#[tokio::test]
async fn an_owner_routine_reaches_it_as_a_routine_not_an_agent() {
    let program = ForwardedProgram::new(None, Some(Uuid::nil()), true);
    let (status, seen) = seen(internal_call(program.headers())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        seen,
        json!({"attribution": "Routine", "agentRun": false, "programRun": true, "approval": null})
    );
}

#[tokio::test]
async fn a_code_mode_request_on_a_persons_token_reaches_it_as_a_program() {
    let program = ForwardedProgram::new(None, None, true);
    let (status, seen) = seen(internal_call(program.headers())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        seen,
        json!({"attribution": "Person", "agentRun": true, "programRun": true, "approval": null})
    );
}

#[tokio::test]
async fn a_person_in_the_app_forwards_nothing_and_stays_a_person() {
    let program = ForwardedProgram::new(None, None, false);
    assert!(program.headers().is_empty());
    let (status, seen) = seen(internal_call(program.headers())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        seen,
        json!({"attribution": "Person", "agentRun": false, "programRun": false, "approval": null})
    );
}

/// The headers mean something only from an internal caller: a user's own
/// request can't name an agent to look like one, or anything else.
#[tokio::test]
async fn a_users_own_request_cannot_forward_a_program() {
    let request = Request::get("/")
        .header(header::AUTHORIZATION, "Bearer person")
        .header(
            INTERNAL_AGENT_ID_HEADER,
            bot_id::MACRO_AI_BOT_ID.to_string(),
        )
        .header(INTERNAL_ROUTINE_ID_HEADER, Uuid::nil().to_string())
        .body(Body::empty())
        .unwrap();
    let (status, seen) = seen(request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(seen["attribution"], "Person");
}

#[tokio::test]
async fn an_unreadable_forwarded_program_refuses_the_call() {
    for (name, value) in [
        (INTERNAL_AGENT_ID_HEADER, "not-a-bot"),
        (INTERNAL_ROUTINE_ID_HEADER, "not-a-routine"),
    ] {
        let mut forwarded = HeaderMap::new();
        forwarded.insert(name, value.parse().unwrap());
        let (status, _) = seen(internal_call(forwarded)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{name}: {value}");
    }
}

#[tokio::test]
async fn a_forwarded_program_with_nobody_to_act_for_refuses_the_call() {
    let program = ForwardedProgram::new(Some(bot_id::MACRO_AI_BOT_ID), None, false);
    let mut request = Request::get("/")
        .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
        .body(Body::empty())
        .unwrap();
    request.headers_mut().extend(program.headers());
    let response = Router::new()
        .route(
            "/",
            get(
                |_: MacroAuthorizationExtractor<Owner, crate::InternalOnly>| async {
                    StatusCode::OK
                },
            ),
        )
        .with_state(MacroAuthorizationState::new(Arc::new(Owner)))
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// An approved write reaches the downstream guard with its approval, which
/// only an internal caller can forward.
#[tokio::test]
async fn an_agents_approved_write_reaches_the_guard_with_its_approval() {
    for approval in [ProgramApproval::Reviewed, ProgramApproval::Quoted] {
        let program =
            ForwardedProgram::new(Some(bot_id::MACRO_AI_BOT_ID), None, false).approved(approval);
        let (status, seen) = seen(internal_call(program.headers())).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(seen["attribution"], "Agent");
        assert_eq!(seen["approval"], approval.as_str());
    }
}

#[tokio::test]
async fn a_users_own_request_cannot_approve_by_header() {
    let request = Request::get("/")
        .header(header::AUTHORIZATION, "Bearer person")
        .header(INTERNAL_PROGRAM_APPROVAL_HEADER, "reviewed")
        .body(Body::empty())
        .unwrap();
    let (status, seen) = seen(request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(seen["approval"], Value::Null);
}

#[tokio::test]
async fn an_unreadable_approval_approves_nothing() {
    let mut forwarded = ForwardedProgram::new(Some(bot_id::MACRO_AI_BOT_ID), None, false).headers();
    forwarded.insert(
        INTERNAL_PROGRAM_APPROVAL_HEADER,
        "yes please".parse().unwrap(),
    );
    let (status, seen) = seen(internal_call(forwarded)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(seen["approval"], Value::Null);
}
