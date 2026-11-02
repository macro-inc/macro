use super::*;
use ai_billing::DisabledAiAdmissionService;
use ai_usage::UsageContext;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use jev::domain::{JevError, Probability, YesNoQuestion};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError, ValidatedCredential};
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
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}
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
