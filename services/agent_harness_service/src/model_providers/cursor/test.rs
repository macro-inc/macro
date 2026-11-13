use std::sync::{Arc, Mutex};

use agent_harness::domain::model_load::{CursorModelProbe as _, RawModelProbe};
use agent_harness::outbound::cursor::keys::ResolvedCursorConfig;
use axum::extract::{Request, State};
use axum::routing::any;
use axum::{Json, Router};
use cursor_api_key::cipher::CursorApiKey;

use super::*;

struct TestCursorKeys;

impl CursorApiKeys for TestCursorKeys {
    async fn resolve(
        &self,
        _owner: &MacroUserIdStr<'_>,
    ) -> agent_harness::domain::error::Result<ResolvedCursorConfig> {
        Ok(ResolvedCursorConfig {
            key: CursorApiKey::parse("crsr_test").unwrap(),
            default_model_id: Some("fast".to_owned()),
        })
    }
}

struct NoCursorKey;

impl CursorApiKeys for NoCursorKey {
    async fn resolve(
        &self,
        _owner: &MacroUserIdStr<'_>,
    ) -> agent_harness::domain::error::Result<ResolvedCursorConfig> {
        Err(HarnessError::CursorNotConnected)
    }
}

/// Every (method, path) the fake Cursor API was asked for.
type RecordedCalls = Arc<Mutex<Vec<(String, String)>>>;

async fn cursor_api(
    State(calls): State<RecordedCalls>,
    request: Request,
) -> Json<serde_json::Value> {
    calls.lock().unwrap().push((
        request.method().to_string(),
        request.uri().path().to_owned(),
    ));
    Json(serde_json::json!({
        "items": [
            {"id": "default", "displayName": "Auto", "variants": []},
            {"id": "fast", "displayName": "Fast", "variants": []},
            {"id": "thoughtful", "displayName": "Thoughtful", "variants": [
                {"params": [{"id": "effort", "value": "low"}], "isDefault": true},
                {"params": [{"id": "effort", "value": "ultra"}], "isDefault": false}
            ]}
        ]
    }))
}

#[tokio::test]
async fn probe_lists_models_without_creating_an_agent() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .fallback(any(cursor_api))
        .with_state(Arc::clone(&calls));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let provider = CursorModels::new(TestCursorKeys, format!("http://{address}"));

    let RawModelProbe::Options(options) = provider
        .probe(&MacroUserIdStr::try_from_email("models@example.com").unwrap())
        .await
        .unwrap()
    else {
        panic!("cursor should return options");
    };

    assert_eq!(options.len(), 1);
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        &[("GET".to_owned(), "/v1/models".to_owned())]
    );
    server.abort();
}

#[tokio::test]
async fn capabilities_use_the_selected_model_instead_of_the_account_default() {
    use agent_harness::domain::capability_discovery::{CapabilityProbe, RawCapabilityProbe};
    let calls = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .fallback(any(cursor_api))
        .with_state(Arc::clone(&calls));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let provider = CursorModels::new(TestCursorKeys, format!("http://{address}"));
    let caller = MacroUserIdStr::try_from_email("models@example.com").unwrap();
    let RawCapabilityProbe::Options(options) =
        CapabilityProbe::probe(&provider, &caller, Some("thoughtful"))
            .await
            .unwrap()
    else {
        panic!("options");
    };
    let options = serde_json::to_value(options).unwrap();
    assert_eq!(options[0]["currentValue"], "thoughtful");
    assert_eq!(options[1]["currentValue"], "low");
    assert_eq!(options[1]["options"][1]["value"], "ultra");
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        &[("GET".to_owned(), "/v1/models".to_owned())]
    );
    server.abort();
}

#[tokio::test]
async fn a_caller_without_a_cursor_key_is_not_connected_rather_than_a_provider_failure() {
    use agent_harness::domain::capability_discovery::CapabilityProbe;
    let provider = CursorModels::new(NoCursorKey, "http://127.0.0.1:9".to_owned());
    let caller = MacroUserIdStr::try_from_email("models@example.com").unwrap();

    assert!(matches!(
        CapabilityProbe::probe(&provider, &caller, None).await,
        Err(CapabilityProbeError::Disconnected)
    ));
    assert!(matches!(
        CursorModelProbe::probe(&provider, &caller).await,
        Err(ModelProbeError::Disconnected)
    ));
}

/// A fake Cursor API answering every request with `status` and `body`.
async fn refusing_cursor_api(
    status: u16,
    body: &'static str,
) -> (String, tokio::task::JoinHandle<()>) {
    let app = Router::new().fallback(any(move || async move {
        (
            axum::http::StatusCode::from_u16(status).unwrap(),
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            body,
        )
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), server)
}

/// What Cursor answered `GET /v1/models` with in production for a team-owned
/// service token.
const TEAM_SERVICE_TOKEN_BODY: &str = r#"{"code":"permission_denied","message":"[permission_denied] Error","details":[{"type":"aiserver.v1.ErrorDetails","debug":{"error":"ERROR_NOT_HIGH_ENOUGH_PERMISSIONS","details":{"title":"Access Denied","detail":"Team-owned service tokens cannot call user API routes; use a service account API key","isRetryable":false},"isExpected":true}}]}"#;

#[tokio::test]
async fn a_key_cursor_refuses_is_a_rejected_credential_for_both_probes() {
    use agent_harness::domain::capability_discovery::CapabilityProbe;
    let (base_url, server) = refusing_cursor_api(403, TEAM_SERVICE_TOKEN_BODY).await;
    let provider = CursorModels::new(TestCursorKeys, base_url);
    let caller = MacroUserIdStr::try_from_email("models@example.com").unwrap();

    match CursorModelProbe::probe(&provider, &caller).await {
        Err(ModelProbeError::CredentialRejected(message)) => {
            assert_eq!(message, CredentialRejected::USER_MESSAGE);
        }
        other => panic!("expected a rejected credential, got {other:?}"),
    }
    match CapabilityProbe::probe(&provider, &caller, Some("fast")).await {
        Err(CapabilityProbeError::CredentialRejected(message)) => {
            assert_eq!(message, CredentialRejected::USER_MESSAGE);
        }
        other => panic!("expected a rejected credential, got {other:?}"),
    }
    server.abort();
}

#[tokio::test]
async fn a_cursor_outage_is_still_a_provider_failure() {
    use agent_harness::domain::capability_discovery::CapabilityProbe;
    let (base_url, server) = refusing_cursor_api(503, r#"{"error":"down"}"#).await;
    let provider = CursorModels::new(TestCursorKeys, base_url);
    let caller = MacroUserIdStr::try_from_email("models@example.com").unwrap();

    assert!(matches!(
        CursorModelProbe::probe(&provider, &caller).await,
        Err(ModelProbeError::Failed(_))
    ));
    assert!(matches!(
        CapabilityProbe::probe(&provider, &caller, None).await,
        Err(CapabilityProbeError::Failed(_))
    ));
    server.abort();
}
