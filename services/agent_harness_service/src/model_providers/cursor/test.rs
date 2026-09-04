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

async fn cursor_api(
    State(calls): State<Arc<Mutex<Vec<(String, String)>>>>,
    request: Request,
) -> Json<serde_json::Value> {
    calls.lock().unwrap().push((
        request.method().to_string(),
        request.uri().path().to_owned(),
    ));
    Json(serde_json::json!({
        "items": [
            {"id": "default", "displayName": "Auto", "variants": []},
            {"id": "fast", "displayName": "Fast", "variants": []}
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
