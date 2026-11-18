use serde_json::json;
use upstream_error::{UpstreamError, UpstreamFailure};
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::{GOOGLE, refresh_google_token};
use crate::{
    UnauthedClient,
    error::{FusionAuthClientError, GrantBlockReason},
};

async fn refresh_answering(response: ResponseTemplate) -> FusionAuthClientError {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(response)
        .mount(&server)
        .await;

    refresh_google_token(
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

#[tokio::test]
async fn an_unapproved_workspace_app_is_a_blocked_grant() {
    let error = refresh_answering(ResponseTemplate::new(400).set_body_json(json!({
        "error": "access_not_configured",
        "error_description": "You can't access this app until an admin at your institution reviews and configures access for it.",
    })))
    .await;

    assert!(matches!(
        error,
        FusionAuthClientError::GrantBlocked {
            reason: GrantBlockReason::AccessNotConfigured
        }
    ));
}

#[tokio::test]
async fn an_enforced_admin_policy_is_a_blocked_grant() {
    let error = refresh_answering(
        ResponseTemplate::new(400).set_body_json(json!({ "error": "admin_policy_enforced" })),
    )
    .await;

    assert!(matches!(
        error,
        FusionAuthClientError::GrantBlocked {
            reason: GrantBlockReason::AdminPolicyEnforced
        }
    ));
}

#[tokio::test]
async fn a_broken_macro_client_is_not_a_blocked_grant() {
    let error = refresh_answering(
        ResponseTemplate::new(401).set_body_json(json!({ "error": "invalid_client" })),
    )
    .await;

    assert!(matches!(error, FusionAuthClientError::Generic(_)));
}
