use std::marker::PhantomData;

use ::axum::{
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};

use crate::{MacroAuthorization, MacroAuthorizationService};

use super::{
    ActingEntity, MacroAuthorizationRejection, MacroAuthorizationState,
    macro_authorization::authorize_request,
};

/// Extracts and authorizes an optional acting user.
///
/// This extractor supports anonymous, direct user, bot, and internal service
/// callers. Requests without credentials succeed with `authorization` set to
/// `None`. Supplying more than one explicit credential type is rejected; an
/// ambient access-token cookie is considered only when no explicit credential
/// exists. Any supplied credential must pass authorization and is never treated
/// as anonymous. Identityless internal and bot principals remain visible
/// through `authorization`.
#[non_exhaustive]
pub struct OptionalMacroAuthorizationExtractor<Svc> {
    /// The typed authorization principal, or `None` for an anonymous request.
    ///
    /// Derive acting-user and internal-access information from this value when present.
    pub authorization: Option<MacroAuthorization>,
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc> OptionalMacroAuthorizationExtractor<Svc> {
    /// Return the authenticated entity responsible for this request, if any.
    pub fn acting_entity(&self) -> Option<ActingEntity<'_>> {
        self.authorization.as_ref().map(ActingEntity::from)
    }
}

impl<Svc> Clone for OptionalMacroAuthorizationExtractor<Svc> {
    fn clone(&self) -> Self {
        Self {
            authorization: self.authorization.clone(),
            _service: PhantomData,
        }
    }
}

impl<S, Svc> FromRequestParts<S> for OptionalMacroAuthorizationExtractor<Svc>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let authorization = authorize_request::<S, Svc>(parts, state).await?;

        Ok(Self {
            authorization,
            _service: PhantomData,
        })
    }
}
