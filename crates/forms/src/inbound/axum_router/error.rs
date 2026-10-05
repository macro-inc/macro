//! What a forms request answers when it is refused or fails.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use entity_access::domain::models::AccessError;
use models_forms::{FormErrorCode, FormErrorResponse};

use super::access::AccessRefusal;
use crate::domain::models::FormError;

/// A forms request's failure: the domain's refusal, or the caller lacking
/// access to a database the request names.
#[derive(Debug, thiserror::Error)]
pub enum FormsApiError {
    /// The forms service refused or failed.
    #[error(transparent)]
    Form(#[from] FormError),
    /// The caller cannot reach the database the request names.
    #[error("no access to the database")]
    DatabaseAccess(#[source] AccessError),
    /// The caller cannot reach the form the request names, or is not
    /// signed in where the request needs it.
    #[error("{0:?}")]
    Access(AccessRefusal),
}

impl From<AccessError> for FormsApiError {
    fn from(error: AccessError) -> Self {
        FormsApiError::DatabaseAccess(error)
    }
}

fn body(code: FormErrorCode, message: String) -> FormErrorResponse {
    FormErrorResponse {
        code,
        message,
        question: None,
        problem: None,
    }
}

impl IntoResponse for FormsApiError {
    fn into_response(self) -> Response {
        let error = match self {
            FormsApiError::Form(error) => error,
            FormsApiError::Access(AccessRefusal::SignInRequired) => FormError::SignInRequired,
            FormsApiError::Access(AccessRefusal::NotFound) => FormError::NotFound,
            FormsApiError::Access(AccessRefusal::Forbidden) => {
                return (
                    StatusCode::FORBIDDEN,
                    Json(body(
                        FormErrorCode::Forbidden,
                        "you lack the access this form request needs".into(),
                    )),
                )
                    .into_response();
            }
            FormsApiError::Access(AccessRefusal::Unavailable) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(body(
                        FormErrorCode::Internal,
                        "internal server error".into(),
                    )),
                )
                    .into_response();
            }
            FormsApiError::DatabaseAccess(
                AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
            ) => {
                return (
                    StatusCode::FORBIDDEN,
                    Json(body(
                        FormErrorCode::Forbidden,
                        "no access to the database".into(),
                    )),
                )
                    .into_response();
            }
            FormsApiError::DatabaseAccess(AccessError::NotFound(_)) => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(body(FormErrorCode::NotFound, "no such database".into())),
                )
                    .into_response();
            }
            FormsApiError::DatabaseAccess(error) => {
                tracing::error!(error = ?error, "forms database access check failed");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(body(
                        FormErrorCode::Internal,
                        "internal server error".into(),
                    )),
                )
                    .into_response();
            }
        };
        let message = error.to_string();
        let (status, response) = match error {
            FormError::NotFound => (
                StatusCode::NOT_FOUND,
                body(FormErrorCode::NotFound, message),
            ),
            FormError::OwnerOnly => (
                StatusCode::FORBIDDEN,
                body(FormErrorCode::OwnerOnly, message),
            ),
            FormError::SignInRequired => (
                StatusCode::UNAUTHORIZED,
                body(FormErrorCode::SignInRequired, message),
            ),
            FormError::Closed => (StatusCode::CONFLICT, body(FormErrorCode::Closed, message)),
            FormError::TableGone => (
                StatusCode::CONFLICT,
                body(FormErrorCode::TableGone, message),
            ),
            FormError::AlreadyResponded => (
                StatusCode::CONFLICT,
                body(FormErrorCode::AlreadyResponded, message),
            ),
            FormError::NoResponse => (
                StatusCode::NOT_FOUND,
                body(FormErrorCode::NoResponse, message),
            ),
            FormError::UnknownQuestion { question } => (
                StatusCode::BAD_REQUEST,
                FormErrorResponse {
                    question: Some(question),
                    ..body(FormErrorCode::UnknownQuestion, message)
                },
            ),
            FormError::RepeatedAnswer { question } => (
                StatusCode::BAD_REQUEST,
                FormErrorResponse {
                    question: Some(question),
                    ..body(FormErrorCode::RepeatedAnswer, message)
                },
            ),
            FormError::MissingAnswer { question } => (
                StatusCode::BAD_REQUEST,
                FormErrorResponse {
                    question: Some(question),
                    ..body(FormErrorCode::MissingAnswer, message)
                },
            ),
            FormError::InvalidAnswer { question, .. } => (
                StatusCode::BAD_REQUEST,
                FormErrorResponse {
                    question: Some(question),
                    ..body(FormErrorCode::InvalidAnswer, message)
                },
            ),
            FormError::WidgetMismatch { question } => (
                StatusCode::BAD_REQUEST,
                FormErrorResponse {
                    question: Some(question),
                    ..body(FormErrorCode::WidgetMismatch, message)
                },
            ),
            FormError::FileUploadNeedsSignIn => (
                StatusCode::BAD_REQUEST,
                body(FormErrorCode::FileUploadNeedsSignIn, message),
            ),
            FormError::InvalidLayout(problem) => (
                StatusCode::BAD_REQUEST,
                FormErrorResponse {
                    problem: Some(problem),
                    ..body(FormErrorCode::InvalidLayout, message)
                },
            ),
            FormError::InvalidName(_) => (
                StatusCode::BAD_REQUEST,
                body(FormErrorCode::InvalidName, message),
            ),
            FormError::InvalidSharing(_) => (
                StatusCode::BAD_REQUEST,
                body(FormErrorCode::InvalidSharing, message),
            ),
            FormError::TallyHidden => (
                StatusCode::FORBIDDEN,
                body(FormErrorCode::TallyHidden, message),
            ),
            FormError::Conflict => (StatusCode::CONFLICT, body(FormErrorCode::Conflict, message)),
            error @ (FormError::Database(_)
            | FormError::Repository(_)
            | FormError::AccessDirectory(_)
            | FormError::DatabaseContract(_)) => {
                tracing::error!(error = ?error, "forms internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    body(FormErrorCode::Internal, "internal server error".into()),
                )
            }
        };
        (status, Json(response)).into_response()
    }
}
