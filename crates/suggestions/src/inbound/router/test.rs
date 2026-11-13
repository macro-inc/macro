use std::sync::Mutex;

use axum::body::Body;
use axum::http::{Request, header};
use macro_authorization::{
    CODE_EXECUTION_HEADER, CredentialOrigin, InternalIdentityClaims, MacroAuthorizationError,
    ValidatedCredential, ValidatedIdentity,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::CreationPrincipal;
use model_user::UserContext;
use rootcause::Report;
use sqlx::PgPool;
use tower::ServiceExt;

use super::*;
use crate::domain::model::GenerationTrigger;
use crate::domain::service::test::{OWNER, entity_suggestion, harness};

/// Every bearer token is the owner's own session.
#[derive(Clone)]
struct Owner;

impl MacroAuthorizationService for Owner {
    async fn authorize(&self, _: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Ok(UserContext {
            user_id: OWNER.to_owned(),
            fusion_user_id: "owner".to_owned(),
            ..Default::default()
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt).await.map(ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_person_themself_cannot_attach_a_draft(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(session, entity_suggestion("thread:reply"))
        .await
        .suggestion
        .unwrap();
    let app: Router = suggestion_router(SuggestionRouterState {
        service: Arc::new(h.service),
        authorization_state: MacroAuthorizationState::new(Arc::new(Owner)),
    });
    let response = app
        .oneshot(
            Request::put(format!("/suggestions/{}/draft", suggestion.id))
                .header("authorization", "Bearer owner")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "emailDraftId": Uuid::now_v7(),
                        "reason": "Drafted the reply",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

const USER_ID: &str = "macro|suggestions-router@macro.com";
/// The person's own session in the app.
const SESSION_JWT: &str = "session";
/// A code-mode credential: a Macro API token carrying the agent.
const AGENT_JWT: &str = "agent";

#[derive(Clone)]
struct FakeAuthorization;

fn context() -> UserContext {
    UserContext {
        user_id: USER_ID.to_owned(),
        fusion_user_id: "cccccccc-cccc-cccc-cccc-cccccccccccc".to_owned(),
        permissions: None,
        organization_id: None,
    }
}

impl MacroAuthorizationService for FakeAuthorization {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            SESSION_JWT | AGENT_JWT => Ok(context()),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        match jwt {
            SESSION_JWT => Ok(ValidatedCredential::session(context())),
            AGENT_JWT => Ok(ValidatedCredential {
                identity: ValidatedIdentity {
                    agent_id: Some(bot_id::MACRO_NEW_BOT_ID),
                    agent_via: None,
                    user_id: USER_ID.to_owned(),
                    fusion_user_id: context().fusion_user_id,
                    organization_id: None,
                    permissions: None,
                },
                origin: CredentialOrigin::MacroApiJwt,
            }),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Who reached the person's feed and suggestions, refusing callers in `refused`.
#[derive(Default)]
struct FakeSuggestions {
    callers: Mutex<Vec<(String, SuggestionCaller)>>,
    /// Whether each accept was the person's own.
    by_person: Mutex<Vec<bool>>,
    refused: Option<Uuid>,
}

impl FakeSuggestions {
    fn reach(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
    ) -> Result<(), SuggestionError> {
        self.callers
            .lock()
            .unwrap()
            .push((user.as_ref().to_owned(), caller));
        match (caller, self.refused) {
            (SuggestionCaller::Agent { correlation }, Some(refused))
                if correlation == Some(refused) =>
            {
                Err(SuggestionError::Generating)
            }
            _ => Ok(()),
        }
    }
}

impl SuggestionApi for FakeSuggestions {
    async fn feed(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        _: Option<chrono_tz::Tz>,
    ) -> Result<SuggestionFeed, SuggestionError> {
        self.reach(user, caller)?;
        Ok(SuggestionFeed {
            suggestions: Vec::new(),
            done: Vec::new(),
        })
    }

    async fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        _: Uuid,
        accept: crate::domain::model::Accept,
    ) -> Result<(), SuggestionError> {
        self.by_person.lock().unwrap().push(accept.by_person);
        self.reach(user, caller)
    }

    async fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        _: Uuid,
    ) -> Result<(), SuggestionError> {
        self.reach(user, caller)
    }

    fn brief(&self, _: GenerationTrigger, _: chrono_tz::Tz) -> String {
        unreachable!()
    }

    async fn feed_changes(&self, _: Uuid, _: Uuid) -> Result<u32, SuggestionError> {
        unreachable!()
    }

    async fn settle_runs(&self) -> Result<usize, SuggestionError> {
        unreachable!()
    }

    async fn review(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
    ) -> Result<SuggestionsReview, SuggestionError> {
        unreachable!()
    }

    async fn suggest(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: NewSuggestion,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        unreachable!()
    }

    async fn rewrite(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RewriteSuggestion,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        unreachable!()
    }

    async fn retire(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RetireSuggestionRequest,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        unreachable!()
    }

    async fn attach_draft(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: AttachDraft,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        unreachable!()
    }
}

/// Send `method uri` with `jwt`, optionally marked as a program's request,
/// inside the code-mode invocation `correlation` when given.
async fn send(
    service: &Arc<FakeSuggestions>,
    method: &str,
    uri: &str,
    jwt: &str,
    program: bool,
    correlation: Option<Uuid>,
) -> StatusCode {
    let router: Router = suggestion_router(SuggestionRouterState {
        service: Arc::clone(service),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    });
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {jwt}"));
    if program {
        request = request.header(CODE_EXECUTION_HEADER, "1");
    }
    // Accepting carries the suggestion as the caller read it.
    let body = if uri.ends_with("/accept") {
        request = request.header(header::CONTENT_TYPE, "application/json");
        Body::from(r#"{"updatedAt":"2026-11-10T09:00:00.123456Z"}"#)
    } else {
        Body::empty()
    };
    let request = request.body(body).unwrap();
    agent_correlation::context::scope(correlation, router.oneshot(request))
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn the_persons_own_agent_reaches_their_feed_and_suggestions_as_an_agent() {
    let service = Arc::new(FakeSuggestions::default());
    let suggestion = Uuid::now_v7();
    let invocation = Uuid::now_v7();
    let accept = format!("/suggestions/{suggestion}/accept");
    let dismiss = format!("/suggestions/{suggestion}/dismiss");
    let cases = [
        // The person in the app.
        ("POST", &accept, SESSION_JWT, false, None),
        // Their chat agent's program: a code-mode credential.
        (
            "GET",
            &"/suggestions".to_owned(),
            AGENT_JWT,
            true,
            Some(invocation),
        ),
        ("POST", &accept, AGENT_JWT, true, Some(invocation)),
        ("POST", &dismiss, AGENT_JWT, true, Some(invocation)),
        // A program with no invocation, such as a public MCP client's.
        ("POST", &dismiss, SESSION_JWT, true, None),
    ];
    for (method, uri, jwt, program, correlation) in cases {
        let status = send(&service, method, uri, jwt, program, correlation).await;
        assert!(status.is_success(), "{method} {uri} as {jwt}: {status}");
    }
    let agent = SuggestionCaller::Agent {
        correlation: Some(invocation),
    };
    let callers: Vec<SuggestionCaller> = service
        .callers
        .lock()
        .unwrap()
        .iter()
        .map(|(user, caller)| {
            assert_eq!(user, USER_ID);
            *caller
        })
        .collect();
    assert_eq!(
        callers,
        [
            SuggestionCaller::User,
            agent,
            agent,
            agent,
            SuggestionCaller::Agent { correlation: None },
        ]
    );
}

#[tokio::test]
async fn a_refused_generation_session_gets_a_403() {
    let generation = Uuid::now_v7();
    let service = Arc::new(FakeSuggestions {
        refused: Some(generation),
        ..FakeSuggestions::default()
    });
    let suggestion = Uuid::now_v7();
    for (method, uri) in [
        ("GET", "/suggestions".to_owned()),
        ("POST", format!("/suggestions/{suggestion}/accept")),
        ("POST", format!("/suggestions/{suggestion}/dismiss")),
    ] {
        let status = send(&service, method, &uri, AGENT_JWT, true, Some(generation)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
    }
}

/// Only the person's own session, with no program's marks, is the person:
/// an agent's credential, a program's request or a code-mode invocation
/// acts for them, and their accept never counts as the person's.
#[tokio::test]
async fn only_the_persons_own_session_accepts_as_the_person() {
    let service = Arc::new(FakeSuggestions::default());
    let accept = format!("/suggestions/{}/accept", Uuid::now_v7());
    for (jwt, program, correlation) in [
        (SESSION_JWT, false, None),
        (SESSION_JWT, true, None),
        (SESSION_JWT, false, Some(Uuid::now_v7())),
        (AGENT_JWT, false, None),
    ] {
        let status = send(&service, "POST", &accept, jwt, program, correlation).await;
        assert!(
            status.is_success(),
            "{jwt} {program} {correlation:?}: {status}"
        );
    }
    assert_eq!(
        *service.by_person.lock().unwrap(),
        [true, false, false, false]
    );
    assert_eq!(
        service.callers.lock().unwrap()[0].1,
        SuggestionCaller::User,
        "only the first is the person"
    );
    assert!(
        service.callers.lock().unwrap()[1..]
            .iter()
            .all(|(_, caller)| matches!(caller, SuggestionCaller::Agent { .. }))
    );
    // Without the suggestion as read, accepting is refused.
    let router: Router = suggestion_router(SuggestionRouterState {
        service: Arc::clone(&service),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    });
    let bare = Request::builder()
        .method("POST")
        .uri(&accept)
        .header(header::AUTHORIZATION, format!("Bearer {SESSION_JWT}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router.oneshot(bare).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
}
