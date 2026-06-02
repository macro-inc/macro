//! Inbound adapters for the github domain.

#[cfg(all(feature = "axum", feature = "sync"))]
pub mod github_sync_router;

#[cfg(feature = "axum")]
impl axum::response::IntoResponse for crate::domain::models::GithubError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        let (status_code, message): (StatusCode, &str) = match self {
            crate::domain::models::GithubError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal server error occurred",
            ),
            crate::domain::models::GithubError::NoLinkFound => {
                (StatusCode::FORBIDDEN, "no account link found")
            }
            crate::domain::models::GithubError::ReauthenticationRequired => (
                StatusCode::PRECONDITION_REQUIRED,
                "ReauthenticationRequired",
            ),
            crate::domain::models::GithubError::AccountAlreadyLinked => {
                (StatusCode::BAD_REQUEST, "account already linked")
            }
            crate::domain::models::GithubError::NoRefreshTokenProvided => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "no refresh token was provided",
            ),
            crate::domain::models::GithubError::InvalidWebhookSignature => {
                (StatusCode::UNAUTHORIZED, "unauthenticated")
            }
        };

        (
            status_code,
            axum::Json(model_error_response::ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
