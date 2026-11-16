use axum::http::StatusCode;
use fusionauth::error::{FusionAuthClientError, GenericErrorResponse, GrantBlockReason};
use serde_json::json;
use upstream_error::UpstreamFailure;
use wiremock::matchers::{body_partial_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::api::internal::fusionauth_fixture;

const IDP: &str = "google_gmail";
const USER: &str = "fusionauth-user";

#[tokio::test]
async fn token_lookup_ignores_email_case_without_selecting_a_different_inbox() {
    let server = MockServer::start().await;
    let client = Arc::new(
        FusionAuthClient::new(
            "api-key".into(),
            "application-id".into(),
            "client-secret".into(),
            server.uri(),
            "http://localhost/callback".into(),
            "google-client-id".into(),
            "google-client-secret".into(),
        )
        .with_google_oauth_urls(
            format!("{}/token", server.uri()),
            format!("{}/revoke", server.uri()),
        ),
    );
    Mock::given(method("GET"))
        .and(path("/api/identity-provider/search"))
        .and(query_param("name", IDP))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "identityProviders": [{"id": "gmail-idp", "name": IDP}], "total": 1
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/identity-provider/link"))
        .and(query_param("userId", USER))
        .and(query_param("identityProviderId", "gmail-idp"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "identityProviderLinks": [{
                "displayName": "another@example.com",
                "identityProviderId": "gmail-idp", "identityProviderName": IDP,
                "identityProviderType": "OpenIDConnect",
                "identityProviderUserId": "another-google-identity",
                "insertInstant": 0, "lastLoginInstant": 0,
                "tenantId": "tenant", "userId": USER, "token": "another-grant"
            }, {
                "displayName": "Inbox@Example.com",
                "identityProviderId": "gmail-idp", "identityProviderName": IDP,
                "identityProviderType": "OpenIDConnect",
                "identityProviderUserId": "matching-google-identity",
                "insertInstant": 0, "lastLoginInstant": 0,
                "tenantId": "tenant", "userId": USER, "token": "matching-grant"
            }]
        })))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .and(body_partial_json(
            json!({"refresh_token": "matching-grant"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "matching-access-token", "expires_in": 3600,
            "scope": "https://www.googleapis.com/auth/gmail.modify",
            "token_type": "Bearer", "id_token": "id-token"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let response = get_access_token(
        client.clone(),
        &GoogleAccessTokenParams {
            fusionauth_user_id: USER.into(),
            email: "inbox@example.com".into(),
        },
        IDP,
    )
    .await
    .expect("the matching inbox should yield a token regardless of case");
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let token: GoogleAccessToken = serde_json::from_slice(&body).unwrap();
    assert_eq!(token.access_token, "matching-access-token");

    let response = get_access_token(
        client,
        &GoogleAccessTokenParams {
            fusionauth_user_id: USER.into(),
            email: "inbox+other@example.com".into(),
        },
        IDP,
    )
    .await
    .expect_err("case folding must not strip aliases or choose another inbox");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

fn google_outage() -> FusionAuthClientError {
    FusionAuthClientError::Upstream {
        service: "Google",
        failure: UpstreamFailure::Unavailable,
    }
}

fn sign_in_outage() -> FusionAuthClientError {
    FusionAuthClientError::Upstream {
        service: "The sign-in service",
        failure: UpstreamFailure::Unavailable,
    }
}

fn generic() -> FusionAuthClientError {
    FusionAuthClientError::Generic(GenericErrorResponse {
        message: "boom".into(),
    })
}

#[test]
fn a_google_outage_during_refresh_is_service_unavailable() {
    let response = refresh_error_response(google_outage(), USER, IDP);

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[test]
fn a_revoked_grant_during_refresh_is_still_forbidden() {
    let response = refresh_error_response(FusionAuthClientError::InvalidGrant, USER, IDP);

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[test]
fn a_grant_blocked_by_the_users_organization_is_forbidden() {
    let error = FusionAuthClientError::GrantBlocked {
        reason: GrantBlockReason::AccessNotConfigured,
    };

    let response = refresh_error_response(error, USER, IDP);

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[test]
fn an_unknown_refresh_failure_is_still_internal() {
    let response = refresh_error_response(generic(), USER, IDP);

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[test]
fn a_sign_in_outage_while_fetching_links_is_service_unavailable() {
    let response = links_error_response(sign_in_outage(), USER, IDP);

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[test]
fn a_sign_in_outage_while_finding_the_provider_is_service_unavailable() {
    let response = identity_provider_error_response(sign_in_outage(), IDP);

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[test]
fn a_missing_provider_has_no_grant() {
    let response =
        identity_provider_error_response(FusionAuthClientError::NoIdentityProviderFound, IDP);

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_deleted_user_has_no_google_grant() {
    let (_server, auth_client) = fusionauth_fixture::without_user("deleted-user").await;
    let params = GoogleAccessTokenParams {
        fusionauth_user_id: "deleted-user".into(),
        email: "inbox@macro.com".into(),
    };

    let response = get_access_token(
        Arc::new(auth_client),
        &params,
        fusionauth_fixture::GMAIL_IDP_NAME,
    )
    .await
    .expect_err("a deleted user has no grant to mint a token from");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
