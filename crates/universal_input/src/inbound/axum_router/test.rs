use super::*;
use crate::domain::temporal::thread_due_date::{DeadlineFact, ThreadFacts};
use ai_billing::DisabledAiAdmissionService;
use ai_usage::UsageContext;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use chrono::NaiveDate;
use jev::domain::{JevError, Probability, YesNoQuestion};
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, ValidatedCredential,
};
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;

#[derive(Clone)]
struct Identity;
impl MacroAuthorizationService for Identity {
    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt).await.map(ValidatedCredential::session)
    }

    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: "macro|router@macro.com".into(),
            fusion_user_id: Default::default(),
            permissions: None,
            organization_id: None,
        })
    }
    async fn authorize_internal(
        &self,
        key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if key != INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(claims.user_id.map(|user_id| UserContext {
            user_id,
            fusion_user_id: Default::default(),
            permissions: None,
            organization_id: None,
        }))
    }
}
const INTERNAL_KEY: &str = "internal-key";
struct Classifier;
impl YesNoClassifier for Classifier {
    async fn classify(
        &self,
        _: UsageContext,
        _: &Value,
        questions: &[YesNoQuestion],
    ) -> Result<Vec<Probability>, JevError> {
        Ok(questions
            .iter()
            .map(|_| Probability::new(0.5).unwrap())
            .collect())
    }
}
struct Extractor;
impl FieldExtractor for Extractor {
    async fn extract(
        &self,
        _: &ExtractInputRequest,
        _: UsageContext,
    ) -> Result<crate::domain::InputSuggestions, InputError> {
        Ok(crate::domain::InputSuggestions::Note(Default::default()))
    }
}
fn router() -> Router {
    Router::new().nest(
        "/universal_input",
        axum_router(UniversalInputRouterState::new(
            Arc::new(UniversalInputService::new(
                Some(Classifier),
                Extractor,
                Arc::new(DisabledAiAdmissionService),
            )),
            MacroAuthorizationState::new(Arc::new(Identity)),
        )),
    )
}
#[tokio::test]
async fn both_mounted_routes_require_authentication_before_inference() {
    for endpoint in ["classify", "extract"] {
        for token in [None, Some("invalid")] {
            let mut request = Request::post(format!("/universal_input/{endpoint}"))
                .header("content-type", "application/json");
            if let Some(token) = token {
                request = request.header("authorization", format!("Bearer {token}"));
            }
            let response = router()
                .oneshot(request.body(Body::from("{}")).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }
}
#[tokio::test]
async fn mounted_extraction_retains_the_tagged_contract_and_verbatim_note_body() {
    let response = router().oneshot(Request::post("/universal_input/extract")
        .header("content-type", "application/json").header("authorization", "Bearer valid")
        .body(Body::from(json!({"text":"# Notes\nA complete thought", "intent":"note", "revision":7, "reference_time":"2026-10-26T18:00:00Z", "time_zone":"America/New_York", "property_definitions":[]}).to_string())).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["intent"], "note");
    assert_eq!(body["revision"], 7);
    assert_eq!(body["suggestions"]["body"], "# Notes\nA complete thought");
    assert!(body["suggestions"].get("start").is_none());
}

/// Answers as if the model read a Friday deadline, remembering who is metered.
#[derive(Clone, Default)]
struct Facts {
    metered: Arc<std::sync::Mutex<Vec<UsageContext>>>,
}
impl ThreadFactExtractor for Facts {
    async fn extract_thread_facts(
        &self,
        _: &ThreadDueDateRequest,
        usage: UsageContext,
    ) -> Result<ThreadFacts, InputError> {
        self.metered.lock().unwrap().push(usage);
        Ok(ThreadFacts {
            deadlines: vec![DeadlineFact {
                message: 0,
                date: serde_json::from_value(json!({
                    "kind": "weekday", "span": "Friday", "weekday": "friday", "week": "upcoming"
                }))
                .unwrap(),
            }],
            closures: vec![],
        })
    }
}
fn due_date_router(facts: Facts) -> Router {
    Router::new().nest(
        "/universal_input",
        thread_due_date_router(ThreadDueDateRouterState::new(
            Arc::new(ThreadDueDateService::new(
                facts,
                Arc::new(DisabledAiAdmissionService),
            )),
            MacroAuthorizationState::new(Arc::new(Identity)),
        )),
    )
}
fn due_date_body() -> Body {
    Body::from(
        json!({
            "thread_id": "00000000-0000-7000-8000-000000000001",
            "subject": null,
            "messages": [{"written_on": "2026-10-27", "from_owner": false, "text": "Send it by Friday."}],
        })
        .to_string(),
    )
}
#[tokio::test]
async fn due_dates_are_served_only_to_services() {
    let facts = Facts::default();
    let response = due_date_router(facts.clone())
        .oneshot(
            Request::post("/universal_input/thread-due-date")
                .header("content-type", "application/json")
                .header("authorization", "Bearer valid")
                .body(due_date_body())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(facts.metered.lock().unwrap().is_empty());
}
#[tokio::test]
async fn a_due_date_request_with_no_owner_runs_nothing() {
    let facts = Facts::default();
    let response = due_date_router(facts.clone())
        .oneshot(
            Request::post("/universal_input/thread-due-date")
                .header("content-type", "application/json")
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .body(due_date_body())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(facts.metered.lock().unwrap().is_empty());
}
#[tokio::test]
async fn a_due_date_is_metered_against_the_owner_as_background_focus_usage() {
    let facts = Facts::default();
    let response = due_date_router(facts.clone())
        .oneshot(
            Request::post("/universal_input/thread-due-date")
                .header("content-type", "application/json")
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .header(INTERNAL_MACRO_USER_ID_HEADER, "macro|owner@macro.com")
                .body(due_date_body())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: ThreadDueDateResponse =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body.due_on, NaiveDate::from_ymd_opt(2026, 10, 30));
    let metered = facts.metered.lock().unwrap();
    assert_eq!(metered[0].feature, ai_usage::AiFeature::EmailFocus);
    assert_eq!(metered[0].user.to_string(), "macro|owner@macro.com");
    assert_eq!(
        metered[0].entity,
        Some("00000000-0000-7000-8000-000000000001".parse().unwrap())
    );
}
