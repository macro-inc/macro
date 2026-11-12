use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

#[derive(Debug, Default)]
struct CountingLoginAudit(AtomicUsize);

impl crate::LoginAudit for CountingLoginAudit {
    fn record<'a>(
        &'a self,
        _access_token: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = crate::Result<()>> + Send + 'a>> {
        Box::pin(async move {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
    }
}

fn login_client(base_url: String, audit: Arc<CountingLoginAudit>) -> FusionAuthClient {
    FusionAuthClient::new(
        "api-key".into(),
        "client-id".into(),
        "client-secret".into(),
        base_url,
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
    .with_login_audit(audit)
}

#[tokio::test]
async fn password_login_audits_at_the_committing_client_function() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "token": "access",
            "refreshToken": "refresh"
        })))
        .expect(1)
        .mount(&server)
        .await;
    let audit = Arc::new(CountingLoginAudit::default());

    login_client(server.uri(), audit.clone())
        .password_login("ada@example.com", "password")
        .await
        .unwrap();

    assert_eq!(audit.0.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn apple_login_audits_at_the_committing_client_function() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/identity-provider/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "token": "access",
            "refreshToken": "refresh",
            "refreshTokenId": "refresh-id"
        })))
        .expect(1)
        .mount(&server)
        .await;
    let audit = Arc::new(CountingLoginAudit::default());

    login_client(server.uri(), audit.clone())
        .apple_login("apple-idp", "id-token", "code")
        .await
        .unwrap();

    assert_eq!(audit.0.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn passwordless_login_audits_at_the_committing_client_function() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/passwordless/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "token": "access",
            "refreshToken": "refresh",
            "user": {"id": "fusion-user", "email": "ada@example.com"},
            "state": {"redirect_uri": "http://localhost/app"}
        })))
        .expect(1)
        .mount(&server)
        .await;
    let audit = Arc::new(CountingLoginAudit::default());

    login_client(server.uri(), audit.clone())
        .complete_passwordless_login("code")
        .await
        .unwrap();

    assert_eq!(audit.0.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn oauth_login_audits_at_the_committing_client_function() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "access",
            "refresh_token": "refresh",
            "expires_in": 3600
        })))
        .expect(1)
        .mount(&server)
        .await;
    let audit = Arc::new(CountingLoginAudit::default());

    login_client(server.uri(), audit.clone())
        .complete_authorization_code_grant("code")
        .await
        .unwrap();

    assert_eq!(audit.0.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn session_code_login_audits_refresh_only_at_the_login_boundary() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/jwt/refresh"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "token": "access",
            "refreshToken": "refresh",
            "refreshTokenId": "refresh-id"
        })))
        .expect(2)
        .mount(&server)
        .await;
    let audit = Arc::new(CountingLoginAudit::default());
    let client = login_client(server.uri(), audit.clone());

    client.complete_session_login("", "refresh").await.unwrap();
    client.refresh_token("", "refresh").await.unwrap();

    assert_eq!(
        audit.0.load(Ordering::SeqCst),
        1,
        "ordinary JWT refresh is not a new login"
    );
}

#[tokio::test]
async fn failed_login_does_not_write_an_audit() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/login"))
        .respond_with(ResponseTemplate::new(500))
        .expect(1)
        .mount(&server)
        .await;
    let audit = Arc::new(CountingLoginAudit::default());

    login_client(server.uri(), audit.clone())
        .password_login("ada@example.com", "password")
        .await
        .unwrap_err();

    assert_eq!(audit.0.load(Ordering::SeqCst), 0);
}

#[test]
fn oauth_authorize_url_uses_public_url() {
    let client = FusionAuthClient::new(
        "api-key".into(),
        "client-id".into(),
        "client-secret".into(),
        "http://fusionauth:9011".into(),
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
    .with_public_url("http://localhost:28005".into());

    let url = client
        .construct_oauth2_authorize_url::<()>("idp-id", None, None)
        .unwrap();

    assert!(url.starts_with("http://localhost:28005/oauth2/authorize?"));
    assert!(!url.contains("fusionauth:9011"));
}

#[test]
fn oauth_authorize_url_passes_a_prompt_to_the_identity_provider() {
    let client = FusionAuthClient::new(
        "api-key".into(),
        "client-id".into(),
        "client-secret".into(),
        "http://fusionauth:9011".into(),
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    );

    let with_prompt = client
        .construct_oauth2_authorize_url_with_prompt::<()>("idp-id", None, "select_account", None)
        .unwrap();
    let without = client
        .construct_oauth2_authorize_url::<()>("idp-id", None, None)
        .unwrap();

    let prompt = |url: &str| {
        Url::parse(url)
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "prompt")
            .map(|(_, value)| value.into_owned())
    };
    assert_eq!(prompt(&with_prompt).as_deref(), Some("select_account"));
    assert_eq!(prompt(&without), None);
    assert!(with_prompt.contains("idp_hint=idp-id"));
}
