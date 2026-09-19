//! Agent session access extractor.
//!
//! A session's permissions are entirely its own `entity_access` rows: the
//! owner with owner access, and - when the session was opened by a mention - the
//! channel that mention was posted in as editor. The dedicated channel a
//! session owns is deliberately not consulted; who participates in it says
//! nothing about who may act on the session.

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

use super::{ExtractorError, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
        RequiredPermission,
    },
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

    #[tracing::instrument(err, skip(state, parts))]
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
                entity_access_receipt: EntityAccessReceipt {
                    entity: Entity {
                        entity_id: session_id,
                        entity_type: EntityType::AgentSession,
                    },
                    auth: EntityAccessAuth::Internal,
                    entity_permission: EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                    _marker: PhantomData,
                },
                _marker: PhantomData,
            });
        }

        let Some(macro_user_id) = macro_user_id else {
            return Err(ExtractorError::Unauthorized);
        };

        let permission = service
            .get_entity_permission(
                Some(&macro_user_id),
                &session_id,
                EntityType::AgentSession,
                None,
            )
            .await
            .map_err(ExtractorError::from)?;

        if !permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        }

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: session_id,
                    entity_type: EntityType::AgentSession,
                },
                auth: EntityAccessAuth::Authenticated(macro_user_id),
                entity_permission: permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}
