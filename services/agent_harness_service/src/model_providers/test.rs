use super::*;
use agent_client_protocol::schema::v1::{
    SessionConfigOption, SessionConfigSelectOption, SessionConfigValueId,
};
use agent_harness::outbound::cursor::keys::ResolvedCursorConfig;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::schema::v0::{
    ModelProbeResult, ToRuntimeMessage, ToServerMessage,
};
use axum::extract::{Request, State};
use axum::routing::any;
use axum::{Json, Router};
use cursor_api_key::cipher::CursorApiKey;
use std::sync::Mutex;

#[tokio::test]
async fn disconnected_macrod_is_reported_without_creating_session_state() {
    let provider = MacrodModels::new(RuntimeRegistry::new());

    assert!(matches!(
        provider.probe(HarnessId::TEST_A).await,
        Err(ModelProbeError::Disconnected)
    ));
}

#[tokio::test]
async fn connected_macrod_returns_its_fresh_probe_options() {
    let registry = RuntimeRegistry::new();
    let (carrier, mut runtime) = Channel::duplex();
    registry.attach(HarnessId::TEST_A, carrier);
    let provider = MacrodModels::new(registry);
    let (release, held) = tokio::sync::oneshot::channel();

    let response = tokio::spawn(async move {
        let ToRuntimeMessage::ModelProbeRequest { request_id } =
            runtime.rx.recv().await.expect("probe request")
        else {
            panic!("expected model probe request");
        };
        runtime
            .tx
            .send(ToServerMessage::ModelProbeResponse {
                request_id,
                result: ModelProbeResult::Available {
                    config_options: vec![SessionConfigOption::select(
                        "model",
                        "Model",
                        SessionConfigValueId::new("fast"),
                        vec![SessionConfigSelectOption::new("fast", "Fast")],
                    )],
                },
            })
            .unwrap();
        let _ = held.await;
    });

    let RawModelProbe::Options(options) = provider.probe(HarnessId::TEST_A).await.unwrap() else {
        panic!("connected macrod should advertise options");
    };
    let _ = release.send(());
    response.await.unwrap();
    assert_eq!(options.len(), 1);
}

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
async fn cursor_probe_lists_models_without_creating_an_agent() {
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
