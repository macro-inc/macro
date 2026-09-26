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
