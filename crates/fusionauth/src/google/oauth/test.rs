use serde_json::json;
use upstream_error::{UpstreamError, UpstreamFailure};
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::{GOOGLE, refresh_google_token_at};
use crate::{UnauthedClient, error::FusionAuthClientError};

async fn refresh_answering(response: ResponseTemplate) -> FusionAuthClientError {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(response)
        .mount(&server)
        .await;

    refresh_google_token_at(
        &UnauthedClient::new(),
        &format!("{}/token", server.uri()),
        "client-id",
        "client-secret",
        "refresh-token",
    )
    .await
    .expect_err("non-200 responses are errors")
}

#[tokio::test]
async fn a_failing_google_is_unavailable() {
    let error = refresh_answering(
        ResponseTemplate::new(503).set_body_json(json!({ "error": "internal_failure" })),
    )
    .await;

    assert_eq!(
        error.upstream(),
        Some(UpstreamError {
            service: GOOGLE,
            failure: UpstreamFailure::Unavailable,
        })
    );
}

#[tokio::test]
async fn a_revoked_grant_is_still_invalid_grant() {
    let error = refresh_answering(
        ResponseTemplate::new(400).set_body_json(json!({ "error": "invalid_grant" })),
    )
    .await;

    assert!(matches!(error, FusionAuthClientError::InvalidGrant));
}
