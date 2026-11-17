use std::marker::PhantomData;

use ::axum::{
    extract::{FromRef, FromRequestParts},
    http::{StatusCode, request::Parts},
};

use macro_auth::credential::{CredentialKind, TokenSource};

use crate::{MacroAuthorization, MacroAuthorizationService};

use super::{
    AuthorizationPolicy, MacroAuthorizationRejection, MacroAuthorizationState,
    bot::authorize_optional_bot_request,
    harness::authorize_optional_harness_request,
    internal::{authorize_internal_request, internal_header_convention},
    rejection, status_rejection,
    user::{UserToken, authorize_optional_user_request},
    user_api_key::authorize_user_api_key_request,
};

/// Extracts and authorizes the request principal, then narrows it with `Policy`.
#[non_exhaustive]
pub struct MacroAuthorizationExtractor<Svc, Policy: AuthorizationPolicy> {
    /// The policy-narrowed authorization established for the request.
    pub authorization: Policy::Output,
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc, Policy: AuthorizationPolicy> MacroAuthorizationExtractor<Svc, Policy> {
    /// Return the authenticated entity responsible for this request.
    pub fn acting_entity(&self) -> Policy::ActingEntity<'_> {
        Policy::acting_entity(&self.authorization)
    }
}

impl<Svc, Policy: AuthorizationPolicy> Clone for MacroAuthorizationExtractor<Svc, Policy> {
    fn clone(&self) -> Self {
        Self {
            authorization: self.authorization.clone(),
            _service: PhantomData,
        }
    }
}

impl<S, Svc, Policy> FromRequestParts<S> for MacroAuthorizationExtractor<Svc, Policy>
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
            .ok_or_else(|| rejection("unauthorized"))?;

        Ok(Self {
            authorization: Policy::narrow(authorization)?,
            _service: PhantomData,
        })
    }
}

pub(super) async fn authorize_request<S, Svc>(
    parts: &mut Parts,
    state: &S,
) -> Result<Option<MacroAuthorization>, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    // The one reading of the request's credential, shared with the agent
    // scope check, so the two can't pick different ones.
    let credential = macro_auth::credential::request_credential(parts)
        .map_err(|error| status_rejection(StatusCode::BAD_REQUEST, error.code()))?;
    let user_token = match credential.kind {
        CredentialKind::Internal => {
            let Some(convention) = internal_header_convention(&parts.headers) else {
                return Err(rejection("unauthorized"));
            };
            return authorize_internal_request::<S, Svc>(parts, state, convention).await;
        }
        CredentialKind::UserApiKey => {
            let user = authorize_user_api_key_request::<S, Svc>(parts, state).await?;
            return Ok(Some(MacroAuthorization::User(user)));
        }
        CredentialKind::Bot => {
            let bot = authorize_optional_bot_request::<S, Svc>(parts, state)
                .await?
                .ok_or_else(|| rejection("unauthorized"))?;
            return Ok(Some(MacroAuthorization::Bot(bot)));
        }
        CredentialKind::Harness => {
            let harness = authorize_optional_harness_request::<S, Svc>(parts, state)
                .await?
                .ok_or_else(|| rejection("unauthorized"))?;
            return Ok(Some(MacroAuthorization::Harness(harness)));
        }
        CredentialKind::MalformedAuthorization => return Err(rejection("unauthorized")),
        CredentialKind::UserToken { token, source } => Some(UserToken {
            token,
            explicit: source != TokenSource::Cookie,
        }),
        CredentialKind::None => None,
    };

    authorize_optional_user_request::<S, Svc>(state, user_token)
        .await
        .map(|user| user.map(MacroAuthorization::User))
}
