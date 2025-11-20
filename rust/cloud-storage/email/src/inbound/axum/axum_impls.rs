use std::str::FromStr;

use axum::{
    RequestPartsExt, async_trait,
    extract::{FromRequestParts, Path, rejection::PathRejection},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    domain::models::{EmailErr, PreviewView},
    inbound::ApiSortMethod,
};

#[derive(Debug, Error)]
pub enum GetPreviewsCursorError {
    #[error(transparent)]
    PathErr(#[from] PathRejection),
    #[error("Invalid view parameter: {0}")]
    InvalidView(String),

    #[error("Internal server error")]
    DatabaseQueryError(#[from] EmailErr),
}

impl IntoResponse for GetPreviewsCursorError {
    fn into_response(self) -> Response {
        let msg = self.to_string();

        let status_code = match self {
            GetPreviewsCursorError::InvalidView(_) => StatusCode::BAD_REQUEST,
            GetPreviewsCursorError::DatabaseQueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            GetPreviewsCursorError::PathErr(path_rejection) => {
                return path_rejection.into_response();
            }
        };

        (status_code, msg).into_response()
    }
}

#[derive(Debug, Clone)]
pub struct LinkUuid(pub Uuid);

pub(crate) struct PreviewViewExtractor(pub PreviewView);

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for PreviewViewExtractor {
    type Rejection = GetPreviewsCursorError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let Path(view) = parts.extract::<Path<String>>().await?;
        Ok(PreviewViewExtractor(
            PreviewView::from_str(&view).map_err(GetPreviewsCursorError::InvalidView)?,
        ))
    }
}

/// Parameters for getting thread previews with cursor-based pagination.
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct GetPreviewsCursorParams {
    /// Limit for pagination. Default is 20. Max is 500.
    pub limit: Option<u32>,
    /// Sort method. Options are viewed_at, created_at, updated_at, viewed_updated. Defaults to viewed_updated.
    pub sort_method: Option<ApiSortMethod>,
}
