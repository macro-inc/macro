//! Resolves who a public create request creates as.

use std::marker::PhantomData;

use axum::{
    extract::{FromRef, FromRequestParts},
    http::{StatusCode, request::Parts},
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorizationExtractor, MacroAuthorizationRejection,
    MacroAuthorizationService, MacroAuthorizationState,
};
use model_owner::CreationPrincipal;

use crate::{NonUserOwners, resolve_creation_principal};

/// The verified principal a public create request creates as.
///
/// A caller that cannot create is rejected with 403 before the request body
/// is read.
pub struct CreationPrincipalExtractor<Auth> {
    /// Who the request creates as.
    pub principal: CreationPrincipal,
    _auth: PhantomData<fn() -> Auth>,
}

impl<S, Auth> FromRequestParts<S> for CreationPrincipalExtractor<Auth>
where
    MacroAuthorizationState<Auth>: FromRef<S>,
    NonUserOwners: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let caller =
            MacroAuthorizationExtractor::<Auth, AnyPrincipal>::from_request_parts(parts, state)
                .await?;
        let principal =
            resolve_creation_principal(&caller.authorization, NonUserOwners::from_ref(state))
                .map_err(|error| {
                    tracing::info!(%error, "caller cannot create");
                    MacroAuthorizationRejection {
                        status: StatusCode::FORBIDDEN,
                        message: "forbidden".into(),
                    }
                })?;
        Ok(Self {
            principal,
            _auth: PhantomData,
        })
    }
}
