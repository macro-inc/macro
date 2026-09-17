//! Extractor that admits only authenticated Macro staff.

use std::marker::PhantomData;

use axum::{
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
    response::{IntoResponse, Response},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationRejection, MacroAuthorizationService,
    MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::GtmInviteError;

/// Authenticated Macro staff principal for GTM invite staff endpoints.
pub struct GtmMacroStaffExtractor<Auth> {
    /// The authenticated staff user's id.
    pub macro_user_id: MacroUserIdStr<'static>,
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
        let macro_user_id = authorization.authorization.user.macro_user_id;
        if !macro_user_id.is_macro_staff() {
            return Err(GtmMacroStaffRejection::NotStaff);
        }

        Ok(Self {
            macro_user_id,
            _auth: PhantomData,
        })
    }
}
