use super::*;
use serde_json::{Value, json};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, method, path, query_param},
};

const PROJECT_KEY: &str = "test-project-key";
const TIMEOUT: Duration = Duration::from_secs(2);

fn loader(server: &MockServer) -> PostHogFeatureFlags {
    PostHogFeatureFlags::new(&server.uri(), PROJECT_KEY.into(), TIMEOUT).unwrap()
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|alice+flags@example.com").unwrap()
}

fn healthy(flags: Value) -> Value {
    json!({"flags": flags, "errorsWhileComputingFlags": false, "requestId": "test-request"})
}

#[tokio::test]
async fn loads_once_per_user_and_reads_a_stable_snapshot() {
    let server = MockServer::start().await;
    let alice = user();
    let bob = MacroUserIdStr::parse_from_str("macro|bob@example.com").unwrap();
    Mock::given(method("POST"))
        .and(path("/flags/"))
        .and(query_param("v", "2"))
        .and(body_partial_json(json!({
            "api_key": PROJECT_KEY, "distinct_id": alice.as_ref(),
            "evaluation_runtime": "server", "geoip_disable": true,
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(healthy(json!({
            "code": {"key": "code", "enabled": true},
            "off": {"key": "off", "enabled": false, "variant": "old"},
            "layout": {"key": "layout", "enabled": true, "variant": "compact"}
        }))))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(body_partial_json(json!({"distinct_id": bob.as_ref()})))
        .respond_with(ResponseTemplate::new(200).set_body_json(healthy(json!({
            "code": {"key": "code", "enabled": false}
        }))))
        .expect(1)
        .mount(&server)
        .await;

    let provider = loader(&server);
    let snapshot = provider.load(&alice).await.unwrap();
    let bob_snapshot = provider.clone().load(&bob).await.unwrap();
    assert!(!bob_snapshot.is_enabled("code"));
    for _ in 0..3 {
        assert!(snapshot.is_enabled("code"));
        assert!(snapshot.is_enabled("layout"));
        assert_eq!(snapshot.variant("layout"), Some("compact"));
        assert_eq!(snapshot.get("off"), Some(&FlagValue::Boolean(false)));
        assert_eq!(snapshot.variant("off"), None);
        assert!(!snapshot.is_enabled("missing"));
        assert_eq!(snapshot.get("missing"), None);
    }
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
}

#[tokio::test]
async fn accepts_an_explicitly_healthy_empty_snapshot() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(healthy(json!({}))))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        loader(&server).load(&user()).await.unwrap(),
        FlagSnapshot::default()
    );
}

#[tokio::test]
async fn rejects_incomplete_quota_and_provider_errors() {
    let responses = [
        json!({"flags": {}, "errorsWhileComputingFlags": true}),
        json!({"flags": {"code": {"key": "code", "enabled": true}}, "errorsWhileComputingFlags": true}),
        json!({"flags": {}, "errorsWhileComputingFlags": false, "quotaLimited": ["feature_flags"]}),
        json!({"flags": {}, "errorsWhileComputingFlags": false, "quotaLimited": ["database"]}),
        json!({"flags": {}, "errorsWhileComputingFlags": false, "error": "sensitive-value"}),
        json!({"flags": {}, "errorsWhileComputingFlags": false, "errors": ["sensitive-value"]}),
        healthy(json!({"code": {"key": "code", "enabled": false, "failed": true}})),
    ];
    for response in responses {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(response))
            .expect(1)
            .mount(&server)
            .await;
        let error = loader(&server).load(&user()).await.unwrap_err();
        assert!(matches!(
            error.downcast_current_context::<LoadError>(),
            Some(LoadError::IncompleteEvaluation)
        ));
        assert!(!format!("{error:?}").contains("sensitive-value"));
    }
}

#[tokio::test]
async fn rejects_malformed_success_without_leaking_body_values() {
    let responses = [
        json!({}),
        json!({"flags": {}}),
        json!({"errorsWhileComputingFlags": false}),
        json!({"flags": null, "errorsWhileComputingFlags": false}),
        json!({"flags": {}, "errorsWhileComputingFlags": null}),
        json!({"flags": {}, "errorsWhileComputingFlags": "sensitive-value"}),
        json!({"flags": {}, "errorsWhileComputingFlags": false, "quotaLimited": true}),
        json!({"flags": {}, "errorsWhileComputingFlags": false, "quotaLimited": null}),
        healthy(json!({"code": {"enabled": true}})),
        healthy(json!({"code": {"key": "code"}})),
        healthy(json!({"code": {"key": "different", "enabled": true}})),
        healthy(json!({"code": {"key": "code", "enabled": "sensitive-value"}})),
        healthy(json!({"code": {"key": "code", "enabled": true, "variant": 1}})),
        healthy(json!({"code": {"key": "code", "enabled": true, "variant": ""}})),
        healthy(json!({"code": {"key": "code", "enabled": false, "failed": null}})),
    ];
    for response in responses {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(response))
            .expect(1)
            .mount(&server)
            .await;
        let error = loader(&server).load(&user()).await.unwrap_err();
        assert!(matches!(
            error.downcast_current_context::<LoadError>(),
            Some(LoadError::MalformedResponse)
        ));
        assert!(!format!("{error:?}").contains("sensitive-value"));
    }
}

#[tokio::test]
async fn rejects_http_errors_redirects_and_non_json_without_retrying() {
    for status in [204, 302, 401, 429, 500, 502, 200] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(status)
                    .insert_header("Location", format!("{}/redirected", server.uri()))
                    .set_body_string("sensitive-value"),
            )
            .expect(1)
            .mount(&server)
            .await;
        let error = loader(&server).load(&user()).await.unwrap_err();
        let diagnostic = format!("{error:?}");
        assert!(!diagnostic.contains("sensitive-value"));
        assert!(!diagnostic.contains(PROJECT_KEY));
        assert!(!diagnostic.contains(user().as_ref()));
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn total_timeout_returns_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(healthy(json!({})))
                .set_delay(Duration::from_secs(2)),
        )
        .expect(1)
        .mount(&server)
        .await;
    let provider =
        PostHogFeatureFlags::new(&server.uri(), PROJECT_KEY.into(), Duration::from_millis(50))
            .unwrap();
    let result = tokio::time::timeout(Duration::from_secs(1), provider.load(&user())).await;
    assert!(result.expect("load must honor its own deadline").is_err());
}

#[test]
fn invalid_or_disabled_configuration_fails_at_construction() {
    for key in ["", " ", " key", "key "] {
        assert!(PostHogFeatureFlags::new("https://us.i.posthog.com", key.into(), TIMEOUT).is_err());
    }
    for host in [
        "not a url",
        "ftp://posthog.com",
        "https://user:password@posthog.com",
        "https://posthog.com/path",
        "https://posthog.com/?key=secret",
        "https://posthog.com/#fragment",
    ] {
        assert!(PostHogFeatureFlags::new(host, PROJECT_KEY.into(), TIMEOUT).is_err());
    }
    assert!(
        PostHogFeatureFlags::new(
            "https://us.i.posthog.com",
            PROJECT_KEY.into(),
            Duration::ZERO
        )
        .is_err()
    );
}

#[tokio::test]
async fn deadline_also_bounds_a_stalled_response_body() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 1];
        socket.read_exact(&mut request).await.unwrap();
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nContent-Type: application/json\r\n\r\n{").await.unwrap();
        tokio::time::sleep(Duration::from_secs(2)).await;
    });
    let provider =
        PostHogFeatureFlags::new(&host, PROJECT_KEY.into(), Duration::from_millis(100)).unwrap();
    let result = tokio::time::timeout(Duration::from_secs(1), provider.load(&user())).await;
    server.abort();
    assert!(
        result
            .expect("body read must honor the load deadline")
            .is_err()
    );
}

#[tokio::test]
async fn connection_failure_is_not_a_missing_flag() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let provider = PostHogFeatureFlags::new(&host, PROJECT_KEY.into(), TIMEOUT).unwrap();
    let error = provider.load(&user()).await.unwrap_err();
    assert!(matches!(
        error.downcast_current_context::<LoadError>(),
        Some(LoadError::Transport(_))
    ));
    assert!(!format!("{error:?}").contains(&host));
}
