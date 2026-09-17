//! Extractor that admits only authenticated Macro staff.

use std::marker::PhantomData;

use axum::{
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
    response::{IntoResponse, Response},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationRejection, MacroAuthorizationService,
    MacroAuthorizationState, UserOrInternal, UserOrInternalAuthorization,
};

use crate::domain::models::GtmInviteError;

/// Branded authenticated principal that has already been proven to be Macro
/// staff.
pub struct GtmMacroStaffExtractor<Auth> {
    /// The authenticated principal, already checked as Macro staff.
    pub authorization: UserOrInternalAuthorization,
    _auth: PhantomData<fn() -> Auth>,
}

/// Rejection returned when the Macro staff check fails.
#[derive(Debug, thiserror::Error)]
pub enum GtmMacroStaffRejection {
    /// The request could not be authorized.
    #[error("authorization failed")]
    Authorization(#[from] MacroAuthorizationRejection),
    /// The authenticated user is not Macro staff.
    #[error("only Macro staff can manage invite links")]
    NotStaff,
}

impl IntoResponse for GtmMacroStaffRejection {
    fn into_response(self) -> Response {
        match self {
            Self::Authorization(rejection) => rejection.into_response(),
            Self::NotStaff => GtmInviteError::Forbidden.into_response(),
        }
    }
}

impl<S, Auth> FromRequestParts<S> for GtmMacroStaffExtractor<Auth>
where
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = GtmMacroStaffRejection;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let authorization =
            MacroAuthorizationExtractor::<Auth, UserOrInternal>::from_request_parts(parts, state)
                .await?;
        if !authorization
            .authorization
            .user
            .macro_user_id
            .is_macro_staff()
        {
            return Err(GtmMacroStaffRejection::NotStaff);
        }

        Ok(Self {
            authorization: authorization.authorization,
            _auth: PhantomData,
        })
    }
}
