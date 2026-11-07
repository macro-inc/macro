use std::marker::PhantomData;

use ::axum::{
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};

use crate::MacroAuthorizationService;

use super::{
    AuthorizationPolicy, MacroAuthorizationRejection, MacroAuthorizationState,
    macro_authorization::authorize_request,
};

/// Extracts an optional principal: anonymous requests succeed with `None`;
/// any supplied credential must authenticate and satisfy `Policy`.
#[non_exhaustive]
pub struct OptionalMacroAuthorizationExtractor<Svc, Policy: AuthorizationPolicy> {
    /// The narrowed authorization, or `None` for an anonymous request.
    pub authorization: Option<Policy::Output>,
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc, Policy: AuthorizationPolicy> OptionalMacroAuthorizationExtractor<Svc, Policy> {
    /// Return the authenticated entity responsible for this request, if any.
    pub fn acting_entity(&self) -> Option<Policy::ActingEntity<'_>> {
        self.authorization.as_ref().map(Policy::acting_entity)
    }
}

impl<Svc, Policy: AuthorizationPolicy> Clone for OptionalMacroAuthorizationExtractor<Svc, Policy> {
    fn clone(&self) -> Self {
        Self {
            authorization: self.authorization.clone(),
            _service: PhantomData,
        }
    }
}

impl<S, Svc, Policy> FromRequestParts<S> for OptionalMacroAuthorizationExtractor<Svc, Policy>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    Policy: AuthorizationPolicy,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let authorization = authorize_request::<S, Svc>(parts, state)
            .await?
            .map(Policy::narrow)
            .transpose()?;

        Ok(Self {
            authorization,
            _service: PhantomData,
        })
    }
}
