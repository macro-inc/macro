//! The router's access extractors: the shared form and sign-in extractors,
//! with their refusals answered as the forms API's typed error body like
//! every other forms error.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::extract::{FromRef, FromRequestParts};
use axum::http::StatusCode;
use axum::http::request::Parts;
use entity_access::domain::models::{EntityAccessReceipt, RequiredPermission};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{ExtractorError, FormAccessLevelExtractor};
use macro_authorization::{
    AnyPrincipal, MacroAuthorizationExtractor, MacroAuthorizationRejection,
    MacroAuthorizationService, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
    UserOrInternal,
};

use super::FormsApiError;

/// Why the caller cannot reach what a request names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessRefusal {
    /// Nobody signed in, or the credentials were refused.
    SignInRequired,
    /// The signed-in caller lacks the level the request needs.
    Forbidden,
    /// What the request names does not exist.
    NotFound,
    /// Access could not be checked.
    Unavailable,
}

/// The caller's receipt on the form named by the `id` path parameter, at
/// `Permission`. A public form gives anonymous callers a View receipt.
pub struct FormReceipt<Permission: RequiredPermission, AccessService, Authorization> {
    /// The receipt.
    pub receipt: EntityAccessReceipt<Permission>,
    _marker: PhantomData<(AccessService, Authorization)>,
}

impl<Permission, State, AccessService, Authorization> FromRequestParts<State>
    for FormReceipt<Permission, AccessService, Authorization>
where
    Permission: RequiredPermission,
    Arc<AccessService>: FromRef<State>,
    AccessService: EntityAccessService,
    MacroAuthorizationState<Authorization>: FromRef<State>,
    Authorization: MacroAuthorizationService,
    State: Send + Sync + 'static,
{
    type Rejection = FormsApiError;

    async fn from_request_parts(parts: &mut Parts, state: &State) -> Result<Self, Self::Rejection> {
        match FormAccessLevelExtractor::<Permission, AccessService, Authorization>::from_request_parts(
            parts, state,
        )
        .await
        {
            Ok(access) => Ok(Self {
                receipt: access.entity_access_receipt,
                _marker: PhantomData,
            }),
            Err(rejection) => {
                let signed_in = OptionalMacroAuthorizationExtractor::<Authorization, AnyPrincipal>::from_request_parts(
                    parts, state,
                )
                .await
                .is_ok_and(|authorization| authorization.authorization.is_some());
                Err(FormsApiError::Access(form_refusal(&rejection, signed_in)))
            }
        }
    }
}

/// What a refusal of the form extractor means for this caller.
fn form_refusal(rejection: &ExtractorError, signed_in: bool) -> AccessRefusal {
    match rejection {
        ExtractorError::Authorization { status, .. } => status_refusal(*status),
        ExtractorError::Unauthorized | ExtractorError::UnauthorizedWithMessage(_) => {
            if signed_in {
                AccessRefusal::Forbidden
            } else {
                AccessRefusal::SignInRequired
            }
        }
        ExtractorError::NotFound(_) | ExtractorError::BadRequest(_) => AccessRefusal::NotFound,
        error @ (ExtractorError::Internal | ExtractorError::Database) => {
            tracing::error!(error = ?error, "form access check failed");
            AccessRefusal::Unavailable
        }
    }
}

/// What an authorization status means for a forms request.
fn status_refusal(status: StatusCode) -> AccessRefusal {
    match status {
        StatusCode::UNAUTHORIZED => AccessRefusal::SignInRequired,
        StatusCode::FORBIDDEN => AccessRefusal::Forbidden,
        other => {
            tracing::error!(status = %other, "authorization failed");
            AccessRefusal::Unavailable
        }
    }
}

/// A signed-in caller, or Macro's own machinery acting for one.
pub struct SignedIn<Authorization> {
    /// The authorization the request carries.
    pub user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
}

impl<State, Authorization> FromRequestParts<State> for SignedIn<Authorization>
where
    MacroAuthorizationState<Authorization>: FromRef<State>,
    Authorization: MacroAuthorizationService,
    State: Send + Sync + 'static,
{
    type Rejection = FormsApiError;

    async fn from_request_parts(parts: &mut Parts, state: &State) -> Result<Self, Self::Rejection> {
        MacroAuthorizationExtractor::<Authorization, UserOrInternal>::from_request_parts(
            parts, state,
        )
        .await
        .map(|user| Self { user })
        .map_err(|MacroAuthorizationRejection { status, .. }| {
            FormsApiError::Access(status_refusal(status))
        })
    }
}
