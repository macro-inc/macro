use std::marker::PhantomData;

use ::axum::{
    extract::{FromRef, FromRequestParts},
    http::{StatusCode, request::Parts},
};

use crate::{MacroAuthorization, MacroAuthorizationService};

use super::{
    AuthorizationPolicy, MacroAuthorizationRejection, MacroAuthorizationState,
    bot::{BOT_TOKEN_HEADER, authorize_optional_bot_request},
    internal::{authorize_internal_request, internal_header_convention},
    rejection, status_rejection,
    user::{authorize_optional_user_request, explicit_user_credential_present},
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
    let internal_convention = internal_header_convention(&parts.headers);
    let has_bot_token = parts.headers.contains_key(BOT_TOKEN_HEADER);
    let has_explicit_user_credential = explicit_user_credential_present(parts);
    let explicit_credential_count = usize::from(internal_convention.is_some())
        + usize::from(has_bot_token)
        + usize::from(has_explicit_user_credential);

    if explicit_credential_count > 1 {
        return Err(status_rejection(
            StatusCode::BAD_REQUEST,
            "ambiguous credentials",
        ));
    }

    if let Some(convention) = internal_convention {
        return authorize_internal_request::<S, Svc>(parts, state, convention).await;
    }

    if has_bot_token {
        let bot = authorize_optional_bot_request::<S, Svc>(parts, state)
            .await?
            .expect("bot token presence was checked");
        return Ok(Some(MacroAuthorization::Bot(bot)));
    }

    authorize_optional_user_request::<S, Svc>(parts, state)
        .await
        .map(|user| user.map(MacroAuthorization::User))
}
