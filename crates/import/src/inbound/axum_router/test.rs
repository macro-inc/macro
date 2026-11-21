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

use crate::domain::models::{ImportEntity, ImportStatus, Initiator, NotionSharing};
use crate::domain::ports::Result;
use crate::domain::service::{DiscardOutcome, ImportNotionPageOutcome, StageOutcome};
use import_notion::domain::model::{ImportScope, NotionId};

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

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> std::result::Result<
        macro_authorization::ValidatedCredential,
        Report<MacroAuthorizationError>,
    > {
        self.authorize(jwt)
            .await
            .map(macro_authorization::ValidatedCredential::session)
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
    notion_plans: Mutex<Vec<(ImportScope, Option<NotionSharing>)>>,
}

impl NotionWorkspaceImporter for FakeImportService {
    async fn prepare_notion_import(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: ImportScope,
        sharing: Option<NotionSharing>,
        _wait: std::time::Duration,
    ) -> Result<NotionImportReport> {
        assert_eq!(user.as_ref(), TEST_USER);
        self.notion_plans.lock().unwrap().push((scope, sharing));
        if sharing.is_none() {
            return Err(ImportError::SharingRequired);
        }
        Ok(NotionImportReport {
            status: Some(crate::domain::models::RunStatus::Running),
            ..NotionImportReport::default()
        })
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
        notion_plans: Mutex::new(Vec::new()),
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
async fn errors_the_caller_can_fix_answer_409_with_their_code() {
    for (error, code) in [
        (ImportError::SharingRequired, "sharing_required"),
        (ImportError::NotionNotConnected, "not_connected"),
        (
            ImportError::Tracker(import_tracker::domain::model::TrackerError::NotConnected),
            "not_connected",
        ),
        (
            ImportError::NotReady("This plan has nothing left to import."),
            "not_ready",
        ),
    ] {
        let message = error.to_string();
        let response = error_response(error);
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body, serde_json::json!({ "code": code, "error": message }));
    }
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

impl WorkspaceImporter for FakeImportService {
    async fn prepare_workspace_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        sharing: Option<NotionSharing>,
        _: std::time::Duration,
    ) -> Result<NotionImportReport> {
        self.calls.lock().unwrap().push((user.clone(), source));
        if sharing.is_none() {
            return Err(ImportError::SharingRequired);
        }
        Ok(NotionImportReport {
            status: Some(crate::domain::models::RunStatus::Ready),
            issues: 4,
            ..NotionImportReport::default()
        })
    }
    async fn workspace_import_report(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<NotionImportReport> {
        self.calls.lock().unwrap().push((user.clone(), source));
        self.notion_import_report(user).await
    }
    async fn attach_workspace_review(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
        _: Uuid,
        _: agent_session::domain::model::AgentSessionId,
    ) -> Result<u64> {
        unreachable!()
    }
    async fn start_workspace_write(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
        _: Uuid,
        _: crate::domain::models::NotionWriteChoices,
    ) -> Result<NotionImportReport> {
        unreachable!()
    }
    async fn cancel_workspace_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        self.calls.lock().unwrap().push((user.clone(), source));
        self.cancel_notion_import(user).await
    }
}

#[tokio::test]
async fn workspace_routes_authorize_and_forward_the_exact_source() {
    for source in ["notion", "linear", "jira"] {
        for (method, suffix, expected_calls) in [("GET", "", 1), ("POST", "/cancel", 2)] {
            let (router, service) = discovery_router(Ok(true));
            let response = router
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(format!("/import/workspaces/{source}{suffix}"))
                        .header("authorization", "Bearer valid")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let calls = service.calls.lock().unwrap();
            assert_eq!(calls.len(), expected_calls);
            assert!(calls.iter().all(
                |(user, forwarded)| user.as_ref() == TEST_USER && forwarded.as_ref() == source
            ));
            let (router, service) = discovery_router(Ok(true));
            let response = router
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(format!("/import/workspaces/{source}{suffix}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert!(service.calls.lock().unwrap().is_empty());
        }
    }
}

fn ledger_row(source: ImportSource, foreign_id: &str, status: ImportStatus) -> ImportEntity {
    ImportEntity {
        id: Uuid::nil(),
        user_id: TEST_USER.to_string(),
        team_id: None,
        source,
        kind: source.default_kind(),
        foreign_id: foreign_id.to_string(),
        parent_id: None,
        review_id: None,
        status,
        initiator: Initiator::Chat,
        metadata: serde_json::json!({ "title": "Roadmap" }),
        entity_id: None,
        entity_type: None,
        last_error: None,
        waiting_on: None,
        created_at: chrono::DateTime::UNIX_EPOCH,
        updated_at: chrono::DateTime::UNIX_EPOCH,
    }
}

impl ImportStager for FakeImportService {
    async fn stage(
        &self,
        user: &MacroUserIdStr<'static>,
        _initiator: Initiator,
        source: ImportSource,
        foreign_id: &str,
        _metadata: serde_json::Value,
    ) -> Result<StageOutcome> {
        self.calls.lock().unwrap().push((user.clone(), source));
        if foreign_id == "ENG-1" {
            let mut row = ledger_row(source, foreign_id, ImportStatus::Imported);
            row.user_id = "macro|teammate@example.com".to_string();
            return Ok(StageOutcome::AlreadyImported {
                entity: row,
                by_teammate: true,
            });
        }
        Ok(StageOutcome::Staged(ledger_row(
            source,
            foreign_id,
            ImportStatus::Staged,
        )))
    }

    async fn record_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        _initiator: Initiator,
        source: ImportSource,
        foreign_id: &str,
        _metadata: serde_json::Value,
        entity_id: &str,
    ) -> Result<ImportEntity> {
        self.calls.lock().unwrap().push((user.clone(), source));
        let mut row = ledger_row(source, foreign_id, ImportStatus::Imported);
        // "document-2" stands for an item an earlier request already mapped to "document-1".
        row.entity_id = Some(if entity_id == "document-2" {
            "document-1".to_string()
        } else {
            entity_id.to_string()
        });
        Ok(row)
    }

    async fn discard_entity(
        &self,
        _user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<DiscardOutcome> {
        Ok(if id.is_nil() {
            DiscardOutcome::NotFound
        } else {
            DiscardOutcome::NotDiscardable(ImportStatus::Imported)
        })
    }

    async fn list_entities(
        &self,
        user: &MacroUserIdStr<'static>,
        source: Option<ImportSource>,
        status: Option<ImportStatus>,
    ) -> Result<Vec<ImportEntity>> {
        let source = source.unwrap_or(ImportSource::Notion);
        self.calls.lock().unwrap().push((user.clone(), source));
        Ok(vec![ledger_row(
            source,
            "page",
            status.unwrap_or(ImportStatus::Staged),
        )])
    }
}

impl NotionPageImporter for FakeImportService {
    async fn import_notion_page(
        &self,
        user: &MacroUserIdStr<'static>,
        page_url_or_id: &str,
    ) -> Result<ImportNotionPageOutcome> {
        self.calls
            .lock()
            .unwrap()
            .push((user.clone(), ImportSource::Notion));
        if page_url_or_id == "not-a-page" {
            return Err(ImportError::Other(anyhow::anyhow!(
                "not a Notion page URL or id"
            )));
        }
        let mut row = ledger_row(ImportSource::Notion, page_url_or_id, ImportStatus::Imported);
        row.entity_id = Some("document-1".to_string());
        Ok(ImportNotionPageOutcome::Imported {
            entity: row,
            already_existed: false,
            by_teammate: false,
        })
    }
}

async fn ledger_call(
    method: &str,
    uri: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value, Arc<FakeImportService>) {
    let (router, service) = discovery_router(Ok(true));
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", "Bearer valid")
        .header("content-type", "application/json");
    let body = body.map_or_else(Body::empty, |body| Body::from(body.to_string()));
    let response = router.oneshot(request.body(body).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 16)
        .await
        .unwrap();
    let json = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| serde_json::Value::String(String::from_utf8_lossy(&bytes).into()));
    (status, json, service)
}

#[tokio::test]
async fn ledger_lists_the_callers_rows_with_their_filters() {
    let (status, body, service) = ledger_call(
        "GET",
        "/import/entities?source=linear&status=imported",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["entities"][0]["source"], "linear");
    assert_eq!(body["entities"][0]["status"], "imported");
    let calls = service.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0.as_ref(), TEST_USER);
}

#[tokio::test]
async fn ledger_tracking_reports_a_teammates_import() {
    let (status, body, _) = ledger_call(
        "POST",
        "/import/entities",
        Some(serde_json::json!({
            "source": "linear",
            "foreignId": "ENG-1",
            "status": "staged",
            "metadata": { "identifier": "ENG-1", "title": "Roadmap" },
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["outcome"], "already_imported_by_teammate");
    assert_eq!(body["entity"]["user_id"], "macro|teammate@example.com");
}

#[tokio::test]
async fn ledger_recording_an_import_requires_the_entity() {
    let (status, body, service) = ledger_call(
        "POST",
        "/import/entities",
        Some(serde_json::json!({
            "source": "notion",
            "foreignId": "page",
            "status": "imported",
            "metadata": { "title": "Roadmap" },
        })),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, "entityId is required when status is imported");
    assert!(service.calls.lock().unwrap().is_empty());

    let (status, body, _) = ledger_call(
        "POST",
        "/import/entities",
        Some(serde_json::json!({
            "source": "notion",
            "foreignId": "page",
            "status": "imported",
            "metadata": { "title": "Roadmap" },
            "entityId": "document-1",
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["outcome"], "recorded_imported");
    assert_eq!(body["entity"]["entity_id"], "document-1");
}

#[tokio::test]
async fn ledger_declining_answers_missing_and_unstaged_rows() {
    let (status, _, _) =
        ledger_call("DELETE", &format!("/import/entities/{}", Uuid::nil()), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _, _) =
        ledger_call("DELETE", &format!("/import/entities/{}", Uuid::max()), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn ledger_imports_a_notion_page_and_keeps_the_refusal_message() {
    let (status, body, _) = ledger_call(
        "POST",
        "/import/notion/pages",
        Some(serde_json::json!({ "page": "https://www.notion.so/Roadmap-0123456789abcdef0123456789abcdef" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["outcome"], "imported");
    assert_eq!(body["entity"]["entity_id"], "document-1");

    let (status, body, _) = ledger_call(
        "POST",
        "/import/notion/pages",
        Some(serde_json::json!({ "page": "not-a-page" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body, "not a Notion page URL or id");
}

#[tokio::test]
async fn ledger_recording_reports_an_earlier_mapping() {
    let (status, body, _) = ledger_call(
        "POST",
        "/import/entities",
        Some(serde_json::json!({
            "source": "notion",
            "foreignId": "page",
            "status": "imported",
            "metadata": { "title": "Roadmap" },
            "entityId": "document-2",
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["outcome"], "already_imported");
    assert_eq!(body["entity"]["entity_id"], "document-1");
}

async fn send(
    router: Router,
    method: &str,
    uri: &str,
    body: Option<serde_json::Value>,
) -> Response {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", "Bearer valid")
        .header("content-type", "application/json");
    let body = match body {
        Some(body) => Body::from(body.to_string()),
        None => Body::empty(),
    };
    router.oneshot(request.body(body).unwrap()).await.unwrap()
}

async fn json_body(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 65536)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn planning_a_notion_import_forwards_its_roots_and_sharing() {
    let (router, service) = discovery_router(Ok(true));
    let response = send(
        router,
        "POST",
        "/import/workspaces/notion/plan",
        Some(serde_json::json!({
            "sharing": "team",
            "roots": ["https://www.notion.so/Q3-plan-3fb607323e2e80629886fc0c028d50a7"],
        })),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["status"], "running");
    assert_eq!(
        *service.notion_plans.lock().unwrap(),
        vec![(
            ImportScope::Roots {
                ids: vec![NotionId::parse("3fb607323e2e80629886fc0c028d50a7").unwrap()],
            },
            Some(NotionSharing::Team),
        )]
    );
}

#[tokio::test]
async fn planning_without_a_sharing_choice_tells_the_caller_to_ask() {
    let (router, service) = discovery_router(Ok(true));
    let response = send(
        router,
        "POST",
        "/import/workspaces/notion/plan",
        Some(serde_json::json!({})),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(json_body(response).await["code"], "sharing_required");
    assert_eq!(
        *service.notion_plans.lock().unwrap(),
        vec![(ImportScope::Everything, None)]
    );
}

#[tokio::test]
async fn planning_rejects_roots_that_are_not_notion_pages() {
    for (source, root) in [("notion", "not a page"), ("linear", "ENG")] {
        let (router, service) = discovery_router(Ok(true));
        let response = send(
            router,
            "POST",
            &format!("/import/workspaces/{source}/plan"),
            Some(serde_json::json!({"sharing": "personal", "roots": [root]})),
        )
        .await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{source}");
        assert!(service.notion_plans.lock().unwrap().is_empty());
        assert!(service.calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn a_tracker_plan_without_a_sharing_choice_does_not_name_notion() {
    let (router, _) = discovery_router(Ok(true));
    let response = send(
        router,
        "POST",
        "/import/workspaces/linear/plan",
        Some(serde_json::json!({})),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = json_body(response).await;
    assert_eq!(body["code"], "sharing_required");
    let error = body["error"].as_str().unwrap();
    assert!(!error.contains("Notion"), "{error}");
}

#[tokio::test]
async fn planning_a_slack_import_is_a_bad_request() {
    let (router, service) = discovery_router(Ok(true));
    let response = send(
        router,
        "POST",
        "/import/workspaces/slack/plan",
        Some(serde_json::json!({"sharing": "personal"})),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn planning_a_tracker_import_forwards_the_exact_source() {
    for source in [ImportSource::Linear, ImportSource::Jira] {
        let (router, service) = discovery_router(Ok(true));
        let response = send(
            router,
            "POST",
            &format!("/import/workspaces/{}/plan", source.as_ref()),
            Some(serde_json::json!({"sharing": "ai"})),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(json_body(response).await["issues"], 4);
        assert_eq!(
            *service.calls.lock().unwrap(),
            vec![(MacroUserIdStr::parse_from_str(TEST_USER).unwrap(), source)]
        );
    }
}

#[tokio::test]
async fn ledger_and_plan_routes_require_authentication() {
    for (method, uri) in [
        ("GET", "/import/entities"),
        ("POST", "/import/entities"),
        (
            "DELETE",
            "/import/entities/00000000-0000-0000-0000-000000000002",
        ),
        ("POST", "/import/notion/pages"),
        ("POST", "/import/workspaces/notion/plan"),
    ] {
        let (router, service) = discovery_router(Ok(true));
        let response = router
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {uri}"
        );
        assert!(service.calls.lock().unwrap().is_empty());
        assert!(service.notion_plans.lock().unwrap().is_empty());
    }
}
