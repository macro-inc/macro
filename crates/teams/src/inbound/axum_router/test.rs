use axum::{
    body::to_bytes,
    extract::{FromRef, FromRequestParts},
    http::{Request, StatusCode, header},
    response::IntoResponse,
};
use macro_authorization::{
    MacroAuthorizationError, SharedMacroAuthorizationExtractor, SharedMacroAuthorizationService,
    testing::{FakeMacroAuthorizationService, bearer},
};
use serde_json::{Value, json};

use crate::domain::model::{
    CustomerError, DeleteTeamError, InviteUsersToTeamError, JoinTeamError, RemoveTeamInviteError,
    RemoveUserFromTeamError,
};

use super::{invite_to_team::InviteToTeamError, premium_user::PremiumUserRejection};

const CUSTOMER_ERROR_SENTINEL: &str = "sentinel customer repository failure";

struct AuthorizationState {
    authorization_service: SharedMacroAuthorizationService,
}

impl FromRef<AuthorizationState> for SharedMacroAuthorizationService {
    fn from_ref(state: &AuthorizationState) -> Self {
        state.authorization_service.clone()
    }
}

fn customer_error() -> CustomerError {
    CustomerError::StorageLayerError(anyhow::anyhow!(CUSTOMER_ERROR_SENTINEL))
}

async fn response_parts(error: impl IntoResponse) -> (StatusCode, String, Value) {
    let response = error.into_response();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("error response body should be readable");
    let body_text = String::from_utf8(body.to_vec()).expect("error response body should be UTF-8");
    let body_json =
        serde_json::from_slice(&body).expect("error response body should contain valid JSON");

    (status, body_text, body_json)
}

async fn assert_customer_error_is_obfuscated(error: impl IntoResponse) {
    let (status, body_text, body_json) = response_parts(error).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body_text, r#"{"message":"internal server error"}"#);
    assert_eq!(body_json, json!({ "message": "internal server error" }));
    assert!(!body_text.contains(CUSTOMER_ERROR_SENTINEL));
}

#[tokio::test]
async fn premium_user_authorization_rejection_is_preserved() {
    let state = AuthorizationState {
        authorization_service: SharedMacroAuthorizationService::new(
            FakeMacroAuthorizationService::never(MacroAuthorizationError::CredentialsExpired),
        ),
    };
    let request = bearer(Request::builder(), "expired-token")
        .body(())
        .expect("test request should be valid");
    let (mut parts, _) = request.into_parts();
    let authorization_rejection =
        match SharedMacroAuthorizationExtractor::from_request_parts(&mut parts, &state).await {
            Ok(_) => panic!("expired credentials should be rejected"),
            Err(rejection) => rejection,
        };

    let response = PremiumUserRejection::from(authorization_rejection).into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response.headers().get(header::WWW_AUTHENTICATE),
        Some(&axum::http::HeaderValue::from_static(
            "Bearer error=\"invalid_token\", error_description=\"jwt expired\"",
        )),
    );
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("authorization rejection body should be readable");
    assert_eq!(body.as_ref(), br#"{"message":"jwt expired"}"#);
}

#[tokio::test]
async fn delete_team_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(DeleteTeamError::CustomerError(customer_error())).await;
}

#[tokio::test]
async fn invite_users_to_team_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(InviteUsersToTeamError::CustomerError(customer_error()))
        .await;
}

#[tokio::test]
async fn invite_to_team_customer_error_response_is_obfuscated_but_display_retains_details() {
    let error = InviteToTeamError::InviteUsersToTeamError(InviteUsersToTeamError::CustomerError(
        customer_error(),
    ));

    assert!(error.to_string().contains(CUSTOMER_ERROR_SENTINEL));
    assert_customer_error_is_obfuscated(error).await;
}

#[tokio::test]
async fn join_team_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(JoinTeamError::CustomerError(customer_error())).await;
}

#[tokio::test]
async fn remove_team_invite_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(RemoveTeamInviteError::CustomerError(customer_error()))
        .await;
}

#[tokio::test]
async fn remove_user_from_team_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(RemoveUserFromTeamError::CustomerError(customer_error()))
        .await;
}

#[tokio::test]
async fn invite_to_team_validation_error_response_is_preserved() {
    let (status, body_text, _) = response_parts(InviteToTeamError::InvalidEmails).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body_text, r#"{"message":"invalid emails detected"}"#);
}

#[tokio::test]
async fn remove_team_invite_not_found_response_is_preserved() {
    let (status, body_text, _) =
        response_parts(RemoveTeamInviteError::TeamInviteDoesNotExist).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body_text, r#"{"message":"team invite does not exist"}"#);
}

#[tokio::test]
async fn remove_team_owner_validation_response_is_preserved() {
    let (status, body_text, _) = response_parts(RemoveUserFromTeamError::CannotRemoveOwner).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body_text, r#"{"message":"cannot remove owner"}"#);
}
