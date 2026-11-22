use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, header, method, path},
};

#[tokio::test]
async fn generated_operation_sends_the_exact_mailbox_binding_and_service_key() {
    let server = MockServer::start().await;
    let link = Uuid::now_v7();
    Mock::given(method("POST"))
        .and(path(format!("/internal/v1/accounts/{link}/operations")))
        .and(header("x-mailbox-binding", "3.7"))
        .and(header("x-internal-auth-key", "internal-test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .expect(1)
        .mount(&server)
        .await;
    let client = ImapServiceClient::new(server.uri(), "internal-test-key".into()).unwrap();
    let folders = client
        .folders(Binding {
            link_id: link,
            sync_generation: 3,
            grant_generation: 7,
        })
        .await
        .unwrap();
    assert!(folders.is_empty());
}

#[tokio::test]
async fn provider_failure_text_and_passwords_never_escape_client_errors() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/v1/verify"))
        .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({"code":"credentials_rejected","message":"private-provider-text-password-sentinel"})))
        .expect(1).mount(&server).await;
    let client = ImapServiceClient::new(server.uri(), "internal-test-key".into()).unwrap();
    let login = Login {
        endpoint: Endpoint {
            host: "imap.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: "owner@example.net".into(),
        },
        password: Secret("private-password-sentinel".into()),
    };
    let input = VerifyRequest {
        user_id: "macro|owner@example.net".into(),
        email: macro_user_id::email::EmailStr::parse_from_str("owner@example.net").unwrap(),
        imap: login.clone(),
        smtp: login,
        confirmed_hosts: vec!["imap.example.net".into()],
    };
    assert!(!format!("{input:?}").contains("private-password-sentinel"));
    let error = client.verify(&input).await.unwrap_err();
    assert!(matches!(error, Error::CredentialsRejected));
    assert!(!format!("{error:?} {error}").contains("sentinel"));
}

#[tokio::test]
async fn discovery_serializes_the_validated_identity_without_normalization() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/v1/discover"))
        .and(body_partial_json(
            serde_json::json!({"email": "Owner+Tag@Example.com"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "provider": null, "imap": null, "smtp": null, "steer": null,
            "hostConfirmationRequired": true, "helpUrl": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    let client = ImapServiceClient::new(server.uri(), "internal-test-key".into()).unwrap();
    let email = macro_user_id::email::EmailStr::parse_from_str("Owner+Tag@Example.com").unwrap();
    let settings = client.discover(&email.0).await.unwrap();
    assert!(settings.host_confirmation_required);
}

#[tokio::test]
async fn background_client_clones_preserve_bindings_without_reclassifying_user_requests() {
    let server = MockServer::start().await;
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 3,
        grant_generation: 7,
    };
    for class in ["interactive", "ingestion", "import"] {
        Mock::given(method("POST"))
            .and(path(format!(
                "/internal/v1/accounts/{}/operations",
                binding.link_id
            )))
            .and(header("x-mailbox-binding", "3.7"))
            .and(header("x-internal-auth-key", "internal-test-key"))
            .and(header("x-imap-work-class", class))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .expect(1)
            .mount(&server)
            .await;
    }
    let user = ImapServiceClient::new(server.uri(), "internal-test-key".into()).unwrap();
    let ingestion = user.clone().with_operation_class(OperationClass::Ingestion);
    let import = user.clone().with_operation_class(OperationClass::Import);
    assert!(ingestion.folders(binding).await.unwrap().is_empty());
    assert!(import.folders(binding).await.unwrap().is_empty());
    assert!(user.folders(binding).await.unwrap().is_empty());
}

#[tokio::test]
async fn provider_retry_delay_uses_the_response_header_or_body_instead_of_a_fixed_minute() {
    for (header, body_delay, expected) in [
        (Some("9"), None, 9),
        (None, Some(7), 7),
        (Some("5"), Some(7), 5),
    ] {
        let server = MockServer::start().await;
        let link = Uuid::now_v7();
        let mut response = ResponseTemplate::new(429)
            .set_body_json(serde_json::json!({"code":"throttled", "retryAfterSeconds":body_delay}));
        if let Some(header) = header {
            response = response.insert_header("Retry-After", header);
        }
        Mock::given(method("POST"))
            .and(path(format!("/internal/v1/accounts/{link}/operations")))
            .respond_with(response)
            .expect(1)
            .mount(&server)
            .await;
        let client = ImapServiceClient::new(server.uri(), "synthetic-internal-key".into()).unwrap();
        let error = client
            .folders(Binding {
                link_id: link,
                sync_generation: 1,
                grant_generation: 1,
            })
            .await
            .unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({"rate_limited":{"retry_after_seconds":expected}})
        );
    }
}
