use super::*;
use ai_billing::{AiAdmissionError, DenyReason};
use axum::{body::Body, http::Request};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use std::sync::Mutex;
use tower::ServiceExt;

use crate::domain::ports::Result;

const TEST_USER: &str = "macro|test@example.com";

#[derive(Clone)]
struct FakeAuthorization;

impl MacroAuthorizationService for FakeAuthorization {
    async fn authorize(
        &self,
        jwt: &str,
    ) -> std::result::Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: TEST_USER.to_string(),
            fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> std::result::Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

struct FakeImportService {
    calls: Mutex<Vec<(MacroUserIdStr<'static>, ImportSource)>>,
    outcome: Mutex<Option<Result<bool>>>,
    cancels: Mutex<Vec<MacroUserIdStr<'static>>>,
}

impl NotionWorkspaceImporter for FakeImportService {
    async fn prepare_notion_import(
        &self,
        _user: &MacroUserIdStr<'static>,
        _scope: import_notion::domain::model::ImportScope,
        _sharing: Option<crate::domain::models::NotionSharing>,
        _wait: std::time::Duration,
    ) -> Result<NotionImportReport> {
        unimplemented!("routes never plan")
    }

    async fn notion_import_report(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<NotionImportReport> {
        let cancelled = !self.cancels.lock().unwrap().is_empty();
        Ok(NotionImportReport {
            status: Some(if cancelled {
                crate::domain::models::RunStatus::Dismissed
            } else {
                crate::domain::models::RunStatus::Importing
            }),
            imported: 3,
            ..NotionImportReport::default()
        })
    }

    async fn attach_notion_review(
        &self,
        _user: &MacroUserIdStr<'static>,
        _review_id: Uuid,
        _session_id: agent_session::domain::model::AgentSessionId,
    ) -> Result<u64> {
        unimplemented!("routes never attach reviews")
    }

    async fn start_notion_write(
        &self,
        _user: &MacroUserIdStr<'static>,
        _review_id: Uuid,
        _choices: crate::domain::models::NotionWriteChoices,
    ) -> Result<NotionImportReport> {
        unimplemented!("routes never write")
    }

    async fn cancel_notion_import(&self, user: &MacroUserIdStr<'static>) -> Result<bool> {
        self.cancels.lock().unwrap().push(user.clone());
        Ok(true)
    }
}

impl ImportService for FakeImportService {
    async fn start_discovery(
        &self,
        user: MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        self.calls.lock().unwrap().push((user, source));
        self.outcome.lock().unwrap().take().unwrap()
    }

    async fn state(&self, _user: MacroUserIdStr<'static>) -> Result<ImportState> {
        unimplemented!("discovery must not read state")
    }

    async fn run_import(
        &self,
        _user: MacroUserIdStr<'static>,
        _import_ids: Vec<Uuid>,
        _discard_ids: Vec<Uuid>,
    ) -> Result<RunImportOutcome> {
        unimplemented!("discovery must not import candidates")
    }
}

fn discovery_router(outcome: Result<bool>) -> (Router, Arc<FakeImportService>) {
    let service = Arc::new(FakeImportService {
        calls: Mutex::new(Vec::new()),
        outcome: Mutex::new(Some(outcome)),
        cancels: Mutex::new(Vec::new()),
    });
    let router = import_router(ImportRouterState {
        service: service.clone(),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    });
    (router, service)
}

fn discovery_request(source: &str, authenticated: bool) -> Request<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri(format!("/import/runs/{source}/discover"));
    if authenticated {
        request = request.header("authorization", "Bearer valid");
    }
    request.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn discovery_rejects_unknown_source_without_calling_service() {
    let (router, service) = discovery_router(Ok(true));
    let response = router
        .oneshot(discovery_request("unknown", true))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.calls.lock().unwrap().is_empty());
    let body = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    assert_eq!(body, "unknown import source: unknown");
}

#[tokio::test]
async fn discovery_returns_unsupported_source_message() {
    let (router, service) =
        discovery_router(Err(ImportError::UnsupportedDiscovery(ImportSource::Linear)));
    let response = router
        .oneshot(discovery_request("linear", true))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    assert!(
        std::str::from_utf8(&body)
            .unwrap()
            .contains("not supported")
    );
    assert_eq!(service.calls.lock().unwrap()[0].1, ImportSource::Linear);
}

#[tokio::test]
async fn discovery_accepts_slack_idempotently_and_forwards_identity() {
    for started in [true, false] {
        let (router, service) = discovery_router(Ok(started));
        let response = router
            .oneshot(discovery_request("slack", true))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        assert!(body.is_empty());
        assert_eq!(
            *service.calls.lock().unwrap(),
            vec![(
                MacroUserIdStr::parse_from_str(TEST_USER).unwrap(),
                ImportSource::Slack
            )]
        );
    }
}

#[tokio::test]
async fn discovery_requires_authentication() {
    let (router, service) = discovery_router(Ok(true));
    let response = router
        .oneshot(discovery_request("slack", false))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn discovery_hides_internal_error_details() {
    let (router, _) = discovery_router(Err(ImportError::Other(anyhow::anyhow!(
        "private diagnostic"
    ))));
    let response = router
        .oneshot(discovery_request("slack", true))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    assert!(body.is_empty());
}

#[tokio::test]
async fn admission_failures_use_shared_http_contract() {
    for (error, status) in [
        (
            AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
            StatusCode::PAYMENT_REQUIRED,
        ),
        (
            AiAdmissionError::Unavailable,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let response = error_response(ImportError::Admission(error));
        assert_eq!(response.status(), status);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], error.code());
        assert_eq!(body["error"], error.to_string());
    }
}

#[test]
fn other_errors_remain_internal() {
    let response = error_response(ImportError::Other(anyhow::anyhow!("private diagnostic")));
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn cancelling_a_notion_import_cancels_it_for_the_caller_and_reports_where_it_stopped() {
    let (router, service) = discovery_router(Ok(true));
    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/import/notion/cancel")
                .header("authorization", "Bearer valid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        service.cancels.lock().unwrap().as_slice(),
        [MacroUserIdStr::parse_from_str(TEST_USER)
            .unwrap()
            .into_owned()]
    );
    let body = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    let report: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(report["status"], "dismissed");
    assert_eq!(report["imported"], 3);
}
