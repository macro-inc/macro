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
use crate::domain::service::test::{OWNER, entity_idea, harness};

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
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(session, entity_idea("thread:reply"))
        .await
        .idea
        .unwrap();
    let app: Router = idea_router(IdeaRouterState {
        service: Arc::new(h.service),
        authorization_state: MacroAuthorizationState::new(Arc::new(Owner)),
    });
    let response = app
        .oneshot(
            Request::put(format!("/ideas/{}/draft", idea.id))
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

const USER_ID: &str = "macro|ideas-router@macro.com";
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

/// Who reached the person's feed and ideas, refusing callers in `refused`.
#[derive(Default)]
struct FakeIdeas {
    callers: Mutex<Vec<(String, IdeaCaller)>>,
    refused: Option<Uuid>,
}

impl FakeIdeas {
    fn reach(&self, user: &MacroUserIdStr<'static>, caller: IdeaCaller) -> Result<(), IdeaError> {
        self.callers
            .lock()
            .unwrap()
            .push((user.as_ref().to_owned(), caller));
        match (caller, self.refused) {
            (IdeaCaller::Agent { correlation }, Some(refused)) if correlation == Some(refused) => {
                Err(IdeaError::Generating)
            }
            _ => Ok(()),
        }
    }
}

impl IdeaApi for FakeIdeas {
    async fn feed(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: IdeaCaller,
        _: Option<chrono_tz::Tz>,
    ) -> Result<Ideas, IdeaError> {
        self.reach(user, caller)?;
        Ok(Ideas {
            ideas: Vec::new(),
            done: Vec::new(),
        })
    }

    async fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: IdeaCaller,
        _: Uuid,
    ) -> Result<(), IdeaError> {
        self.reach(user, caller)
    }

    async fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: IdeaCaller,
        _: Uuid,
    ) -> Result<(), IdeaError> {
        self.reach(user, caller)
    }

    fn brief(&self, _: GenerationTrigger, _: chrono_tz::Tz) -> String {
        unreachable!()
    }

    async fn kept(&self, _: Uuid) -> Result<u32, IdeaError> {
        unreachable!()
    }

    async fn settle_runs(&self) -> Result<usize, IdeaError> {
        unreachable!()
    }

    async fn review(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
    ) -> Result<IdeaReview, IdeaError> {
        unreachable!()
    }

    async fn suggest(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: SuggestIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        unreachable!()
    }

    async fn rewrite(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RewriteIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        unreachable!()
    }

    async fn retire(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RetireIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        unreachable!()
    }

    async fn attach_draft(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: AttachDraft,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        unreachable!()
    }
}

/// Send `method uri` with `jwt`, optionally marked as a program's request,
/// inside the code-mode invocation `correlation` when given.
async fn send(
    service: &Arc<FakeIdeas>,
    method: &str,
    uri: &str,
    jwt: &str,
    program: bool,
    correlation: Option<Uuid>,
) -> StatusCode {
    let router: Router = idea_router(IdeaRouterState {
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
    let request = request.body(Body::empty()).unwrap();
    agent_correlation::context::scope(correlation, router.oneshot(request))
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn the_persons_own_agent_reaches_their_feed_and_ideas_as_an_agent() {
    let service = Arc::new(FakeIdeas::default());
    let idea = Uuid::now_v7();
    let invocation = Uuid::now_v7();
    let accept = format!("/ideas/{idea}/accept");
    let dismiss = format!("/ideas/{idea}/dismiss");
    let cases = [
        // The person in the app.
        ("POST", &accept, SESSION_JWT, false, None),
        // Their chat agent's program: a code-mode credential.
        (
            "GET",
            &"/ideas".to_owned(),
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
    let agent = IdeaCaller::Agent {
        correlation: Some(invocation),
    };
    let callers: Vec<IdeaCaller> = service
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
            IdeaCaller::User,
            agent,
            agent,
            agent,
            IdeaCaller::Agent { correlation: None },
        ]
    );
}

#[tokio::test]
async fn a_refused_generation_session_gets_a_403() {
    let generation = Uuid::now_v7();
    let service = Arc::new(FakeIdeas {
        refused: Some(generation),
        ..FakeIdeas::default()
    });
    let idea = Uuid::now_v7();
    for (method, uri) in [
        ("GET", "/ideas".to_owned()),
        ("POST", format!("/ideas/{idea}/accept")),
        ("POST", format!("/ideas/{idea}/dismiss")),
    ] {
        let status = send(&service, method, &uri, AGENT_JWT, true, Some(generation)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
    }
}
