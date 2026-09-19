use super::*;

#[test]
fn connection_status_has_stable_safe_camel_case_shape() {
    let disconnected = CodexConnectionStatus::from(ConnectionStatus {
        connected: false,
        account_id: None,
        environment_id: None,
    });
    assert_eq!(
        serde_json::to_value(disconnected).unwrap(),
        serde_json::json!({
            "connected":false,"email":null,"accountId":null,"environmentId":null
        })
    );
    let configured = CodexConnectionStatus::from(ConnectionStatus {
        connected: true,
        account_id: Some("account-a".into()),
        environment_id: Some("env-a".into()),
    });
    assert_eq!(
        serde_json::to_value(configured).unwrap(),
        serde_json::json!({
            "connected":true,"email":null,"accountId":"account-a","environmentId":"env-a"
        })
    );
}
#[test]
fn login_instructions_expose_only_browser_values_and_deadline() {
    let id = Uuid::now_v7();
    let started = CodexLoginStart {
        attempt_id: id,
        verification_url: "https://auth.openai.com/codex/device".into(),
        user_code: "TEST-CODE".into(),
        expires_at: chrono::DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
        poll_interval_seconds: 8,
    };
    let value = serde_json::to_value(started).unwrap();
    let keys: std::collections::BTreeSet<_> = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        std::collections::BTreeSet::from([
            "attemptId",
            "verificationUrl",
            "userCode",
            "expiresAt",
            "pollIntervalSeconds"
        ])
    );
    assert_eq!(value["attemptId"], id.to_string());
    assert_eq!(value["pollIntervalSeconds"], 8);
    assert_eq!(
        serde_json::to_value(CodexLoginPoll {
            status: CodexLoginState::Failed
        })
        .unwrap(),
        serde_json::json!({"status":"failed"})
    );
}
#[tokio::test]
async fn deployment_unavailable_returns_503_without_exposing_operator_configuration() {
    let response = ApiError::Unavailable.into_response();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        value,
        serde_json::json!({"message":"Codex connection is unavailable in this deployment"})
    );
}
#[tokio::test]
async fn domain_errors_have_distinct_http_status_and_only_safe_message() {
    for (error, expected) in [
        (ConnectionError::InvalidInput, StatusCode::BAD_REQUEST),
        (ConnectionError::NotFound, StatusCode::NOT_FOUND),
        (ConnectionError::NotConnected, StatusCode::CONFLICT),
        (ConnectionError::AlreadyConnected, StatusCode::CONFLICT),
        (ConnectionError::Provider, StatusCode::BAD_GATEWAY),
        (ConnectionError::Storage, StatusCode::INTERNAL_SERVER_ERROR),
        (
            ConnectionError::Encryption,
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        let message = error.to_string();
        let response = ApiError::from(error).into_response();
        assert_eq!(response.status(), expected);
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({"message":message})
        );
    }
}

#[test]
fn explicit_environment_configuration_and_repository_metadata_wire_contract() {
    for invalid in [
        serde_json::json!({}),
        serde_json::json!({"environmentId":null}),
        serde_json::json!({"environmentId":"env-a","branch":"other"}),
    ] {
        assert!(serde_json::from_value::<CodexConfigRequest>(invalid).is_err());
    }
    let request: CodexConfigRequest =
        serde_json::from_value(serde_json::json!({"environmentId":"env-a"})).unwrap();
    assert_eq!(request.environment_id, "env-a");
    let environment = CodexEnvironment {
        id: "env-a".into(),
        label: None,
        repositories: vec![CodexEnvironmentRepository {
            full_name: "owner/repo".into(),
            clone_url: "https://github.com/owner/repo.git".into(),
            default_branch: "trunk".into(),
        }],
    };
    assert_eq!(
        serde_json::to_value(environment).unwrap(),
        serde_json::json!({"id":"env-a","label":null,"repositories":[{"fullName":"owner/repo","cloneUrl":"https://github.com/owner/repo.git","defaultBranch":"trunk"}]})
    );
}
