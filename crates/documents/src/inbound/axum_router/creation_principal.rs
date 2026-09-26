//! Resolves who a public document create request creates as.

use std::marker::PhantomData;

use axum::{
    extract::{FromRef, FromRequestParts},
    http::{StatusCode, request::Parts},
};
use entity_registry::{NonUserOwners, resolve_creation_principal};
use macro_authorization::{
    MacroAuthorization, MacroAuthorizationExtractor, MacroAuthorizationRejection,
    MacroAuthorizationService, MacroAuthorizationState, UserOrBot, UserOrBotAuthorization,
};
use model_owner::CreationPrincipal;

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
            MacroAuthorizationExtractor::<Auth, UserOrBot>::from_request_parts(parts, state)
                .await?;
        let authorization = match caller.authorization {
            UserOrBotAuthorization::User(user) => MacroAuthorization::User(user),
            UserOrBotAuthorization::Bot(bot) => MacroAuthorization::Bot(bot),
        };
        let principal = resolve_creation_principal(&authorization, NonUserOwners::from_ref(state))
            .map_err(|error| {
                tracing::info!(%error, "caller cannot create documents");
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
