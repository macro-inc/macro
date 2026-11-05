use std::sync::{Arc, Mutex};

use serde_json::json;
use upstream_error::UpstreamFailure;
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::FusionAuthClient;
use crate::error::{FusionAuthClientError, OAuth2TokenError};

const REFRESH_TOKEN: &str = "refresh-token-value";

fn client(base_url: String) -> FusionAuthClient {
    FusionAuthClient::new(
        "api-key".into(),
        "application-id".into(),
        "client-secret".into(),
        base_url,
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
}

async fn refresh_answering(response: ResponseTemplate) -> crate::Result<crate::oauth::OAuth2Grant> {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .and(body_string_contains("grant_type=refresh_token"))
        .respond_with(response)
        .expect(1)
        .mount(&server)
        .await;

    client(server.uri())
        .complete_refresh_token_grant(REFRESH_TOKEN)
        .await
}

#[tokio::test]
async fn refresh_grant_returns_the_tokens() {
    let grant = refresh_answering(ResponseTemplate::new(200).set_body_json(json!({
        "access_token": "access",
        "refresh_token": "rotated",
        "expires_in": 3600,
    })))
    .await
    .expect("a 200 is a grant");

    assert_eq!(grant.access_token, "access");
    assert_eq!(grant.refresh_token, "rotated");
    assert_eq!(grant.expires_in, 3600);
}

#[tokio::test]
async fn refresh_grant_reports_a_refresh_token_fusionauth_no_longer_holds() {
    let error = refresh_answering(ResponseTemplate::new(400).set_body_json(json!({
        "error": "invalid_grant",
        "error_description": "The refresh_token is invalid.",
        "error_reason": "refresh_token_not_found",
    })))
    .await
    .expect_err("a 400 is a refusal");

    let FusionAuthClientError::OAuth2TokenRefused(refusal) = error else {
        panic!("expected a refusal, got {error:?}");
    };
    assert!(refusal.is_invalid_grant());
    assert_eq!(
        refusal,
        OAuth2TokenError {
            error: "invalid_grant".into(),
            error_reason: Some("refresh_token_not_found".into()),
            error_description: Some("The refresh_token is invalid.".into()),
        }
    );
    assert_eq!(
        refusal.to_string(),
        "invalid_grant (refresh_token_not_found): The refresh_token is invalid."
    );
}

#[tokio::test]
async fn refresh_grant_reports_a_rejected_client_as_a_refusal_that_is_not_invalid_grant() {
    let error = refresh_answering(ResponseTemplate::new(401).set_body_json(json!({
        "error": "invalid_client",
        "error_description": "Invalid client authentication.",
        "error_reason": "invalid_client_authentication",
    })))
    .await
    .expect_err("a 401 is a refusal");

    let FusionAuthClientError::OAuth2TokenRefused(refusal) = error else {
        panic!("expected a refusal, got {error:?}");
    };
    assert!(!refusal.is_invalid_grant());
    assert_eq!(refusal.error, "invalid_client");
}

#[tokio::test]
async fn refresh_grant_keeps_a_400_without_an_oauth_body_generic() {
    let error = refresh_answering(ResponseTemplate::new(400).set_body_string("<html>bad</html>"))
        .await
        .expect_err("a 400 is an error");

    assert!(
        matches!(&error, FusionAuthClientError::Generic(body) if body.message == "<html>bad</html>"),
        "got {error:?}"
    );
}

#[tokio::test]
async fn refresh_grant_reports_an_outage_as_upstream() {
    let error = refresh_answering(ResponseTemplate::new(503).set_body_string("unavailable"))
        .await
        .expect_err("a 503 is an error");

    assert_eq!(
        error.upstream().map(|upstream| upstream.failure),
        Some(UpstreamFailure::Unavailable)
    );
}

#[tokio::test]
async fn authorization_code_grant_reports_a_spent_code_as_invalid_grant() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .and(body_string_contains("grant_type=authorization_code"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": "invalid_request",
            "error_description": "Invalid Authorization Code",
            "error_reason": "auth_code_not_found",
        })))
        .expect(1)
        .mount(&server)
        .await;

    let error = client(server.uri())
        .complete_authorization_code_grant("spent-code")
        .await
        .expect_err("a 400 is a refusal");

    assert!(
        matches!(&error, FusionAuthClientError::OAuth2TokenRefused(refusal) if refusal.is_invalid_grant()),
        "got {error:?}"
    );
}

#[derive(Clone, Default)]
struct CapturedLogs(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for CapturedLogs {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().expect("log buffer").extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn refresh_grant_never_records_the_refresh_token_in_logs() {
    let refusal = || {
        ResponseTemplate::new(400).set_body_json(json!({
            "error": "invalid_grant",
            "error_reason": "refresh_token_not_found",
        }))
    };
    let logs = CapturedLogs::default();
    let writer = logs.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);

    // While this is the only subscriber, a callsite first hit on another test's
    // thread is cached as disabled, because that thread has no subscriber. Hit
    // the callsites so they exist, then recompute them on this thread.
    refresh_answering(refusal())
        .await
        .expect_err("a 400 is a refusal");
    tracing::callsite::rebuild_interest_cache();

    refresh_answering(refusal())
        .await
        .expect_err("a 400 is a refusal");

    let logs = String::from_utf8(logs.0.lock().expect("log buffer").clone()).expect("utf-8 logs");
    assert!(
        logs.contains("refresh_token_not_found"),
        "the refusal is logged: {logs}"
    );
    assert!(
        !logs.contains(REFRESH_TOKEN),
        "the refresh token leaked into logs: {logs}"
    );
}
