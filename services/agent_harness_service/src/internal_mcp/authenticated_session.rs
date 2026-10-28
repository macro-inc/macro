//! Extract the session authenticated by the request's bearer credential.

use std::sync::Arc;

use agent_egress::domain::model::SessionToken;
use agent_session::domain::{
    credentials::authenticate_session, model::AgentSession, ports::AgentSessionRepo,
};
use axum::{
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
};
use axum_extra::{
    TypedHeader,
    headers::{Authorization, authorization::Bearer},
};

/// A session whose credential and active status have been checked by the domain.
#[derive(Clone)]
pub(super) struct AuthenticatedSession(pub(super) AgentSession);

impl<A: AgentSessionRepo> FromRequestParts<Arc<A>> for AuthenticatedSession {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        authority: &Arc<A>,
    ) -> Result<Self, Self::Rejection> {
        let TypedHeader(authorization) =
            TypedHeader::<Authorization<Bearer>>::from_request_parts(parts, authority)
                .await
                .map_err(|_| StatusCode::UNAUTHORIZED)?;
        authenticate_session(
            authority.as_ref(),
            &SessionToken::new(authorization.token()).hash(),
        )
        .await
        .map(Self)
        .map_err(|_| StatusCode::UNAUTHORIZED)
    }
}
