use std::borrow::Cow;

use axum::{
    Json,
    body::to_bytes,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::MacroAuthorizationRejection;
use model_error_response::ErrorResponse;

use super::ExtractorError;

async fn response_parts(response: Response) -> (StatusCode, String) {
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("authorization error response body should be readable");
    let body = String::from_utf8(body.to_vec())
        .expect("authorization error response body should be UTF-8");

    (status, body)
}

#[tokio::test]
async fn authorization_rejection_preserves_status_and_owned_message() {
    let rejection: MacroAuthorizationRejection = (
        StatusCode::FORBIDDEN,
        Json(ErrorResponse {
            message: Cow::Owned("access forbidden".to_string()),
        }),
    );

    let response = ExtractorError::from(rejection).into_response();
    let (status, body) = response_parts(response).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, r#"{"message":"access forbidden"}"#);
}

#[tokio::test]
async fn authorization_rejection_preserves_jwt_expired_response() {
    let rejection: MacroAuthorizationRejection = (
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            message: Cow::Borrowed("jwt expired"),
        }),
    );

    let response = ExtractorError::from(rejection).into_response();
    let (status, body) = response_parts(response).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"message":"jwt expired"}"#);
}
