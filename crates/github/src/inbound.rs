//! Inbound adapters for the github domain.

#[cfg(all(feature = "axum", feature = "sync"))]
pub mod github_sync_router;
#[cfg(all(feature = "axum", feature = "sync"))]
pub mod pull_request_index_router;

#[cfg(feature = "axum")]
impl axum::response::IntoResponse for crate::domain::models::GithubError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        use std::borrow::Cow;
        let (status_code, message): (StatusCode, Cow<'static, str>) = match self {
            crate::domain::models::GithubError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal server error occurred".into(),
            ),
            crate::domain::models::GithubError::NoLinkFound => {
                (StatusCode::FORBIDDEN, "no account link found".into())
            }
            crate::domain::models::GithubError::ReauthenticationRequired => (
                StatusCode::PRECONDITION_REQUIRED,
                "ReauthenticationRequired".into(),
            ),
            crate::domain::models::GithubError::NoRefreshTokenProvided => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "no refresh token was provided".into(),
            ),
            crate::domain::models::GithubError::InvalidWebhookSignature => {
                (StatusCode::UNAUTHORIZED, "unauthenticated".into())
            }
            crate::domain::models::GithubError::Forbidden
            | crate::domain::models::GithubError::SetupUserNotLinked
            // Deliberately the same answer as any other refusal: whether the
            // App is uninstalled or installed somewhere the caller has no
            // claim to is a fact about other people's accounts.
            | crate::domain::models::GithubError::RepositoryUnavailable => {
                (StatusCode::FORBIDDEN, "forbidden".into())
            }
            crate::domain::models::GithubError::InvalidInstallationState
            | crate::domain::models::GithubError::InvalidInstallationSetupAction
            | crate::domain::models::GithubError::MissingInstallationSetupField(_)
            | crate::domain::models::GithubError::InstallationNotOwned => (
                StatusCode::BAD_REQUEST,
                "invalid installation setup callback".into(),
            ),
            // GitHub's message is the one worth showing: it names the failing
            // check, the missing review, or the disallowed method.
            crate::domain::models::GithubError::PullRequestMergeRejected {
                rejection,
                message,
            } => (merge_rejection_status(rejection), message.into()),
            // Auto-merge rejection follows the same pattern as merge rejection.
            crate::domain::models::GithubError::AutoMergeRejected { rejection, message } => {
                (auto_merge_rejection_status(rejection), message.into())
            }
        };

        (
            status_code,
            axum::Json(model_error_response::ErrorResponse { message }),
        )
            .into_response()
    }
}

/// The status a declined merge is reported with. GitHub's own 405 for "not
/// mergeable" is misleading on our route (the method is fine), so it becomes
/// a 409: the pull request's state conflicts with the request.
#[cfg(feature = "axum")]
pub fn merge_rejection_status(
    rejection: crate::domain::models::GithubMergeRejection,
) -> axum::http::StatusCode {
    use crate::domain::models::GithubMergeRejection;
    use axum::http::StatusCode;
    match rejection {
        GithubMergeRejection::NotMergeable | GithubMergeRejection::HeadChanged => {
            StatusCode::CONFLICT
        }
        GithubMergeRejection::NotFound => StatusCode::NOT_FOUND,
        GithubMergeRejection::Forbidden => StatusCode::FORBIDDEN,
        GithubMergeRejection::Invalid => StatusCode::UNPROCESSABLE_ENTITY,
    }
}

/// The status a declined enable-auto-merge is reported with.
#[cfg(feature = "axum")]
pub fn auto_merge_rejection_status(
    rejection: crate::domain::models::GithubAutoMergeRejection,
) -> axum::http::StatusCode {
    use crate::domain::models::GithubAutoMergeRejection;
    use axum::http::StatusCode;
    match rejection {
        GithubAutoMergeRejection::NotAllowed => StatusCode::CONFLICT,
        GithubAutoMergeRejection::NotFound => StatusCode::NOT_FOUND,
        GithubAutoMergeRejection::Forbidden => StatusCode::FORBIDDEN,
        GithubAutoMergeRejection::Invalid => StatusCode::UNPROCESSABLE_ENTITY,
    }
}
