//! Authorizes one scheduled action for a caller who may manage it.
//!
//! The grant is an `entity_access` row with `entity_type = 'scheduled_action'`.
//! Unlike the agent-session extractor, an anonymous caller is not given View,
//! an internal caller must name an acting user (a routine runs as a person, so
//! a user-less receipt authorizes nothing), and the route parameter is `{id}`.

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
use uuid::Uuid;

use super::{ExtractorError, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{Entity, EntityAccessAuth, EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};

#[derive(Debug, serde::Deserialize)]
struct ScheduledActionAccessParams {
    id: Uuid,
}

/// Receipt for the scheduled action named by the `{id}` path parameter.
#[derive(Debug)]
pub struct ScheduledActionAccessExtractor<T: RequiredPermission, Svc, Auth> {
    /// Capability for this routine at permission `T` or stronger.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for ScheduledActionAccessExtractor<T, Svc, Auth>
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

        let Path(ScheduledActionAccessParams { id }) = parts
            .extract::<Path<ScheduledActionAccessParams>>()
            .await
            .map_err(|_| {
                ExtractorError::BadRequest("missing scheduled action id path parameter")
            })?;

        if let Some(MacroAuthorization::Bot(authentication)) = authorization.authorization.as_ref()
        {
            let entity_access_receipt = generate_bot_entity_access_receipt::<T>(
                service.as_ref(),
                authentication,
                &id.to_string(),
                EntityType::ScheduledAction,
            )
            .await?;

            return Ok(Self {
                entity_access_receipt,
                _marker: PhantomData,
            });
        }

        let Some(user) = authorization
            .authorization
            .as_ref()
            .and_then(MacroAuthorization::acting_user)
            .map(|user| user.macro_user_id.clone())
        else {
            return Err(ExtractorError::Unauthorized);
        };

        let permission = service
            .get_entity_permission(
                Some(&user),
                &id.to_string(),
                EntityType::ScheduledAction,
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
                    entity_id: id.to_string(),
                    entity_type: EntityType::ScheduledAction,
                },
                auth: EntityAccessAuth::Authenticated(user),
                entity_permission: permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}

#[cfg(test)]
mod test;
