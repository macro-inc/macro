use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path},
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
        email: "owner@example.net".into(),
        imap: login.clone(),
        smtp: login,
        confirmed_hosts: vec!["imap.example.net".into()],
    };
    assert!(!format!("{input:?}").contains("private-password-sentinel"));
    let error = client.verify(&input).await.unwrap_err();
    assert!(matches!(error, Error::CredentialsRejected));
    assert!(!format!("{error:?} {error}").contains("sentinel"));
}
