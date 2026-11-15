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

/// What the fake answers a regeneration with.
#[derive(Clone, Copy, Default)]
enum Regeneration {
    #[default]
    Starts,
    Running,
    Cooldown(chrono::DateTime<chrono::Utc>),
    Off,
}

/// Records onboarding starts, app loads and regenerations; has no
/// suggestions yet.
#[derive(Default)]
struct Starts {
    calls: Mutex<Vec<(String, chrono_tz::Tz)>>,
    regeneration: Regeneration,
    overview: Option<GenerationOverview>,
}

impl Starts {
    fn calls(&self) -> Vec<(String, chrono_tz::Tz)> {
        self.calls.lock().unwrap().clone()
    }
}

impl StartGeneration for Starts {
    async fn start_onboarding(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> Result<bool, GenerationError> {
        self.calls
            .lock()
            .unwrap()
            .push((user.as_ref().to_owned(), timezone));
        Ok(true)
    }

    async fn regenerate(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> Result<(), GenerationError> {
        self.calls
            .lock()
            .unwrap()
            .push((format!("regenerate {}", user.as_ref()), timezone));
        match self.regeneration {
            Regeneration::Starts => Ok(()),
            Regeneration::Running => Err(GenerationError::Running),
            Regeneration::Cooldown(available_at) => Err(GenerationError::Cooldown { available_at }),
            Regeneration::Off => Err(GenerationError::NotFound),
        }
    }

    async fn overview(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> Result<GenerationOverview, GenerationError> {
        self.overview.ok_or(GenerationError::NotFound)
    }

    async fn seen(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> Result<(), GenerationError> {
        self.calls
            .lock()
            .unwrap()
            .push((format!("seen {}", user.as_ref()), timezone));
        Ok(())
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

/// Loading the app tells the service the caller was seen, in their zone.
#[tokio::test]
async fn an_app_load_records_the_caller_as_seen() {
    let starts = Arc::new(Starts::default());
    let response = app(&starts)
        .oneshot(
            Request::post("/suggestions/seen?timezone=Asia/Tokyo")
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        starts.calls(),
        [(format!("seen {USER}"), chrono_tz::Asia::Tokyo)]
    );
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
    assert_eq!(starts.calls(), [(USER.to_owned(), chrono_tz::Asia::Tokyo)]);
}

async fn call(
    app: Router,
    request: Request<Body>,
) -> (StatusCode, header::HeaderMap, serde_json::Value) {
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    (status, headers, body)
}

fn regenerate_request(query: &str) -> Request<Body> {
    Request::post(format!("/suggestions/regenerate{query}"))
        .header(header::AUTHORIZATION, "Bearer valid")
        .body(Body::empty())
        .unwrap()
}

/// Asking for fresh suggestions starts them in the caller's zone, and
/// answers at once that they started.
#[tokio::test]
async fn regenerating_starts_in_the_background() {
    let starts = Arc::new(Starts::default());
    let (status, _, body) = call(app(&starts), regenerate_request("?timezone=Asia/Tokyo")).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body, serde_json::json!({ "started": true }));
    assert_eq!(
        starts.calls(),
        [(format!("regenerate {USER}"), chrono_tz::Asia::Tokyo)]
    );
}

/// While one of the caller's generations runs, asking again is a conflict
/// that says so.
#[tokio::test]
async fn regenerating_while_one_runs_is_a_conflict() {
    let starts = Arc::new(Starts {
        regeneration: Regeneration::Running,
        ..Starts::default()
    });
    let (status, _, body) = call(app(&starts), regenerate_request("?timezone=Asia/Tokyo")).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body, serde_json::json!({ "reason": "running" }));
}

/// Within the hour, asking again says when the caller may, in the body and
/// in `Retry-After`.
#[tokio::test]
async fn regenerating_within_the_hour_says_when_to_ask_again() {
    let available_at = chrono::Utc::now() + chrono::TimeDelta::minutes(20);
    let starts = Arc::new(Starts {
        regeneration: Regeneration::Cooldown(available_at),
        ..Starts::default()
    });
    let (status, headers, body) =
        call(app(&starts), regenerate_request("?timezone=Asia/Tokyo")).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    let at: chrono::DateTime<chrono::Utc> =
        serde_json::from_value(body["availableAt"].clone()).unwrap();
    assert_eq!(at, available_at);
    let wait: i64 = headers[header::RETRY_AFTER]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((1_190..=1_200).contains(&wait), "{wait}");
}

/// With suggestions off for the caller, there is nothing to regenerate; a
/// request without a zone is refused before reaching the service.
#[tokio::test]
async fn regenerating_needs_suggestions_and_a_zone() {
    let starts = Arc::new(Starts {
        regeneration: Regeneration::Off,
        ..Starts::default()
    });
    let (status, _, _) = call(app(&starts), regenerate_request("?timezone=Asia/Tokyo")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let starts = Arc::new(Starts::default());
    let (status, _, _) = call(app(&starts), regenerate_request("")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(starts.calls().is_empty());
}

fn overview_request() -> Request<Body> {
    Request::get("/suggestions/generation")
        .header(header::AUTHORIZATION, "Bearer valid")
        .body(Body::empty())
        .unwrap()
}

/// The caller's generations read as the web app polls them: camel-cased,
/// with absent fields left out.
#[tokio::test]
async fn the_generation_overview_reads_as_the_web_app_polls_it() {
    use crate::domain::generation::{GenerationState, GenerationStatus};

    let at = |rfc3339: &str| {
        chrono::DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .to_utc()
    };
    let running = GenerationOverview {
        state: GenerationState::Running,
        trigger: Some(GenerationTrigger::Manual),
        started_at: Some(at("2026-11-13T10:00:00Z")),
        last_finished_at: None,
        last_outcome: None,
        regenerate_available_at: Some(at("2026-11-13T11:00:00Z")),
    };
    let starts = Arc::new(Starts {
        overview: Some(running),
        ..Starts::default()
    });
    let (status, _, body) = call(app(&starts), overview_request()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        serde_json::json!({
            "state": "running",
            "trigger": "manual",
            "startedAt": "2026-11-13T10:00:00Z",
            "regenerateAvailableAt": "2026-11-13T11:00:00Z",
        })
    );

    let idle = GenerationOverview {
        state: GenerationState::Idle,
        trigger: None,
        started_at: None,
        last_finished_at: Some(at("2026-11-13T03:10:00Z")),
        last_outcome: Some(GenerationStatus::Partial),
        regenerate_available_at: None,
    };
    let starts = Arc::new(Starts {
        overview: Some(idle),
        ..Starts::default()
    });
    let (_, _, body) = call(app(&starts), overview_request()).await;
    assert_eq!(
        body,
        serde_json::json!({
            "state": "idle",
            "lastFinishedAt": "2026-11-13T03:10:00Z",
            "lastOutcome": "partial",
        })
    );

    let off = Arc::new(Starts::default());
    let (status, _, _) = call(app(&off), overview_request()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
