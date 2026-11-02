use axum::http::StatusCode;
use fusionauth::error::{FusionAuthClientError, GenericErrorResponse};
use upstream_error::UpstreamFailure;

use super::*;
use crate::api::internal::fusionauth_fixture;

const IDP: &str = "google_gmail";
const USER: &str = "fusionauth-user";

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
