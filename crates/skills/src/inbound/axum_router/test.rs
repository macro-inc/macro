use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use chrono::{TimeZone, Utc};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState, ValidatedCredential,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use super::{SkillRouterState, skills_router};
use crate::domain::model::{SkillContent, SkillError, SkillMatchType, SkillSummary};
use crate::domain::ports::SkillService;

const USER_ID: &str = "macro|skills-router@example.com";
const DEPLOY_SKILL: Uuid = uuid::uuid!("0190b6a5-6a40-7c4e-8b1e-2f6d1f0a9c11");

#[derive(Debug, PartialEq)]
enum Call {
    List(String),
    Search(String, String, SkillMatchType),
    Read(String, Uuid),
}

#[derive(Default)]
struct FakeSkills {
    calls: Mutex<Vec<Call>>,
}

fn deploy_skill() -> SkillSummary {
    SkillSummary {
        document_id: DEPLOY_SKILL,
        name: "Deploy checklist".to_owned(),
        description: Some("Use when deploying a service".to_owned()),
        updated_at: Some(Utc.with_ymd_and_hms(2026, 11, 1, 9, 30, 0).unwrap()),
    }
}

fn catch_me_up() -> &'static system_skills::SystemSkill {
    &system_skills::catch_me_up::SKILL
}

impl SkillService for FakeSkills {
    async fn read_skill(
        &self,
        user_id: &MacroUserIdStr<'_>,
        document_id: Uuid,
    ) -> Result<SkillContent, SkillError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Read(user_id.as_ref().to_owned(), document_id));
        if document_id == catch_me_up().id() {
            return Ok(SkillContent {
                document_id,
                name: catch_me_up().name.to_owned(),
                content: "Summarize what changed.".to_owned(),
            });
        }
        if document_id == DEPLOY_SKILL {
            return Ok(SkillContent {
                document_id,
                name: "Deploy checklist".to_owned(),
                content: "1. Run the tests.".to_owned(),
            });
        }
        Err(SkillError::AccessDenied(
            entity_access::domain::models::AccessError::Unauthorized,
        ))
    }

    async fn search_skills(
        &self,
        user_id: &MacroUserIdStr<'_>,
        query: &str,
        match_type: SkillMatchType,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        self.calls.lock().unwrap().push(Call::Search(
            user_id.as_ref().to_owned(),
            query.to_owned(),
            match_type,
        ));
        if query.trim().is_empty() {
            return Err(SkillError::InvalidRequest(
                "query must not be empty".to_owned(),
            ));
        }
        Ok(vec![deploy_skill()])
    }

    async fn list_skills(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::List(user_id.as_ref().to_owned()));
        Ok(vec![
            deploy_skill(),
            SkillSummary {
                document_id: catch_me_up().id(),
                name: catch_me_up().name.to_owned(),
                description: None,
                updated_at: None,
            },
        ])
    }

    async fn list_routable_skills(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        unreachable!("routing is not served over HTTP")
    }
}

#[derive(Clone, Default)]
struct FakeAuthorization;

impl MacroAuthorizationService for FakeAuthorization {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            "valid" => Ok(UserContext {
                user_id: USER_ID.to_owned(),
                ..UserContext::default()
            }),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
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

fn router(skills: Arc<FakeSkills>) -> Router {
    skills_router::<_, _, ()>(SkillRouterState::new(
        skills,
        MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    ))
}

fn get(uri: &str, authorization: Option<&str>) -> Request<Body> {
    let mut request = Request::builder().method("GET").uri(uri);
    if let Some(token) = authorization {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    request.body(Body::empty()).unwrap()
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn listing_returns_user_and_built_in_skills() {
    let skills = Arc::new(FakeSkills::default());
    let response = router(skills.clone())
        .oneshot(get("/skills", Some("valid")))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({ "skills": [
            {
                "id": "0190b6a5-6a40-7c4e-8b1e-2f6d1f0a9c11",
                "name": "Deploy checklist",
                "description": "Use when deploying a service",
                "updatedAt": "2026-11-01T09:30:00Z",
                "builtIn": false
            },
            {
                "id": catch_me_up().id().to_string(),
                "name": catch_me_up().name,
                "builtIn": true
            }
        ] })
    );
    assert_eq!(
        *skills.calls.lock().unwrap(),
        vec![Call::List(USER_ID.to_owned())]
    );
}

#[tokio::test]
async fn a_query_searches_by_name_with_the_given_match_type() {
    let skills = Arc::new(FakeSkills::default());
    let app = router(skills.clone());

    let partial = app
        .clone()
        .oneshot(get("/skills?query=deplo", Some("valid")))
        .await
        .unwrap();
    assert_eq!(partial.status(), StatusCode::OK);
    assert_eq!(
        json_body(partial).await["skills"][0]["name"],
        json!("Deploy checklist")
    );

    let exact = app
        .oneshot(get("/skills?query=deploy&matchType=exact", Some("valid")))
        .await
        .unwrap();
    assert_eq!(exact.status(), StatusCode::OK);

    assert_eq!(
        *skills.calls.lock().unwrap(),
        vec![
            Call::Search(
                USER_ID.to_owned(),
                "deplo".to_owned(),
                SkillMatchType::Partial
            ),
            Call::Search(
                USER_ID.to_owned(),
                "deploy".to_owned(),
                SkillMatchType::Exact
            ),
        ]
    );
}

#[tokio::test]
async fn a_blank_query_is_a_bad_request() {
    let response = router(Arc::new(FakeSkills::default()))
        .oneshot(get("/skills?query=%20", Some("valid")))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await,
        json!({ "error": "query must not be empty", "code": "invalid_request" })
    );
}

#[tokio::test]
async fn reading_returns_a_built_in_skills_instructions() {
    let skills = Arc::new(FakeSkills::default());
    let id = catch_me_up().id();
    let response = router(skills.clone())
        .oneshot(get(&format!("/skills/{id}"), Some("valid")))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({
            "id": id.to_string(),
            "name": catch_me_up().name,
            "content": "Summarize what changed.",
            "builtIn": true
        })
    );
    assert_eq!(
        *skills.calls.lock().unwrap(),
        vec![Call::Read(USER_ID.to_owned(), id)]
    );
}

#[tokio::test]
async fn reading_returns_a_skill_documents_instructions() {
    let response = router(Arc::new(FakeSkills::default()))
        .oneshot(get(&format!("/skills/{DEPLOY_SKILL}"), Some("valid")))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({
            "id": DEPLOY_SKILL.to_string(),
            "name": "Deploy checklist",
            "content": "1. Run the tests.",
            "builtIn": false
        })
    );
}

#[tokio::test]
async fn reading_a_skill_the_caller_cannot_view_is_not_found() {
    let response = router(Arc::new(FakeSkills::default()))
        .oneshot(get(&format!("/skills/{}", Uuid::nil()), Some("valid")))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        json_body(response).await,
        json!({ "error": "skill not found or access denied", "code": "skill_not_found" })
    );
}

#[tokio::test]
async fn unauthenticated_requests_do_no_work() {
    let skills = Arc::new(FakeSkills::default());
    let app = router(skills.clone());

    for token in [None, Some("forged")] {
        for uri in ["/skills".to_owned(), format!("/skills/{DEPLOY_SKILL}")] {
            let response = app.clone().oneshot(get(&uri, token)).await.unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }

    assert!(skills.calls.lock().unwrap().is_empty());
}
