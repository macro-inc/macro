use crate::{
    domain::{
        models::{EmailErr, Link, PreviewView},
        ports::{EmailService, GmailTokenProvider},
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
use model_user::axum_extractor::{MacroUserExtractor, UserExtractorErr};
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

pub struct EmailLinkExtractor<U>(pub Link, pub PhantomData<U>);

impl<U> Clone for EmailLinkExtractor<U> {
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
            EmailLinkErr::InvalidLinkIdHeader | EmailLinkErr::NoInboxSelected => {
                StatusCode::BAD_REQUEST
            }
        };

        (status, self.to_string()).into_response()
    }
}

/// Resolve the single inbox a mutating request targets from the caller's owned
/// `links`. With an `X-Email-Link-Id` value, the matching owned link is used
/// (404 when it isn't one of theirs). Without a header, the primary inbox is
/// used — the link whose address matches the caller's account email,
/// case-insensitively, mirroring the client's primary-inbox rule. A caller with
/// no primary inbox (e.g. it was removed) must name an inbox explicitly.
fn resolve_target_link(
    links: Vec<Link>,
    header_link_id: Option<Uuid>,
    account_email: &str,
) -> Result<Link, EmailLinkErr> {
    match header_link_id {
        Some(id) => links
            .into_iter()
            .find(|link| link.id == id)
            .ok_or(EmailLinkErr::NotFound),
        None => links
            .into_iter()
            .find(|link| {
                link.email_address
                    .0
                    .as_ref()
                    .eq_ignore_ascii_case(account_email)
            })
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

impl<S, U> FromRequestParts<S> for EmailLinkExtractor<U>
where
    EmailRouterState<U>: FromRef<S>,
    U: EmailService,
    S: Send + Sync + 'static,
{
    type Rejection = EmailLinkErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let header_link_id = parse_link_id_header(parts)?;
        let Cached(MacroUserExtractor {
            macro_user_id,
            user_context,
            ..
        }) = parts.extract_with_state(state).await?;
        let links = <EmailRouterState<U>>::from_ref(state)
            .inner
            .get_links_by_fusionauth_user_id(&user_context.fusion_user_id)
            .await?;
        let link = resolve_target_link(links, header_link_id, macro_user_id.0.email_str())?;
        Ok(Self(link, PhantomData))
    }
}

/// Extractor that resolves *every* inbox the caller owns, for the multi-inbox
/// read union. Read endpoints fan out over all returned links. A caller with no
/// linked inboxes yields an empty `Vec` (and hence empty results) rather than a
/// 404 — the union over zero inboxes is empty, not missing.
pub struct MultiEmailLinkExtractor<U>(pub Vec<Link>, pub PhantomData<U>);

impl<U> Clone for MultiEmailLinkExtractor<U> {
    fn clone(&self) -> Self {
        Self(self.0.clone(), PhantomData)
    }
}

impl<S, U> FromRequestParts<S> for MultiEmailLinkExtractor<U>
where
    EmailRouterState<U>: FromRef<S>,
    U: EmailService,
    S: Send + Sync + 'static,
{
    type Rejection = EmailLinkErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Cached(MacroUserExtractor { user_context, .. }) =
            parts.extract_with_state(state).await?;
        let links = <EmailRouterState<U>>::from_ref(state)
            .inner
            .get_links_by_fusionauth_user_id(&user_context.fusion_user_id)
            .await?;
        Ok(Self(links, PhantomData))
    }
}

/// Extractor that returns `Option<Link>` - returns `None` if no link is found
/// instead of failing with a 404 error.
pub struct OptionalEmailLinkExtractor<U>(pub Option<Link>, pub PhantomData<U>);

impl<U> Clone for OptionalEmailLinkExtractor<U> {
    fn clone(&self) -> Self {
        Self(self.0.clone(), PhantomData)
    }
}

impl<S, U> FromRequestParts<S> for OptionalEmailLinkExtractor<U>
where
    EmailRouterState<U>: FromRef<S>,
    U: EmailService,
    S: Send + Sync + 'static,
{
    type Rejection = EmailLinkErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Cached(MacroUserExtractor {
            macro_user_id,
            user_context,
            ..
        }) = parts.extract_with_state(state).await?;
        let res = <EmailRouterState<U>>::from_ref(state)
            .inner
            .get_link_by_auth_id_and_macro_id(&user_context.fusion_user_id, macro_user_id)
            .await?;
        Ok(Self(res, PhantomData))
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

/// Extractor that resolves the user's email link and fetches a Gmail access token.
pub struct GmailAccessTokenExtractor<U, V> {
    /// The fetched Gmail OAuth access token.
    pub access_token: String,
    /// The email link used to fetch the token.
    pub link: Link,
    _phantom: PhantomData<(U, V)>,
}

/// Errors from [`GmailAccessTokenExtractor`].
#[derive(Debug, Error)]
pub enum GmailAccessTokenErr {
    /// Failed to resolve the email link.
    #[error(transparent)]
    Link(#[from] EmailLinkErr),
    /// Failed to fetch the Gmail access token.
    #[error("Failed to fetch Gmail access token")]
    TokenFetch(#[source] EmailErr),
}

impl IntoResponse for GmailAccessTokenErr {
    fn into_response(self) -> Response {
        match self {
            GmailAccessTokenErr::Link(e) => e.into_response(),
            GmailAccessTokenErr::TokenFetch(e) => {
                tracing::error!(error=?e, "gmail token fetch error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to fetch Gmail access token",
                )
                    .into_response()
            }
        }
    }
}

impl<S, U, V> FromRequestParts<S> for GmailAccessTokenExtractor<U, V>
where
    EmailRouterState<U>: FromRef<S>,
    GmailTokenState<V>: FromRef<S>,
    U: EmailService,
    V: GmailTokenProvider,
    S: Send + Sync + 'static,
{
    type Rejection = GmailAccessTokenErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Cached(EmailLinkExtractor(link, _)) = parts
            .extract_with_state::<Cached<EmailLinkExtractor<U>>, S>(state)
            .await?;
        let token_state = <GmailTokenState<V>>::from_ref(state);
        let token = token_state
            .inner
            .fetch_gmail_access_token(&link)
            .await
            .map_err(GmailAccessTokenErr::TokenFetch)?;
        Ok(Self {
            access_token: token,
            link,
            _phantom: PhantomData,
        })
    }
}
