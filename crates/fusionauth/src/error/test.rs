use std::{borrow::Cow, time::Duration};

use serde_json::json;
use upstream_error::{UpstreamError, UpstreamFailure};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::FusionAuthClient;
use crate::error::FusionAuthClientError;
use crate::identity_provider::{IdentityProviderLink, LinkUserRequest};

use super::SERVICE_NAME;

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

async fn links_answering(response: ResponseTemplate) -> FusionAuthClientError {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/identity-provider/link"))
        .respond_with(response)
        .mount(&server)
        .await;

    client(server.uri())
        .get_links("fusionauth-user-id", Some("github-idp-id".into()))
        .await
        .expect_err("non-200 responses are errors")
}

async fn link_user_answering(response: ResponseTemplate) -> FusionAuthClientError {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/identity-provider/link"))
        .respond_with(response)
        .mount(&server)
        .await;

    client(server.uri())
        .link_user(LinkUserRequest {
            identity_provider_link: IdentityProviderLink {
                display_name: Cow::Borrowed("octocat"),
                identity_provider_id: Cow::Borrowed("github-idp-id"),
                identity_provider_user_id: Cow::Borrowed("1"),
                user_id: Cow::Borrowed("fusionauth-user-id"),
                token: Cow::Borrowed("token"),
            },
        })
        .await
        .expect_err("non-200 responses are errors")
}

#[tokio::test]
async fn links_for_an_unknown_user_id_are_a_missing_user() {
    let error = links_answering(ResponseTemplate::new(400).set_body_json(json!({
        "fieldErrors": {
            "userId": [{
                "code": "[invalid]userId",
                "message": "No user exists with an Id [fusionauth-user-id]."
            }]
        }
    })))
    .await;

    assert!(matches!(error, FusionAuthClientError::UserDoesNotExist));
    assert_eq!(error.upstream(), None);
}

#[tokio::test]
async fn a_failing_fusionauth_is_unavailable() {
    let error = links_answering(ResponseTemplate::new(502).set_body_string("Bad Gateway")).await;

    assert_eq!(
        error.upstream(),
        Some(UpstreamError {
            service: SERVICE_NAME,
            failure: UpstreamFailure::Unavailable,
        })
    );
}

#[tokio::test]
async fn a_throttling_fusionauth_is_rate_limited() {
    let error =
        links_answering(ResponseTemplate::new(429).insert_header("retry-after", "30")).await;

    assert_eq!(
        error.upstream().map(|upstream| upstream.failure),
        Some(UpstreamFailure::RateLimited {
            retry_after: Some(Duration::from_secs(30)),
        })
    );
}

#[tokio::test]
async fn an_unrecognised_bad_request_stays_generic() {
    let error = links_answering(ResponseTemplate::new(400).set_body_json(json!({
        "fieldErrors": {
            "identityProviderId": [{ "code": "[invalid]identityProviderId" }]
        }
    })))
    .await;

    assert!(matches!(error, FusionAuthClientError::Generic(_)));
}

#[tokio::test]
async fn an_undecodable_success_is_an_invalid_response() {
    let error = {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/identity-provider/link"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html>"))
            .mount(&server)
            .await;
        client(server.uri())
            .get_links("fusionauth-user-id", None)
            .await
            .expect_err("an html body is not a link list")
    };

    assert_eq!(
        error.upstream().map(|upstream| upstream.failure),
        Some(UpstreamFailure::InvalidResponse)
    );
}

#[tokio::test]
async fn an_unreachable_fusionauth_is_unavailable() {
    let address = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind a free port");
        listener.local_addr().expect("listener address")
    };

    let error = client(format!("http://{address}"))
        .get_links("fusionauth-user-id", None)
        .await
        .expect_err("nothing listens on the port");

    assert_eq!(
        error.upstream().map(|upstream| upstream.failure),
        Some(UpstreamFailure::Unavailable)
    );
}

#[tokio::test]
async fn linking_an_already_linked_identity_is_reported() {
    let error = link_user_answering(ResponseTemplate::new(400).set_body_json(json!({
        "fieldErrors": {
            "identityProviderUserId": [{ "code": "[alreadyLinked]identityProviderUserId" }]
        }
    })))
    .await;

    assert!(matches!(
        error,
        FusionAuthClientError::IdentityProviderLinkAlreadyExists
    ));
}

#[tokio::test]
async fn linking_while_fusionauth_fails_is_unavailable() {
    let error = link_user_answering(ResponseTemplate::new(503)).await;

    assert_eq!(
        error.upstream().map(|upstream| upstream.failure),
        Some(UpstreamFailure::Unavailable)
    );
}
