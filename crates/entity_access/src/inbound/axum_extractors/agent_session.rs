//! Agent session access extractor.
//!
//! Sessions use their canonical grants, link permissions, and inherited document
//! access. Public links allow anonymous viewing; control requests still require
//! authentication. Session channel participation does not itself grant access.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationService, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor,
};
use tracing::Level;

use super::{ExtractorError, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{Entity, EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};

#[derive(Debug, serde::Deserialize)]
struct AgentSessionAccessParams {
    session_id: String,
}

/// Validates that the caller satisfies the required permission for the agent
/// session named by a `session_id` path parameter.
///
/// Type parameter `T` specifies the required permission marker.
/// Type parameter `Svc` is the entity access service implementation.
/// Type parameter `Auth` is the authorization service implementation.
#[derive(Debug)]
pub struct AgentSessionAccessLevelExtractor<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt for the session.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for AgentSessionAccessLevelExtractor<T, Svc, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err(level = Level::INFO), skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let authorization =
            OptionalMacroAuthorizationExtractor::<Auth, AnyPrincipal>::from_request_parts(
                parts, state,
            )
            .await
            .map_err(ExtractorError::from)?;

        let Path(AgentSessionAccessParams { session_id }) = parts
            .extract::<Path<AgentSessionAccessParams>>()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing session_id path parameter"))?;

        if let Some(MacroAuthorization::Bot(authentication)) = authorization.authorization.as_ref()
        {
            let entity_access_receipt = generate_bot_entity_access_receipt::<T>(
                service.as_ref(),
                authentication,
                &session_id,
                EntityType::AgentSession,
            )
            .await?;

            return Ok(Self {
                entity_access_receipt,
                _marker: PhantomData,
            });
        }

        let is_internal_access = authorization
            .authorization
            .as_ref()
            .is_some_and(MacroAuthorization::is_internal);
        let macro_user_id = authorization
            .authorization
            .as_ref()
            .and_then(MacroAuthorization::acting_user)
            .map(|user| user.macro_user_id.clone());

        // An internal service with no acting user is trusted: it is the
        // harness and its own machinery, not a person whose grants we could
        // look up.
        if macro_user_id.is_none() && is_internal_access {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt::dangerously_assert_internal_user(
                    &session_id,
                    EntityType::AgentSession,
                ),
                _marker: PhantomData,
            });
        }

        let permission = service
            .get_entity_permission(
                macro_user_id.as_deref(),
                &session_id,
                EntityType::AgentSession,
                None,
            )
            .await
            .map_err(ExtractorError::from)?;

        // The other refusal: a grant exists but does not reach what this route
        // asks for. Logged separately from the no-grant case in the service,
        // because the fix is different - this one is a sharing level, not a
        // missing or not-yet-committed row.
        let entity_access_receipt = EntityAccessReceipt::try_new_for_user(
            macro_user_id.clone(),
            Entity {
                entity_id: session_id.clone(),
                entity_type: EntityType::AgentSession,
            },
            permission,
        )
        .inspect_err(|_| {
            tracing::warn!(
                entity_id = %session_id,
                entity_type = "agent_session",
                viewer = macro_user_id.as_deref().map_or("anonymous", AsRef::as_ref),
                "agent session access denied: grant does not reach the required permission"
            );
        })
        .map_err(ExtractorError::from)?;

        Ok(Self {
            entity_access_receipt,
            _marker: PhantomData,
        })
    }
}

#[cfg(test)]
mod test;
