use std::borrow::Cow;

use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::FusionAuthClient;

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

fn request() -> LinkUserRequest<'static> {
    LinkUserRequest {
        identity_provider_link: IdentityProviderLink {
            display_name: Cow::Borrowed("user@example.com"),
            identity_provider_id: Cow::Borrowed("idp-id"),
            identity_provider_user_id: Cow::Borrowed("google-sub"),
            user_id: Cow::Borrowed("deleted-user-id"),
            token: Cow::Borrowed("refresh-token"),
        },
    }
}

async fn link_rejected_with(field: &str, code: &str) -> Result<()> {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/identity-provider/link"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "fieldErrors": { field: [{ "code": code, "message": "rejected" }] },
            "generalErrors": [],
        })))
        .mount(&server)
        .await;

    client(server.uri()).link_user(request()).await
}

#[tokio::test]
async fn linking_to_a_deleted_user_reports_the_missing_user() {
    let result = link_rejected_with("userId", "[invalid]userId").await;

    assert!(matches!(
        result,
        Err(FusionAuthClientError::UserDoesNotExist)
    ));
}

#[tokio::test]
async fn an_existing_link_is_reported_as_already_linked() {
    let result = link_rejected_with(
        "identityProviderUserId",
        "[alreadyLinked]identityProviderUserId",
    )
    .await;

    assert!(matches!(
        result,
        Err(FusionAuthClientError::IdentityProviderLinkAlreadyExists)
    ));
}

#[tokio::test]
async fn other_rejections_stay_generic() {
    let result = link_rejected_with("identityProviderId", "[invalid]identityProviderId").await;

    assert!(matches!(result, Err(FusionAuthClientError::Generic(_))));
}
