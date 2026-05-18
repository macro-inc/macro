use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, put},
};
use axum_extra::extract::Cached;
use chrono::{DateTime, Utc};
use model_error_response::ErrorResponse;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    models::{EmailErr, EmailFilter, UpsertEmailFilterInput},
    ports::EmailService,
};

use super::{axum_impls::EmailLinkExtractor, previews_router::EmailRouterState};

// ── API types ────────────────────────────────────────────────────────

/// Request body for creating or updating an email filter.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct UpsertEmailFilterRequest {
    /// Exact email address to match. Mutually exclusive with `email_domain`.
    pub email_address: Option<String>,
    /// Email domain to match. Mutually exclusive with `email_address`.
    pub email_domain: Option<String>,
    /// Whether matching senders should be considered important.
    pub is_important: bool,
}

/// A single email filter in API responses.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct ApiEmailFilter {
    pub id: Uuid,
    pub email_address: Option<String>,
    pub email_domain: Option<String>,
    pub is_important: bool,
    pub created_at: DateTime<Utc>,
}

impl From<EmailFilter> for ApiEmailFilter {
    fn from(f: EmailFilter) -> Self {
        ApiEmailFilter {
            id: f.id,
            email_address: f.email_address,
            email_domain: f.email_domain,
            is_important: f.is_important,
            created_at: f.created_at,
        }
    }
}

/// Response body for upsert email filter.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct UpsertEmailFilterResponse {
    pub filter: ApiEmailFilter,
}

/// Response body for listing email filters.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct ListEmailFiltersResponse {
    pub filters: Vec<ApiEmailFilter>,
}

// ── Errors ───────────────────────────────────────────────────────────

/// Errors from the email filter handlers.
#[derive(Debug, Error)]
pub enum EmailFilterError {
    /// Validation / bad request.
    #[error("{0}")]
    Validation(String),
    /// Not found.
    #[error("{0}")]
    NotFound(String),
    /// Internal error.
    #[error("Internal error")]
    Internal(EmailErr),
}

impl IntoResponse for EmailFilterError {
    fn into_response(self) -> axum::response::Response {
        if matches!(self, EmailFilterError::Internal(_)) {
            tracing::error!(error=?self, "email filter error");
        }

        let status = match &self {
            EmailFilterError::Validation(_) => StatusCode::BAD_REQUEST,
            EmailFilterError::NotFound(_) => StatusCode::NOT_FOUND,
            EmailFilterError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = self.to_string();
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

impl From<EmailErr> for EmailFilterError {
    fn from(err: EmailErr) -> Self {
        match &err {
            EmailErr::InvalidEmailFilter(_) => EmailFilterError::Validation(err.to_string()),
            _ => EmailFilterError::Internal(err),
        }
    }
}

// ── Router ───────────────────────────────────────────────────────────

/// Create the email filter router with `PUT /`, `DELETE /{id}`, and `GET /` handlers.
pub fn email_filter_router<S, T>() -> Router<S>
where
    S: Send + Sync + Clone + 'static,
    T: EmailService,
    EmailRouterState<T>: axum::extract::FromRef<S>,
{
    Router::new()
        .route("/", put(upsert_email_filter_handler::<T>))
        .route("/", get(list_email_filters_handler::<T>))
        .route("/{id}", delete(delete_email_filter_handler::<T>))
}

// ── Handlers ─────────────────────────────────────────────────────────

/// Create or update an email filter.
#[utoipa::path(
    put,
    tag = "Email Filters",
    path = "/email/filters",
    operation_id = "upsert_email_filter",
    request_body = UpsertEmailFilterRequest,
    responses(
        (status = 200, body = UpsertEmailFilterResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip(state, link, body))]
pub async fn upsert_email_filter_handler<T: EmailService>(
    State(state): State<EmailRouterState<T>>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<T>>,
    Json(body): Json<UpsertEmailFilterRequest>,
) -> Result<Json<UpsertEmailFilterResponse>, EmailFilterError> {
    let input = UpsertEmailFilterInput {
        email_address: body.email_address,
        email_domain: body.email_domain,
        is_important: body.is_important,
    };

    let filter = state.inner.upsert_email_filter(&link, input).await?;

    Ok(Json(UpsertEmailFilterResponse {
        filter: filter.into(),
    }))
}

/// Delete an email filter by ID.
#[utoipa::path(
    delete,
    tag = "Email Filters",
    path = "/email/filters/{id}",
    operation_id = "delete_email_filter",
    params(
        ("id" = Uuid, Path, description = "Filter ID."),
    ),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip(state, link))]
pub async fn delete_email_filter_handler<T: EmailService>(
    State(state): State<EmailRouterState<T>>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<T>>,
    Path(filter_id): Path<Uuid>,
) -> Result<impl IntoResponse, EmailFilterError> {
    let deleted = state.inner.delete_email_filter(&link, filter_id).await?;

    if !deleted {
        return Err(EmailFilterError::NotFound(format!(
            "Email filter with id {filter_id} not found"
        )));
    }

    Ok(StatusCode::NO_CONTENT)
}

/// List all email filters for the current user.
#[utoipa::path(
    get,
    tag = "Email Filters",
    path = "/email/filters",
    operation_id = "list_email_filters",
    responses(
        (status = 200, body = ListEmailFiltersResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_email_filters_handler<T: EmailService>(
    State(state): State<EmailRouterState<T>>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<T>>,
) -> Result<Json<ListEmailFiltersResponse>, EmailFilterError> {
    let filters = state.inner.list_email_filters(&link).await?;

    Ok(Json(ListEmailFiltersResponse {
        filters: filters.into_iter().map(Into::into).collect(),
    }))
}
