use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::get};
use axum_extra::extract::Cached;
use model_error_response::ErrorResponse;
use thiserror::Error;

use crate::domain::{models::EmailErr, ports::EmailService};

use super::{
    api_types::ApiLabel, axum_impls::MultiEmailLinkExtractor, previews_router::EmailRouterState,
};

/// Response body for listing labels.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct ListLabelsResponse {
    pub labels: Vec<ApiLabel>,
}

/// Errors from the list labels handler.
#[derive(Debug, Error)]
pub enum ListLabelsError {
    /// Internal error.
    #[error("Internal error")]
    Internal(EmailErr),
}

impl IntoResponse for ListLabelsError {
    fn into_response(self) -> axum::response::Response {
        tracing::error!(error=?self, "list labels error");
        let message = self.to_string();
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

impl From<EmailErr> for ListLabelsError {
    fn from(err: EmailErr) -> Self {
        ListLabelsError::Internal(err)
    }
}

/// Create the list labels router with a `GET /` handler.
pub fn list_labels_router<S, T>() -> Router<S>
where
    S: Send + Sync + Clone + 'static,
    T: EmailService,
    EmailRouterState<T>: axum::extract::FromRef<S>,
{
    Router::new().route("/", get(list_labels_handler::<T>))
}

/// List all labels for the user's email link.
#[utoipa::path(
    get,
    tag = "Labels",
    path = "/email/labels",
    operation_id = "list_labels",
    responses(
        (status = 200, body = ListLabelsResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_labels_handler<T: EmailService>(
    State(state): State<EmailRouterState<T>>,
    Cached(MultiEmailLinkExtractor(links, _)): Cached<MultiEmailLinkExtractor<T>>,
) -> Result<Json<ListLabelsResponse>, ListLabelsError> {
    let mut labels = Vec::new();
    for link in &links {
        labels.extend(state.inner.list_labels(link).await?);
    }
    Ok(Json(ListLabelsResponse {
        labels: labels.into_iter().map(Into::into).collect(),
    }))
}
