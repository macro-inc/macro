use crate::{
    domain::{
        models::{EmailErr, Link, PreviewView},
        ports::EmailService,
    },
    inbound::{ApiSortMethod, EmailPreviewState},
};
use axum::{
    RequestPartsExt, async_trait,
    extract::{FromRequestParts, Path, rejection::PathRejection},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use model_user::axum_extractor::{MacroUserExtractor, UserExtractorErr};
use std::{str::FromStr, sync::Arc};
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

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

#[derive(Clone)]
pub struct EmailLinkExtractor(pub Link);

#[derive(Debug, Error)]
pub enum EmailLinkErr {
    #[error("Internal server error")]
    DbErr(#[from] crate::domain::models::EmailErr),
    #[error("Email link not found")]
    NotFound,
    #[error(transparent)]
    UserErr(#[from] UserExtractorErr),
}

impl IntoResponse for EmailLinkErr {
    fn into_response(self) -> Response {
        if let EmailLinkErr::UserErr(u) = self {
            return u.into_response();
        }
        let status = match &self {
            EmailLinkErr::DbErr(_) | EmailLinkErr::UserErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            EmailLinkErr::NotFound => StatusCode::NOT_FOUND,
        };

        (status, self.to_string()).into_response()
    }
}

#[async_trait]
impl<S> FromRequestParts<EmailPreviewState<S>> for EmailLinkExtractor
where
    S: EmailService,
{
    type Rejection = EmailLinkErr;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &EmailPreviewState<S>,
    ) -> Result<Self, Self::Rejection> {
        let MacroUserExtractor {
            macro_user_id,
            user_context,
            ..
        } = parts.extract_with_state(state).await?;
        let res = state
            .inner
            .get_link_by_auth_id_and_macro_id(&user_context.fusion_user_id, macro_user_id)
            .await?
            .ok_or(EmailLinkErr::NotFound)?;
        Ok(Self(res))
    }
}
