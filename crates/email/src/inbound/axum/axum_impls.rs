use crate::{
    domain::{
        models::{EmailErr, Link, PreviewView},
        ports::EmailService,
    },
    inbound::axum::{api_types::ApiSortMethod, previews_router::EmailRouterState},
};
use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path, rejection::PathRejection},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use axum_extra::extract::Cached;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationRejection, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use std::{marker::PhantomData, str::FromStr};
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

/// Request header that selects which inbox a single-inbox (mutating) request
/// targets. When absent, the caller's primary inbox is used.
pub const EMAIL_LINK_ID_HEADER: &str = "x-email-link-id";

#[cfg(test)]
mod test;

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

pub(crate) struct PreviewViewPathExtractor(pub PreviewView);

impl<S: Send + Sync> FromRequestParts<S> for PreviewViewPathExtractor {
    type Rejection = GetPreviewsCursorError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let Path(view) = parts.extract::<Path<String>>().await?;
        Ok(PreviewViewPathExtractor(
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

pub struct EmailLinkExtractor<U, Auth>(pub Link, pub PhantomData<(U, Auth)>);

impl<U, Auth> Clone for EmailLinkExtractor<U, Auth> {
    fn clone(&self) -> Self {
        Self(self.0.clone(), PhantomData)
    }
}

#[derive(Debug, Error)]
pub enum EmailLinkErr {
    #[error("Internal server error")]
    DbErr(#[from] crate::domain::models::EmailErr),
    #[error("Email link not found")]
    NotFound,
    #[error("Invalid X-Email-Link-Id header")]
    InvalidLinkIdHeader,
    #[error("No inbox specified; provide the X-Email-Link-Id header")]
    NoInboxSelected,
    #[error(transparent)]
    Authorization(#[from] MacroAuthorizationRejection),
}

impl IntoResponse for EmailLinkErr {
    fn into_response(self) -> Response {
        let (status, error) = match self {
            EmailLinkErr::Authorization(error) => return error.into_response(),
            error @ EmailLinkErr::DbErr(_) => (StatusCode::INTERNAL_SERVER_ERROR, error),
            error @ EmailLinkErr::NotFound => (StatusCode::NOT_FOUND, error),
            error @ (EmailLinkErr::InvalidLinkIdHeader | EmailLinkErr::NoInboxSelected) => {
                (StatusCode::BAD_REQUEST, error)
            }
        };

        (status, error.to_string()).into_response()
    }
}

/// Resolve the single inbox a mutating request targets from the caller's owned
/// `links`. With an `X-Email-Link-Id` value, the matching owned link is used
/// (404 when it isn't one of theirs). Without a header, the caller's primary
/// inbox is used — their own `is_primary` link. The `macro_id` guard matters:
/// the links list includes delegated inboxes, which are primary for *their*
/// account. A caller with no primary inbox (e.g. it was removed) must name an
/// inbox explicitly.
fn resolve_target_link(
    links: Vec<Link>,
    header_link_id: Option<Uuid>,
    caller: &MacroUserIdStr<'_>,
) -> Result<Link, EmailLinkErr> {
    match header_link_id {
        Some(id) => links
            .into_iter()
            .find(|link| link.id == id)
            .ok_or(EmailLinkErr::NotFound),
        None => links
            .into_iter()
            .find(|link| link.is_primary && &link.macro_id == caller)
            .ok_or(EmailLinkErr::NoInboxSelected),
    }
}

/// Parse the `X-Email-Link-Id` header into a link id, if present. A malformed
/// value is a client error.
fn parse_link_id_header(parts: &Parts) -> Result<Option<Uuid>, EmailLinkErr> {
    let Some(value) = parts.headers.get(EMAIL_LINK_ID_HEADER) else {
        return Ok(None);
    };
    let raw = value
        .to_str()
        .map_err(|_| EmailLinkErr::InvalidLinkIdHeader)?;
    Uuid::parse_str(raw.trim())
        .map(Some)
        .map_err(|_| EmailLinkErr::InvalidLinkIdHeader)
}

impl<S, U, Auth> FromRequestParts<S> for EmailLinkExtractor<U, Auth>
where
    EmailRouterState<U>: FromRef<S>,
    MacroAuthorizationState<Auth>: FromRef<S>,
    U: EmailService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = EmailLinkErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let header_link_id = parse_link_id_header(parts)?;
        let Cached(MacroAuthorizationExtractor { macro_user_id, .. }) = parts
            .extract_with_state(state)
            .await
            .map_err(EmailLinkErr::Authorization)?;
        let caller = macro_user_id.clone();
        let links = <EmailRouterState<U>>::from_ref(state)
            .inner
            .get_inboxes_for_macro_id(macro_user_id)
            .await?;
        let link = resolve_target_link(links, header_link_id, &caller)?;
        Ok(Self(link, PhantomData))
    }
}

/// Extractor that resolves *every* inbox the caller can read — their own inboxes
/// plus any delegated/shared inboxes reachable via `macro_user_links`. Read
/// endpoints fan out over all returned links. A caller with no inboxes yields an
/// empty `Vec` (and hence empty results) rather than a 404 — the union over zero
/// inboxes is empty, not missing.
pub struct MultiEmailLinkExtractor<U, Auth>(pub Vec<Link>, pub PhantomData<(U, Auth)>);

impl<U, Auth> Clone for MultiEmailLinkExtractor<U, Auth> {
    fn clone(&self) -> Self {
        Self(self.0.clone(), PhantomData)
    }
}

impl<S, U, Auth> FromRequestParts<S> for MultiEmailLinkExtractor<U, Auth>
where
    EmailRouterState<U>: FromRef<S>,
    MacroAuthorizationState<Auth>: FromRef<S>,
    U: EmailService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = EmailLinkErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Cached(MacroAuthorizationExtractor { macro_user_id, .. }) = parts
            .extract_with_state(state)
            .await
            .map_err(EmailLinkErr::Authorization)?;
        let links = <EmailRouterState<U>>::from_ref(state)
            .inner
            .get_inboxes_for_macro_id(macro_user_id)
            .await?;
        Ok(Self(links, PhantomData))
    }
}

/// Axum state wrapper for a [`GmailTokenProvider`] implementation.
pub struct GmailTokenState<T> {
    pub(crate) inner: Arc<T>,
}

impl<T> Clone for GmailTokenState<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<T> GmailTokenState<T> {
    /// Create a new `GmailTokenState` wrapping the given provider.
    pub fn new(provider: T) -> Self {
        Self {
            inner: Arc::new(provider),
        }
    }
}
