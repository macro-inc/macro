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
            crate::domain::models::GithubError::NoRefreshTokenProvided => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "no refresh token was provided",
            ),
            crate::domain::models::GithubError::InvalidWebhookSignature => {
                (StatusCode::UNAUTHORIZED, "unauthenticated")
            }
            crate::domain::models::GithubError::Forbidden
            | crate::domain::models::GithubError::SetupUserNotLinked
            // Deliberately the same answer as any other refusal: whether the
            // App is uninstalled or installed somewhere the caller has no
            // claim to is a fact about other people's accounts.
            | crate::domain::models::GithubError::RepositoryUnavailable => {
                (StatusCode::FORBIDDEN, "forbidden")
            }
            crate::domain::models::GithubError::InvalidInstallationState
            | crate::domain::models::GithubError::InvalidInstallationSetupAction
            | crate::domain::models::GithubError::MissingInstallationSetupField(_)
            | crate::domain::models::GithubError::InstallationNotOwned => (
                StatusCode::BAD_REQUEST,
                "invalid installation setup callback",
            ),
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
