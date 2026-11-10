use std::sync::Mutex;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use macro_authorization::{
    CredentialOrigin, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
    ValidatedIdentity,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use scheduled_action::domain::suggestions::model::GenerationStatus;
use tower::ServiceExt;

use super::*;

const USER: &str = "macro|generation-router@macro.com";

#[derive(Clone, Copy)]
struct Jwt;

impl JwtValidator for Jwt {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        match jwt {
            "valid" => Ok(ValidatedCredential {
                origin: CredentialOrigin::Session,
                identity: ValidatedIdentity {
                    agent_id: None,
                    agent_via: None,
                    user_id: USER.to_owned(),
                    fusion_user_id: "fusion-user".to_owned(),
                    organization_id: None,
                    permissions: None,
                },
            }),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }
}

/// Records onboarding starts; has no suggestions yet.
#[derive(Default)]
struct Starts(Mutex<Vec<(String, chrono_tz::Tz)>>);

impl StartGeneration for Starts {
    async fn start_onboarding(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> Result<bool, GenerationError> {
        self.0
            .lock()
            .unwrap()
            .push((user.as_ref().to_owned(), timezone));
        Ok(true)
    }

    async fn routine_suggestions(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> Result<RoutineSuggestions, GenerationError> {
        Ok(RoutineSuggestions {
            status: GenerationStatus::Generating,
            suggestions: Vec::new(),
        })
    }
}

fn app(starts: &Arc<Starts>) -> Router {
    let auth = MacroAuthorizationServiceImpl::new(
        Jwt,
        InternalAuthConfig {
            api_key: "internal-key".to_owned(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    generation_router(GenerationRouterState {
        service: Arc::clone(starts),
        authorization_state: MacroAuthorizationState::new(Arc::new(auth)),
    })
}

/// Bundles from before the unified generation still call the old route: it
/// starts onboarding and answers with the person's routine suggestions.
#[tokio::test]
async fn the_old_generate_route_starts_onboarding_and_answers_with_suggestions() {
    let starts = Arc::new(Starts::default());
    let app = app(&starts);
    let response = app
        .oneshot(
            Request::post("/scheduled-actions/suggestions/generate?timezone=Asia/Tokyo")
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["status"], "generating");
    assert_eq!(
        *starts.0.lock().unwrap(),
        [(USER.to_owned(), chrono_tz::Asia::Tokyo)]
    );
}
